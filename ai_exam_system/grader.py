import asyncio
import json
import logging
import os
import re

from agents.evaluator import evaluate_questions
from agents.diagram_checker import grade_diagram, grade_map, is_diagram, is_map, key_diagrams
from agents.extractor import extract_page_texts
from ai_exam_system.crew import unload_model
from ai_exam_system.database import SessionLocal
from ai_exam_system.models import AnswerRow, Exam, KnowledgeDoc, Submission

logger = logging.getLogger(__name__)

# A CPU-only laptop can only run one model pipeline at a time.
_pipeline_lock = asyncio.Lock()
BATCH_SIZE = 8

CONFIDENCE_THRESHOLD = 0.6
LOW_RELEVANCE_THRESHOLD = 0.35
HIGH_SCORE_RATIO = 0.7

_STOPWORDS = set("""the and for that with this from are was were not but have has had its into than then they them their
there which what when where while will would can could should also such been being more most some any each other these
those about over under only very your you our out one two use used using""".split())


# ---- Review-flag rules (same rules as the UI's utils/grading.js) -----------------
def answer_flags(a: AnswerRow, marks: float, qtype: str) -> dict:
    if a.flagged_reason:
        return {"low_confidence": a.flagged_reason in ("low_confidence", "parse_failure"),
                "mismatch": a.flagged_reason == "injection_suspected", "not_found": a.flagged_reason == "answer_not_found"}
    blank = not (a.ocr_text or "").strip()
    low = (a.confidence or 0) < CONFIDENCE_THRESHOLD and not blank
    mismatch = qtype == "subjective" and (a.relevance or 0) < LOW_RELEVANCE_THRESHOLD and \
        marks > 0 and (a.ai_score or 0) / marks >= HIGH_SCORE_RATIO
    return {"low_confidence": low, "mismatch": mismatch, "not_found": blank}


def needs_review(a: AnswerRow, marks: float, qtype: str) -> bool:
    if a.override_score is not None or a.reviewed:
        return False
    # A question with no answer written is simply worth 0; it is shown as such but never sent for review.
    f = answer_flags(a, marks, qtype)
    return f["low_confidence"] or f["mismatch"]


def effective_score(a: AnswerRow) -> float:
    return a.override_score if a.override_score is not None else (a.ai_score or 0)


# ---- Retrieval from the knowledge base -----------------------------------------------
def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 3 and w not in _STOPWORDS}


def load_chunks(db, teacher_id: str, sub_domain: str) -> list[str]:
    docs = db.query(KnowledgeDoc).filter(KnowledgeDoc.teacher_id == teacher_id,
                                         KnowledgeDoc.sub_domain == sub_domain).all()
    return [c for d in docs for c in json.loads(d.chunks_json or "[]")]


def best_chunk(query: str, chunks: list[str]) -> str:
    q = _tokens(query)
    if not q or not chunks:
        return ""
    scored = [(len(q & _tokens(c)) / len(q), c) for c in chunks]
    score, chunk = max(scored, key=lambda s: s[0])
    return chunk[:400] if score >= 0.25 else ""


def relevance(student_text: str, reference: str, extra: str) -> float:
    """Share of the student's content words that appear in the reference answer or syllabus excerpt."""
    s = _tokens(student_text)
    if not s:
        return 0.0
    return min(1.0, len(s & _tokens(f"{reference} {extra}")) / len(s) * 1.5)


# ---- Parsing the model output ----------------------------------------------------------
def parse_batch(raw: str) -> dict[int, dict]:
    items = []
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if match:
        try:
            items = json.loads(match.group(0))
        except json.JSONDecodeError:
            # Keep the well-formed objects so one bad entry doesn't lose the batch.
            for obj in re.findall(r"\{[^{}]*\}", match.group(0)):
                try:
                    items.append(json.loads(obj))
                except json.JSONDecodeError:
                    continue
    out = {}
    for item in items:
        if isinstance(item, dict):
            digits = re.sub(r"\D", "", str(item.get("question_number", "")))
            if digits:
                out[int(digits)] = item
    return out


