import base64
import io
import json
import logging
import re

import pymupdf
from PIL import Image

from utils.ollama_client import generate

logger = logging.getLogger(__name__)

DIAGRAM_TAG = re.compile(r"[\[\(]\s*diagram\s*[\]\)]", re.IGNORECASE)
_HEADING = re.compile(r"^\s*Q(?:uestion)?\.?\s*(\d{1,3})\s*[\.\):\-]", re.IGNORECASE)
_LABELS = {"yes", "no", "true", "false"}  # words written on an arrow, not shapes
_TOKEN = re.compile(r"[a-z0-9>]+")

# Diagram questions are marked by the vision model alone (the language model is not used). It reads the teacher's drawing
# (cut out of the answer key) and the student's drawing in the same way, as a list of shapes and arrows, and the two lists
# are then compared. It is never asked to compare the two pictures directly or whether a given part is there: shown both,
# a 3B model says everything matches.
DRAWING_PROMPT = (
    "Look only at the drawing (boxes, ovals, diamonds, parallelograms and arrows). List every shape with the text written "
    "inside it, and every arrow with the shape it starts from and the shape it points to. Ignore the handwritten or printed "
    "sentences and the question. Do not add anything that is not drawn. If there is no drawing, return empty lists."
)
DRAWING_PROMPT_2 = (
    "This page contains a hand-drawn diagram made of boxes or shapes joined by arrows. Name each box or shape and the label "
    "inside it, and for every arrow say which shape it starts from and which shape it points to. Write only what is drawn."
)
DRAWING_SCHEMA = {"type": "object", "required": ["shapes", "arrows"], "properties": {
    "shapes": {"type": "array", "items": {"type": "object", "required": ["text"], "properties": {"text": {"type": "string"}}}},
    "arrows": {"type": "array", "items": {"type": "object", "required": ["from", "to"],
                                          "properties": {"from": {"type": "string"}, "to": {"type": "string"}}}}}}


def is_diagram(question_text: str) -> bool:
    """A question is a diagram question when the answer key tags it [diagram]."""
    return bool(DIAGRAM_TAG.search(question_text or ""))


MAP_TAG = re.compile(r"[\[\(]\s*map\s*[\]\)]", re.IGNORECASE)
_KEY_ITEM = re.compile(r"(\d{1,2})\s*[\.\):\-]?\s*([A-Za-z][A-Za-z ]*[A-Za-z])")
_LEGEND_ITEM = re.compile(r"(?m)\b(\d{1,2})[ \t]*(?:[\.\):=\-–—]|->|→)*[ \t]*([A-Za-z][A-Za-z \t]{2,})")


def is_map(question_text: str) -> bool:
    """A map question (mark and name places on an outline map) is tagged [map] in the answer key."""
    return bool(MAP_TAG.search(question_text or ""))


def map_items(reference_answer: str) -> list[tuple[int, str]]:
    """The places the student must name, from a key line such as 'Rivers: 1 Ganga; 2 Indus; 3 Narmada'."""
    text = re.sub(r"(?i)^\s*(rivers|places|marks?|labels?|items|parts)\s*[:\-]\s*", "", (reference_answer or "").split(".")[0].strip())
    return [(int(n), name.strip()) for n, name in (_KEY_ITEM.fullmatch(p.strip()).groups() for p in text.split(";")
                                                  if _KEY_ITEM.fullmatch(p.strip()))]


def grade_map(q: dict, page_texts: list[str]) -> dict:
    """
    Marks a map question by its labels: each place earns an equal share of the marks when the student wrote its number
    and name (in the legend or beside the map). Where the place was drawn is NOT checked: a 3B vision model cannot trace thin
    river lines on a hand-drawn outline, so the review screen shows the student's map next to the teacher's for the teacher
    to judge, and the mark always goes to review.
    """
    import difflib
    items = map_items(q["referenceAnswer"])
    if len(items) < 2:
        return {"awarded": 0, "confidence": 0.3, "diagram": True,
                "justification": "The answer key has no 'Rivers: 1 Name; 2 Name' list to check this map against."}
    found, missing, where = [], [], 0
    for number, name in items:
        hit = None
        for pi, text in enumerate(page_texts):
            for n, written in _LEGEND_ITEM.findall(text):
                w, k = " ".join(written.lower().split()), name.lower()
                # the whole name, or the line starting with it ("2 -> Indus river"), allowing for a slip in spelling
                core = set(w.split()) - {"unit", "device"}  # "Memory" for "Memory Unit" is still the right part
                if int(n) == number and (difflib.SequenceMatcher(None, w, k).ratio() >= 0.75
                                         or difflib.SequenceMatcher(None, w[:len(k)], k).ratio() >= 0.8
                                         or (core and core <= set(k.split()) and len(w) >= 4)):
                    hit = pi
                    break
            if hit is not None:
                break
        if hit is None:
            missing.append(f"{number} {name}")
        else:
            found.append(f"{number} {name}")
            where = hit
    awarded = round(len(found) / len(items) * float(q["marks"]) * 2) / 2
    text = f"Map on page {where + 1}: {len(found)} of {len(items)} places named correctly."
    if found:
        text += " Named: " + "; ".join(found) + "."
    if missing:
        text += " Not named: " + "; ".join(missing) + "."
    text += " Where each was drawn is not checked: compare the student's map with the teacher's."
    return {"awarded": min(float(q["marks"]), awarded), "confidence": 0.5, "diagram": True, "justification": text}


