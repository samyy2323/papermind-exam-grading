import json
import logging
import re

import pymupdf

from agents.extractor import extract_handwritten_text
from utils.ollama_client import generate
from utils.pdf_utils import pdf_to_images, save_images

logger = logging.getLogger(__name__)

# "1. answer", "Q1) answer", "1,MCQ,B", "1: answer"
_ENTRY = re.compile(r"^\s*(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[\.\):,\-]\s*(.*)$", re.IGNORECASE)
_TYPE_PREFIX = re.compile(r"^(MCQ|Short[_ ]?Answer|Long[_ ]?Answer|Objective|Subjective)\s*[,:\-]\s*", re.IGNORECASE)


async def read_key_text(path: str, workdir: str) -> str:
    """Text of an answer key: typed PDF/text directly, scanned PDF via the vision model."""
    if path.lower().endswith(".pdf"):
        with pymupdf.open(path) as doc:
            text = "\n".join(page.get_text() for page in doc)
        if len(text.strip()) >= 40:
            return text
        pages = save_images(pdf_to_images(path), workdir, prefix="key")
        return await extract_handwritten_text(pages)
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _looks_objective(answer: str) -> bool:
    a = answer.strip().strip('"')
    return len(a) <= 40 and bool(re.match(r"^\(?[a-dA-D]\)?(\s|$|\.)|^(true|false)\b", a, re.IGNORECASE))


# A line such as "Answer: B", "Ans - Paris" or "Correct answer: (c) ..." that starts the answer part of an entry
_ANSWER_LINE = re.compile(r"(?im)^[ \t]*(?:correct[ \t]+|model[ \t]+|expected[ \t]+)?(?:answer|ans\.?|key|solution)[ \t]*[:\-–—][ \t]*")
_ANSWER_INLINE = re.compile(r"(?i)[ \t](?:answer|ans)[ \t]*[:\-–—][ \t]*")
_MARKS_TAG = re.compile(r"[\[\(][ \t]*(\d+(?:\.\d+)?)[ \t]*(?:marks?|m|pts?|points?)[ \t]*[\]\)]", re.IGNORECASE)
_SECTION = re.compile(r"^[ \t]*(?:part|section)\b", re.IGNORECASE)
_MARKS_EACH = re.compile(r"(\d+(?:\.\d+)?)[ \t]*marks?[ \t]*each", re.IGNORECASE)
_OPTION_LINE = re.compile(r"^[ \t]*\(?[A-Ea-e][\.\)][ \t]+\S")


def _split_entries(text: str) -> list[dict]:
    """Splits the key into numbered entries, each with its raw lines and the marks announced by a section header."""
    entries: list[dict] = []
    section_marks = 0.0
    skipping_header = False
    for line in text.splitlines():
        if not line.strip():
            continue
        m = _ENTRY.match(line)
        # A new entry must continue the sequence, otherwise it is a wrapped line of the previous entry.
        if m and int(m.group(1)) == len(entries) + 1:
            entries.append({"number": len(entries) + 1, "lines": [m.group(2).strip()], "section_marks": section_marks})
            skipping_header = False
        elif _SECTION.match(line):
            # "Part II: Short Answer Questions (2 Marks Each)": remember the marks, ignore the heading text
            hint = _MARKS_EACH.search(line)
            section_marks = float(hint.group(1)) if hint else 0.0
            skipping_header = True
        elif entries and not skipping_header:
            entries[-1]["lines"].append(line.strip())
    return entries