def _num(value, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


# ---- Cutting the sheet into per-question answers, and marking objective questions in code -------
_ANSWER_START = re.compile(r"(?m)^[ \t]*(?:Q(?:uestion)?\.?[ \t]*)?(\d{1,3})[ \t]*[\.\):\-]")


def _stems(text: str) -> set[str]:
    return {w[:5] for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 3 and w not in _STOPWORDS}


def split_answers(text: str, questions: list[dict]) -> dict[int, str]:
    """
    Cuts the extracted text into one answer per question.

    The text is first split into blocks at every line that starts with a question number. Multiple-choice
    answers are taken by number. Descriptive answers are matched to questions by number AND by content, because
    handwritten digits are misread (a 1 read as a 9 turns "21. Supervised learning..." into "29") and students
    do not always answer in order or number every answer correctly. Each block goes to the question whose text
    it shares the most words with; a matching number only adds a bonus. A numbered list inside an answer
    ("1. first point") is ignored because small numbers belong to the multiple-choice questions and count once.
    A number just past the last question (stray writing numbered 36) ends the previous block.
    """
    numbers = [q["number"] for q in questions]
    wanted, top = set(numbers), max(numbers)
    descriptive = {q["number"] for q in questions if q["type"] == "subjective"}
    seen: set[int] = set()
    bounds: list[tuple[int, int | None, int]] = []  # (line start, question number or None, where its text starts)
    for m in _ANSWER_START.finditer(text):
        n = int(m.group(1))
        if n in wanted and (n not in seen or n in descriptive):
            seen.add(n)
            bounds.append((m.start(), n, m.end()))
        elif top < n <= 99:  # a number past the last question: a misread digit (4 read as 29) or stray writing
            bounds.append((m.start(), None, m.end()))
    blocks: list[tuple[int | None, str]] = []
    for i, (_, n, body_start) in enumerate(bounds):
        end = bounds[i + 1][0] if i + 1 < len(bounds) else len(text)
        blocks.append((n, text[body_start:end].strip()[:1500]))

    segments: dict[int, str] = {}
    used: set[int] = set()
    for q in questions:  # multiple choice: by number
        if q["type"] == "objective":
            bi = next((i for i, (n, _) in enumerate(blocks) if n == q["number"] and i not in used), None)
            if bi is not None:
                segments[q["number"]] = blocks[bi][1]
                used.add(bi)

    candidates = []  # (score, question, block)
    for q in questions:
        if q["type"] != "subjective":
            continue
        qs, rs = _stems(q["text"]), _stems(q["referenceAnswer"])
        for bi, (n, txt) in enumerate(blocks):
            if bi in used:
                continue
            bs = _stems(txt)
            cov_q = len(qs & bs) / len(qs) if qs else 0.0
            cov_r = len(rs & bs) / len(rs) if rs else 0.0
            # How much of the written block is about this question. A short answer to a long model answer covers little
            # of the reference but is still on topic, so the block's own share counts too.
            on_topic = len((qs | rs) & bs) / len(bs) if bs else 0.0
            content = max(0.6 * cov_q + 0.4 * cov_r, 0.6 * on_topic)
            if content < 0.1:  # a matching number alone is not enough: text unrelated to the question is not its answer
                continue
            candidates.append((content + (0.4 if n == q["number"] else 0.0), q["number"], bi))
    taken: set[int] = set()
    for score, qn, bi in sorted(candidates, reverse=True):
        if bi in used or score < 0.3:
            continue
        if qn in taken:
            # An unnumbered block that fits an answer already found is its continuation (the answer ran onto the next page).
            if blocks[bi][0] is None:
                segments[qn] = (segments[qn] + "\n" + blocks[bi][1])[:1500]
                used.add(bi)
            continue
        segments[qn] = blocks[bi][1]
        taken.add(qn)
        used.add(bi)
    return segments


def _choice(text: str) -> str | None:
    """The option a short answer names: 'D) All of ...' -> 'D', '(c) Agile' -> 'C', 'True' -> 'true'."""
    t = text.strip()
    m = re.match(r"^[\s\(\[]*(?:([A-E])(?:[\)\]\.:]|\s|$)|([a-e])(?:[\)\]\.:]|$))", t)
    if m:
        return (m.group(1) or m.group(2)).upper()
    m = re.match(r"^\W*(true|false)\b", t, re.IGNORECASE)
    return m.group(1).lower() if m else None


def grade_objective(q: dict, student_text: str) -> dict | None:
    """Exact marking of a single-choice question. None when either side doesn't name a clear option."""
    if q["type"] != "objective":
        return None
    chosen, key = _choice(student_text), _choice(q["referenceAnswer"])
    if not chosen or not key:
        return None
    ok = chosen == key
    return {"awarded": q["marks"] if ok else 0, "confidence": 0.9,
            "justification": f"Chose {chosen}; matches the key." if ok else f"Chose {chosen}; the key is {key}."}


# ---- The job -------------------------------------------------------------------------------
def _update(submission_id: str, **fields):
    db = SessionLocal()
    try:
        sub = db.get(Submission, submission_id)
        for k, v in fields.items():
            setattr(sub, k, v)
        db.commit()
    finally:
        db.close()


async def run_grading(submission_id: str):
    db = SessionLocal()
    try:
        sub = db.get(Submission, submission_id)
        exam = db.get(Exam, sub.exam_id)
        image_paths = json.loads(sub.files_json)
        questions = [{"id": q.id, "number": q.number, "type": q.type, "text": q.text,
                      "referenceAnswer": q.reference_answer, "marks": q.marks} for q in exam.questions]
        chunks = load_chunks(db, exam.teacher_id, exam.sub_domain)
        key_pdf = os.path.join("data", "keys", exam.id, os.path.basename(exam.answer_key_file)) if exam.answer_key_file else None
    finally:
        db.close()

    try:
        async with _pipeline_lock:
            _update(submission_id, stage="ocr", error=None)
            # Reading the pages is the slowest step, so keep its result: a re-run after a later failure reuses it.
            folder = os.path.dirname(image_paths[0])
            ocr_cache, pages_cache = os.path.join(folder, "ocr.txt"), os.path.join(folder, "ocr_pages.json")
            page_texts: list[str] = []
            if os.path.exists(ocr_cache):
                with open(ocr_cache, encoding="utf-8") as f:
                    student_text = f.read()
                if os.path.exists(pages_cache):
                    with open(pages_cache, encoding="utf-8") as f:
                        page_texts = json.load(f)
            else:
                await unload_model("llama3:latest")
                page_texts = await extract_page_texts(image_paths)
                student_text = "\n\n".join(p for p in page_texts if p)
                if student_text.strip():
                    with open(ocr_cache, "w", encoding="utf-8") as f:
                        f.write(student_text)
                    with open(pages_cache, "w", encoding="utf-8") as f:
                        json.dump(page_texts, f)
            if not student_text.strip() and not any(is_diagram(q["text"]) or is_map(q["text"]) for q in questions):
                raise ValueError("No text could be read from the uploaded photos.")

            # Diagram questions: the vision model compares each student drawing with the teacher's drawing from the key.
            # Map questions are marked by the places the student named (read from the pages above).
            diagram_qs = [q for q in questions if is_diagram(q["text"]) and not is_map(q["text"])]
            results: dict[int, dict] = {}
            for q in questions:
                if is_map(q["text"]):
                    results[q["number"]] = grade_map(q, page_texts or [student_text])
            if diagram_qs:
                references = key_diagrams(key_pdf) if key_pdf and os.path.exists(key_pdf) else {}
                for q in diagram_qs:
                    results[q["number"]] = await grade_diagram(q, references.get(q["number"]), image_paths, page_texts)

            _update(submission_id, stage="grading")
            await unload_model("qwen2.5vl:3b")

            material = {}
            for q in questions:
                if q["type"] == "subjective":
                    material[q["number"]] = best_chunk(f"{q['text']} {q['referenceAnswer']}", chunks)
            # Give each question its own answer when the numbering can be followed; otherwise let the model search.
            # Diagram questions are left out so their caption text cannot be taken for another question's answer.
            written = [q for q in questions if q["number"] not in results]
            segments = split_answers(student_text, written) if written else {}
            per_question = len(segments) >= len(written) / 2
            if not per_question:
                segments = {}
            # Objective questions are marked in code (instant and exact); only the rest need the language model.
            to_model = []
            for q in written:
                answer = segments.get(q["number"], "")
                if per_question and not answer.strip():
                    # Nothing written for this question: 0 marks, no need to ask the model.
                    quick = {"awarded": 0, "confidence": 1.0, "justification": "No answer written."}
                else:
                    quick = grade_objective(q, answer) if per_question else None
                if quick:
                    results[q["number"]] = quick
                else:
                    to_model.append(q)
            for i in range(0, len(to_model), BATCH_SIZE):
                batch = to_model[i:i + BATCH_SIZE]
                raw = await evaluate_questions(
                    student_text, batch, {n: material[n] for n in (q["number"] for q in batch) if material.get(n)},
                    answers={q["number"]: segments.get(q["number"], "") for q in batch} if per_question else None)
                asked = {q["number"] for q in batch}
                results.update({n: r for n, r in parse_batch(raw).items() if n in asked})  # never overwrite another question

        db = SessionLocal()
        try:
            db.query(AnswerRow).filter(AnswerRow.submission_id == submission_id).delete()
            for q in questions:
                item = results.get(q["number"])
                if item is None:
                    db.add(AnswerRow(submission_id=submission_id, question_id=q["id"], ocr_text=segments.get(q["number"], ""), ai_score=0,
                                     confidence=0.3, relevance=0.5, flagged_reason="parse_failure",
                                     justification="The grader returned no result for this question."))
                    continue
                text = segments.get(q["number"]) if per_question else str(item.get("student_answer", "") or "")
                text = text or ""
                if item.get("diagram"):
                    text = str(item.get("justification", ""))  # what was seen in the drawing, shown next to the mark
                awarded = max(0.0, min(float(q["marks"]), _num(item.get("awarded"), 0.0)))
                db.add(AnswerRow(
                    submission_id=submission_id, question_id=q["id"], ocr_text=text, ai_score=awarded,
                    confidence=max(0.0, min(1.0, _num(item.get("confidence"), 0.6))),
                    relevance=1.0 if q["type"] == "objective" or item.get("diagram") else relevance(text, q["referenceAnswer"], material.get(q["number"], "")),
                    justification=str(item.get("justification", "") or "") or None,
                ))
            sub = db.get(Submission, submission_id)
            sub.status, sub.stage, sub.error = "graded", "done", None
            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.exception("Grading failed for submission %s", submission_id)
        _update(submission_id, error=f"Grading failed: {e}")


def mark_interrupted():
    """Submissions that were mid-grading when the server stopped can't resume; tell the teacher."""
    db = SessionLocal()
    try:
        for sub in db.query(Submission).filter(Submission.status == "processing", Submission.error.is_(None)):
            sub.error = "The server restarted while this sheet was being graded."
        db.commit()
    finally:
        db.close()