# ---- the teacher's drawing, cut out of the answer key PDF ----------------------------------------
def _b64(png: bytes, size: int = 1024) -> str:
    img = Image.open(io.BytesIO(png)).convert("RGB")
    img.thumbnail((size, size))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def key_diagrams(pdf_path: str) -> dict[int, str]:
    """
    The drawing the teacher put under each question of a typed answer key: the part of the page below the question's
    last line of text and above the next question. Works for pictures and for drawn shapes alike.
    Returns {question number: base64 JPEG}.
    """
    found: dict[int, tuple[int, bytes]] = {}
    with pymupdf.open(pdf_path) as doc:
        current = None
        for page in doc:
            blocks = sorted((b for b in page.get_text("blocks") if b[6] == 0), key=lambda b: b[1])
            sections = []  # [question, start y, end of its text]
            if not blocks or not _HEADING.match(blocks[0][4]):
                sections.append([current, page.rect.y0 + 36, page.rect.y0 + 36])
            for b in blocks:
                m = _HEADING.match(b[4])
                if m:
                    sections.append([int(m.group(1)), b[1], b[3]])
                else:
                    sections[-1][2] = max(sections[-1][2], b[3])
            for i, (q, _, text_end) in enumerate(sections):
                end = sections[i + 1][1] if i + 1 < len(sections) else page.rect.y1 - 36
                if q is None or end - text_end < 50:
                    continue
                clip = pymupdf.Rect(page.rect.x0 + 20, text_end + 4, page.rect.x1 - 20, end - 2)
                pix = page.get_pixmap(clip=clip, dpi=150)
                if (len(pix.samples) - pix.samples.count(b"\xff")) / len(pix.samples) < 0.002:
                    continue  # blank space, no drawing
                png = pix.tobytes("png")
                if q not in found or len(png) > len(found[q][1]):
                    found[q] = (page.number, png)
            current = sections[-1][0] if sections else current
    return {q: _b64(png) for q, (_, png) in found.items()}


# ---- reading a drawing -----------------------------------------------------------------------------
async def read_drawing(image_b64: str) -> dict:
    shapes, arrows = [], []
    for prompt in (DRAWING_PROMPT, DRAWING_PROMPT_2):  # the small model sometimes returns nothing on the first wording
        raw = await generate(model="qwen2.5vl:3b", prompt=prompt, images=[image_b64], json_schema=DRAWING_SCHEMA,
                             num_predict=500)
        try:
            data = json.loads(raw)
            shapes = [str(s.get("text", "")).strip() for s in data.get("shapes", []) if str(s.get("text", "")).strip()]
            arrows = [(str(a.get("from", "")).strip(), str(a.get("to", "")).strip()) for a in data.get("arrows", [])]
        except (ValueError, AttributeError, TypeError):
            shapes, arrows = [], []
        if shapes:
            break
    return {"shapes": shapes, "arrows": arrows}


def _tokens(text: str) -> set[str]:
    return set(_TOKEN.findall(text.lower()))