def parse_numbered_entries(text: str) -> list[dict]:
    """
    Deterministic parse of numbered keys. Handles both layouts a teacher might use:
      - answers only:          "1. B"   "2,MCQ,C"   "3. Photosynthesis is ..."
      - questions and answers: "1. What is X?  A. ..  B. ..  Answer: B   [2 marks]"
    Returns [] if the text doesn't look numbered.
    """
    out: list[dict] = []
    for e in _split_entries(text):
        full = "\n".join(e["lines"]).strip()
        m = _ANSWER_LINE.search(full) or _ANSWER_INLINE.search(full)
        qtext, qtype = "", None
        if m:
            qtext, answer = full[:m.start()].strip(), full[m.end():]
        else:
            answer = " ".join(e["lines"])
            tm = _TYPE_PREFIX.match(answer)
            if tm:
                qtype = "objective" if tm.group(1).lower() in ("mcq", "objective") else "subjective"
                answer = answer[tm.end():]
        answer = " ".join(answer.split()).strip('"').strip()  # also drops quotes that wrapped across lines

        marks = e["section_marks"]
        tag = _MARKS_TAG.search(qtext) or (_MARKS_TAG.search(answer) if m else None)
        if tag:
            marks = float(tag.group(1))
            qtext, answer = _MARKS_TAG.sub("", qtext).strip(), _MARKS_TAG.sub("", answer).strip()
        qtext = "\n".join(" ".join(l.split()) for l in qtext.splitlines() if l.strip())

        if qtype is None:
            options = sum(1 for l in qtext.splitlines() if _OPTION_LINE.match(l))
            qtype = "objective" if options >= 2 or _looks_objective(answer) else "subjective"
        out.append({"number": e["number"], "answer": answer, "type": qtype, "text": qtext, "marks": marks})
    return out


async def _llm_structure(text: str) -> list[dict]:
    prompt = f"""You are an expert examiner. Convert this answer key into JSON.
Return ONLY a JSON array, one object per question:
[{{"number": 1, "type": "objective or subjective", "text": "<question text if the key contains it, else empty>", "referenceAnswer": "<expected answer>", "marks": <marks if stated, else 0>}}]
Use "objective" for single-choice/true-false answers, otherwise "subjective".

Answer key:
{text[:12000]}
"""
    raw = await generate(model="llama3:latest", prompt=prompt, num_ctx=12288, num_predict=4000)
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    items = []
    if match:
        try:
            items = json.loads(match.group(0))
        except json.JSONDecodeError:
            for obj in re.findall(r"\{[^{}]*\}", match.group(0)):
                try:
                    items.append(json.loads(obj))
                except json.JSONDecodeError:
                    continue
    return [i for i in items if isinstance(i, dict)]


async def extract_questions(text: str, total_marks: float, num_questions: int | None) -> list[dict]:
    """Returns questions as {number, type, text, referenceAnswer, marks, extractionConfidence} (no ids)."""
    entries = parse_numbered_entries(text)
    wanted = num_questions or 0
    questions: list[dict] = []

    if len(entries) >= 2 and (not wanted or len(entries) >= wanted * 0.8):
        for e in entries:
            questions.append({"number": e["number"], "type": e["type"], "text": e["text"], "referenceAnswer": e["answer"],
                              "marks": e["marks"], "extractionConfidence": 0.95})
    else:
        for i, item in enumerate(await _llm_structure(text), start=1):
            ref = str(item.get("referenceAnswer", "") or "")
            qtype = item.get("type") if item.get("type") in ("objective", "subjective") else \
                ("objective" if _looks_objective(ref) else "subjective")
            try:
                marks = float(item.get("marks") or 0)
            except (TypeError, ValueError):
                marks = 0
            questions.append({"number": i, "type": qtype, "text": str(item.get("text", "") or ""),
                              "referenceAnswer": ref, "marks": marks, "extractionConfidence": 0.75})

    # Keep marks the key states ("[2 marks]", "(2 Marks Each)"); only when some are missing spread the total evenly.
    if questions and any(q["marks"] <= 0 for q in questions):
        n = len(questions)
        base = int(total_marks // n) or 1
        remainder = int(total_marks - base * n)
        for q in questions:
            q["marks"] = base + (1 if remainder > 0 else 0)
            remainder -= 1

    for q in questions:
        if not q["text"]:
            q["text"] = f"Question {q['number']}"
            q["extractionConfidence"] = min(q["extractionConfidence"], 0.9)
    return questions
