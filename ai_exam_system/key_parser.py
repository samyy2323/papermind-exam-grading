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


def parse_numbered_entries(text: str) -> list[dict]:
    """Deterministic parse of 'N. answer' style keys. Returns [] if it doesn't look numbered."""
    entries: list[dict] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        m = _ENTRY.match(line)
        # A new entry must continue the sequence, otherwise it is a wrapped line of the previous answer.
        if m and int(m.group(1)) == len(entries) + 1:
            body = m.group(2).strip()
            qtype = None
            tm = _TYPE_PREFIX.match(body)
            if tm:
                qtype = "objective" if tm.group(1).lower() in ("mcq", "objective") else "subjective"
                body = body[tm.end():]
            entries.append({"number": len(entries) + 1, "answer": body.strip().strip('"'), "type": qtype})
        elif entries:
            entries[-1]["answer"] = (entries[-1]["answer"] + " " + line.strip()).strip()
    return entries


async def _llm_structure(text: str) -> list[dict]:
    prompt = f"""You are an expert examiner. Convert this answer key into JSON.
Return ONLY a JSON array, one object per question:
[{{"number": 1, "type": "objective or subjective", "text": "<question text if the key contains it, else empty>", "referenceAnswer": "<expected answer>", "marks": <marks if stated, else 0>}}]
Use "objective" for single-choice/true-false answers, otherwise "subjective".

Answer key:
{text[:12000]}
"""
    raw = await generate(model="llama3:latest", prompt=prompt, num_ctx=12288)
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
            qtype = e["type"] or ("objective" if _looks_objective(e["answer"]) else "subjective")
            questions.append({"number": e["number"], "type": qtype, "text": "", "referenceAnswer": e["answer"],
                              "marks": 0, "extractionConfidence": 0.95})
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

    # Spread the total marks evenly where the key doesn't state them.
    if questions and sum(q["marks"] for q in questions) != total_marks:
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