def _similarity(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def _nearest(text: str, shapes: list[str]) -> int | None:
    best = max(range(len(shapes)), key=lambda i: _similarity(text, shapes[i]), default=None)
    return best if best is not None and _similarity(text, shapes[best]) >= 0.5 else None


def _clean(drawing: dict) -> tuple[list[str], set[tuple[int, int]]]:
    """Shapes without arrow labels ('Yes'/'No'), and arrows between shape numbers; an arrow that runs through a label is joined up."""
    shapes = drawing["shapes"]
    for a, b in drawing["arrows"]:  # an arrow may name a shape that was not listed
        for t in (a, b):
            if t and _nearest(t, shapes) is None:
                shapes = shapes + [t]
    ends = {(_nearest(a, shapes), _nearest(b, shapes)) for a, b in drawing["arrows"] if a and b}
    ends = {(i, j) for i, j in ends if i is not None and j is not None and i != j}
    label = {i for i, t in enumerate(shapes) if " ".join(_TOKEN.findall(t.lower())) in _LABELS}
    for i in label:  # X -> label -> Y becomes X -> Y
        for x, _ in [e for e in ends if e[1] == i]:
            for _, y in [e for e in ends if e[0] == i]:
                if x != y:
                    ends.add((x, y))
    keep = [i for i in range(len(shapes)) if i not in label]
    renumber = {old: new for new, old in enumerate(keep)}
    return [shapes[i] for i in keep], {(renumber[i], renumber[j]) for i, j in ends if i in renumber and j in renumber}


def compare_drawings(reference: dict, student: dict) -> tuple[list[str], list[str], list[str]]:
    """Returns (everything the teacher's drawing has, what the student's drawing has of it, what is missing)."""
    rs, ra = _clean(reference)
    ss, sa = _clean(student)
    pairs = sorted(((_similarity(r, s), ri, si) for ri, r in enumerate(rs) for si, s in enumerate(ss)), reverse=True)
    match: dict[int, int] = {}
    for score, ri, si in pairs:  # one student shape per teacher shape, best matches first
        if score >= 0.5 and ri not in match and si not in match.values():
            match[ri] = si
    expected = [f"shape: {t}" for t in rs] + [f"arrow: {rs[a]} -> {rs[b]}" for a, b in sorted(ra)]
    present = [f"shape: {t}" for i, t in enumerate(rs) if i in match]
    present += [f"arrow: {rs[a]} -> {rs[b]}" for a, b in sorted(ra) if a in match and b in match and (match[a], match[b]) in sa]
    return expected, present, [e for e in expected if e not in present]


# ---- one diagram question -------------------------------------------------------------------------
async def grade_diagram(q: dict, reference_b64: str | None, image_paths: list[str], page_texts: list[str]) -> dict:
    if not reference_b64:
        return {"awarded": 0, "confidence": 0.3, "diagram": True,
                "justification": "The answer key has no drawing under this question to compare with."}
    reference = await read_drawing(reference_b64)
    if len(reference["shapes"]) < 2:
        return {"awarded": 0, "confidence": 0.3, "diagram": True,
                "justification": "The teacher's drawing in the answer key could not be read."}
    # The student's page is the one whose writing starts with this question's number; otherwise every page is read.
    head = re.compile(rf"(?m)^[ \t]*(?:Q(?:uestion)?\.?[ \t]*)?{q['number']}[ \t]*[\.\):\-]")
    named = [i for i, t in enumerate(page_texts) if head.search(t)] if len(page_texts) == len(image_paths) else []
    pages = named[:1] or list(range(len(image_paths)))
    student = {"shapes": [], "arrows": []}
    for i in pages:
        with open(image_paths[i], "rb") as f:
            png = f.read()
        d = await read_drawing(_b64(png))
        if not d["shapes"]:  # still nothing: look at the lower part of the page, where the drawing usually is
            img = Image.open(io.BytesIO(png)).convert("RGB")
            w, h = img.size
            buf = io.BytesIO()
            img.crop((0, int(h * 0.3), w, h)).save(buf, format="PNG")
            d = await read_drawing(_b64(buf.getvalue()))
        logger.info("Diagram Q%s page %s read: %s", q["number"], i + 1, d)
        student["shapes"] += d["shapes"]
        student["arrows"] += d["arrows"]
    expected, present, missing = compare_drawings(reference, student)
    awarded = round(len(present) / max(len(expected), 1) * float(q["marks"]) * 2) / 2  # nearest half mark
    # "on page N" is read back by the review screen to show the right page of the sheet next to the teacher's drawing.
    text = f"Diagram on page {pages[0] + 1}: {len(present)} of {len(expected)} parts of the teacher's drawing found."
    if present:
        text += " Found: " + "; ".join(present) + "."
    if missing:
        text += " Not found: " + "; ".join(missing) + "."
    # Confidence stays below the review threshold on purpose: every diagram mark is for the teacher to confirm.
    return {"awarded": min(float(q["marks"]), awarded), "confidence": 0.5, "diagram": True, "justification": text}
