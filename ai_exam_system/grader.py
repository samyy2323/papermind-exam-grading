import asyncio
import json
import logging
import re

from agents.evaluator import evaluate_questions
from agents.extractor import extract_handwritten_text
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
    low = (a.confidence or 0) < CONFIDENCE_THRESHOLD
    mismatch = qtype == "subjective" and (a.relevance or 0) < LOW_RELEVANCE_THRESHOLD and \
        marks > 0 and (a.ai_score or 0) / marks >= HIGH_SCORE_RATIO
    return {"low_confidence": low, "mismatch": mismatch, "not_found": not (a.ocr_text or "").strip()}


def needs_review(a: AnswerRow, marks: float, qtype: str) -> bool:
    if a.override_score is not None or a.reviewed:
        return False
    return any(answer_flags(a, marks, qtype).values())


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
    finally:
        db.close()

    try:
        async with _pipeline_lock:
            _update(submission_id, stage="ocr", error=None)
            await unload_model("llama3:latest")
            student_text = await extract_handwritten_text(image_paths)
            if not student_text.strip():
                raise ValueError("No text could be read from the uploaded photos.")

            _update(submission_id, stage="grading")
            await unload_model("qwen2.5vl:3b")

            material, results = {}, {}
            for q in questions:
                if q["type"] == "subjective":
                    material[q["number"]] = best_chunk(f"{q['text']} {q['referenceAnswer']}", chunks)
            for i in range(0, len(questions), BATCH_SIZE):
                batch = questions[i:i + BATCH_SIZE]
                raw = await evaluate_questions(student_text, batch, {n: material[n] for n in (q["number"] for q in batch) if material.get(n)})
                results.update(parse_batch(raw))

        db = SessionLocal()
        try:
            db.query(AnswerRow).filter(AnswerRow.submission_id == submission_id).delete()
            for q in questions:
                item = results.get(q["number"])
                if item is None:
                    db.add(AnswerRow(submission_id=submission_id, question_id=q["id"], ocr_text="", ai_score=0,
                                     confidence=0.3, relevance=0.5, flagged_reason="parse_failure",
                                     justification="The grader returned no result for this question."))
                    continue
                text = str(item.get("student_answer", "") or "")
                awarded = max(0.0, min(float(q["marks"]), _num(item.get("awarded"), 0.0)))
                db.add(AnswerRow(
                    submission_id=submission_id, question_id=q["id"], ocr_text=text, ai_score=awarded,
                    confidence=max(0.0, min(1.0, _num(item.get("confidence"), 0.6))),
                    relevance=1.0 if q["type"] == "objective" else relevance(text, q["referenceAnswer"], material.get(q["number"], "")),
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
