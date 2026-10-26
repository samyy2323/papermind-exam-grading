from utils.ollama_client import generate
import logging

logger = logging.getLogger(__name__)

async def evaluate_questions(student_answers: str, questions: list[dict], material: dict[int, str] | None = None) -> str:
    """
    Grades a batch of questions of a known exam and asks Llama3 for a JSON array of per-question results.
    questions: [{"number": 1, "type": "...", "text": "...", "referenceAnswer": "...", "marks": 2}, ...]
    material: optional syllabus excerpts keyed by question number.
    """
    logger.info("Evaluating %d questions using llama3:latest", len(questions))
    material = material or {}

    def block(q: dict) -> str:
        text = f"Q{q['number']} ({q['marks']:g} marks): {q.get('text', '')}\n  Expected answer: {q.get('referenceAnswer', '')}"
        if material.get(q["number"]):
            text += f"\n  Syllabus excerpt: {material[q['number']]}"
        return text

    scheme = "\n".join(block(q) for q in questions)

    prompt = f"""You are an expert examiner grading a student's answer sheet against a marking scheme.

For EVERY question below, find the student's answer in the extracted text and grade it. Award full marks if the answer captures the essence of the expected answer, partial marks if partly correct, and 0 if wrong or missing. Never award more than the marks available. Syllabus excerpts, when given, are background only; the expected answer decides the marks.

Return ONLY a JSON array, one object per question, in this exact format (no markdown, no other text):
[
  {{"question_number": 1, "student_answer": "<what the student wrote, or empty>", "awarded": <marks>, "confidence": <0.0-1.0>, "justification": "<one short sentence>"}}
]

"confidence" is how sure YOU are that the mark you awarded is right (for example the handwriting was unclear or the answer was ambiguous). It is NOT how correct the student's answer is: a clearly wrong answer that you graded 0 with certainty has high confidence.

Marking Scheme:
{scheme}

Student's Extracted Answers:
{student_answers}
"""
    return await generate(model="llama3:latest", prompt=prompt, num_ctx=12288)


async def evaluate_answers(student_answers: str, marking_scheme: str) -> str:
    """
    Evaluates student answers against the marking scheme using Llama3.
    """
    logger.info("Evaluating student answers using llama3:latest")
    
    prompt = f"""You are an expert examiner grading a student's answer sheet. Evaluate the student's answers against the marking scheme.

Be fair but precise. If a student's answer captures the essence of the expected answer, award full marks for that question. If it is partially correct, award partial marks. If it is completely wrong or missing, award 0.

At the very end of your evaluation, you MUST provide a final total score in the exact JSON format below. Do not wrap this JSON block in markdown backticks:

{{
  "total_obtained": <total_marks_awarded>,
  "total_possible": <total_marks_available>
}}

Marking Scheme:
{marking_scheme}

Student's Extracted Answers:
{student_answers}

Provide your detailed question-by-question evaluation followed by the final JSON block:
"""

    try:
        response = await generate(
            model="llama3:latest",
            prompt=prompt
        )
        return response
    except Exception as e:
        logger.error(f"Evaluation failed: {e}")
        raise
