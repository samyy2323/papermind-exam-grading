import asyncio
import json
import os
from typing import List, Optional

import aiofiles
import pymupdf
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ai_exam_system.database import get_db
from ai_exam_system.grader import answer_flags, effective_score, needs_review, run_grading
from ai_exam_system.models import AnswerRow, Exam, RosterStudent, Submission, User, new_id, now_iso
from ai_exam_system.routes_core import exam_dict, own_exam
from ai_exam_system.security import current_user
from utils.pdf_utils import build_sheet_pdf, pdf_to_images, save_images

router = APIRouter(prefix="/api")

SHEET_PDF = "sheet.pdf"  # the combined answer sheet kept next to the uploaded files

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")


def own_submission(db: Session, user: User, submission_id: str) -> tuple[Submission, Exam]:
    sub = db.get(Submission, submission_id)
    exam = db.get(Exam, sub.exam_id) if sub else None
    if sub is None or exam is None or exam.teacher_id != user.id:
        raise HTTPException(status_code=404, detail="Answer sheet not found.")
    return sub, exam


def answer_dict(a: AnswerRow, question=None) -> dict:
    # Objective answers are right or wrong, so the UI shows whether they matched the key.
    correct = (a.ai_score or 0) >= question.marks if question is not None and question.type == "objective" else None
    out = {
        "id": a.id, "questionId": a.question_id, "ocrText": a.ocr_text or "", "aiScore": a.ai_score,
        "confidence": a.confidence, "relevance": a.relevance, "justification": a.justification,
        "correct": correct, "reviewed": bool(a.reviewed), "override": None,
    }
    if a.override_score is not None:
        out["override"] = {"score": a.override_score, "reason": a.override_reason, "by": a.override_by, "at": a.override_at}
    if a.flagged_reason:
        out["flaggedReason"] = a.flagged_reason
    return out


def submission_dict(sub: Submission, exam: Exam) -> dict:
    qs = {q.id: q for q in exam.questions}
    return {
        "id": sub.id, "examId": sub.exam_id, "studentId": sub.roster_student_id, "studentName": sub.student_name,
        "usn": sub.usn, "submittedAt": sub.submitted_at, "pages": sub.pages, "status": sub.status,
        "error": sub.error, "answers": [answer_dict(a, qs.get(a.question_id)) for a in sub.answers],
    }


def summarize(sub: Submission, exam: Exam) -> dict:
    if sub.status == "processing":
        return {"status": "processing", "total": None, "max": exam.total_marks, "pending": 0, "mismatch": False,
                "lowConf": False}
    qs = {q.id: q for q in exam.questions}
    total, pending, mismatch, low = 0.0, 0, False, False
    for a in sub.answers:
        q = qs.get(a.question_id)
        if q is None:
            continue
        total += effective_score(a)
        if needs_review(a, q.marks, q.type):
            pending += 1
            f = answer_flags(a, q.marks, q.type)
            mismatch = mismatch or f["mismatch"]
            low = low or f["low_confidence"]
    return {"status": "needs_review" if pending else "graded", "total": total, "max": exam.total_marks,
            "pending": pending, "mismatch": mismatch, "lowConf": low}


def row_dict(sub: Submission, exam: Exam) -> dict:
    s = summarize(sub, exam)
    return {
        "id": sub.id, "examId": exam.id, "examTitle": exam.title, "examSubject": exam.subject,
        "studentId": sub.roster_student_id, "studentName": sub.student_name, "usn": sub.usn,
        "submittedAt": sub.submitted_at, "pages": sub.pages, "status": s["status"], "total": s["total"],
        "max": s["max"], "pending": s["pending"], "mismatch": s["mismatch"], "lowConfidence": s["lowConf"],
        "hasReferencePdf": True, "error": sub.error,
    }


# ---- Upload and progress -----------------------------------------------------------
@router.post("/students/{student_id}/answer-sheet")
async def upload_answer_sheet(
    student_id: str,
    examId: str = Form(...),
    files: List[UploadFile] = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    exam = own_exam(db, user, examId)
    if exam.status != "published":
        raise HTTPException(status_code=409, detail="Publish the exam before uploading answer sheets.")
    student = db.get(RosterStudent, student_id)
    if student is None or student.class_id != exam.class_id:
        raise HTTPException(status_code=404, detail="That student isn't on this exam's roster.")

    sub_id = new_id()
    sub = Submission(id=sub_id, exam_id=exam.id, roster_student_id=student.id, student_name=student.name,
                     usn=student.roll_number, status="processing", stage="queued")
    base_dir = os.path.join("data", "input", sub_id)
    os.makedirs(base_dir, exist_ok=True)

    image_paths, uploaded = [], []
    for i, upload in enumerate(files, start=1):
        name = os.path.basename(upload.filename or f"page{i}")
        path = os.path.join(base_dir, f"{i:02d}_{name}")
        async with aiofiles.open(path, "wb") as out:
            await out.write(await upload.read())
        if path.lower().endswith(".pdf"):
            image_paths += save_images(pdf_to_images(path), base_dir, prefix=f"{i:02d}_pdf")
        elif path.lower().endswith(IMAGE_EXTS):
            image_paths.append(path)
        else:
            raise HTTPException(status_code=400, detail=f"{name}: unsupported file type. Use photos (JPG, PNG, WebP) or a PDF.")
        uploaded.append(path)

    # Whatever was uploaded (photos, PDFs or both), the teacher reviews one PDF.
    try:
        build_sheet_pdf(uploaded, os.path.join(base_dir, SHEET_PDF))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not combine the files into a PDF: {e}")

    sub.pages = len(image_paths)
    sub.files_json = json.dumps(image_paths)
    db.add(sub)
    db.commit()
    asyncio.create_task(run_grading(sub.id))
    return {"submissionId": sub.id, "examId": exam.id, "status": "processing", "stage": "ocr"}


@router.get("/answer-sheets/{submission_id}/status")
def sheet_status(submission_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub, _ = own_submission(db, user, submission_id)
    stage = "done" if sub.status == "graded" else ("grading" if sub.stage == "grading" else "ocr")
    return {"status": sub.status, "stage": stage, "error": sub.error}


@router.post("/answer-sheets/{submission_id}/reprocess")
async def reprocess(submission_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    # async so that create_task below has a running event loop (a plain def route runs in a worker thread)
    sub, _ = own_submission(db, user, submission_id)
    if sub.status == "processing" and not sub.error:
        raise HTTPException(status_code=409, detail="This sheet is still being graded.")
    sub.status, sub.stage, sub.error = "processing", "queued", None
    db.commit()
    asyncio.create_task(run_grading(sub.id))
    return {"submissionId": sub.id, "status": "processing", "stage": "ocr"}


@router.get("/answer-sheets/{submission_id}/results")
def sheet_results(submission_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub, exam = own_submission(db, user, submission_id)
    return {"exam": exam_dict(exam), "submission": submission_dict(sub, exam)}


@router.get("/answer-sheets/{submission_id}/reference-pdf")
def reference_pdf(submission_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub, _ = own_submission(db, user, submission_id)
    headers = {"Content-Disposition": f'inline; filename="answer-sheet-{sub.usn}.pdf"'}
    paths = [p for p in json.loads(sub.files_json or "[]") if os.path.exists(p)]
    if not paths:
        raise HTTPException(status_code=404, detail="The uploaded files are no longer on the server.")
    stored = os.path.join(os.path.dirname(paths[0]), SHEET_PDF)
    if not os.path.exists(stored):
        # Sheets uploaded before the combined PDF was kept: build it from the page images and keep it.
        build_sheet_pdf(paths, stored)
    with open(stored, "rb") as f:
        return Response(content=f.read(), media_type="application/pdf", headers=headers)


# ---- Teacher views --------------------------------------------------------------------
@router.get("/exams/{exam_id}/submissions")
def exam_submissions(exam_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    exam = own_exam(db, user, exam_id)
    subs = db.query(Submission).filter(Submission.exam_id == exam.id).order_by(Submission.submitted_at.desc()).all()
    return [row_dict(s, exam) for s in subs]


@router.get("/exams/{exam_id}/review-queue")
def review_queue(exam_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [r for r in exam_submissions(exam_id, user, db) if r["status"] == "needs_review"]


class OverrideBody(BaseModel):
    score: float
    reason: str


def own_answer(db: Session, user: User, answer_id: str):
    a = db.get(AnswerRow, answer_id)
    sub = db.get(Submission, a.submission_id) if a else None
    exam = db.get(Exam, sub.exam_id) if sub else None
    if a is None or exam is None or exam.teacher_id != user.id:
        raise HTTPException(status_code=404, detail="Answer not found.")
    return a, next((q for q in exam.questions if q.id == a.question_id), None)


@router.patch("/student-answers/{answer_id}/override")
def override_score(answer_id: str, body: OverrideBody, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    a, q = own_answer(db, user, answer_id)
    marks = q.marks if q else 0
    if body.score < 0 or body.score > marks:
        raise HTTPException(status_code=400, detail=f"Score must be between 0 and {marks:g}.")
    if not body.reason.strip():
        raise HTTPException(status_code=400, detail="A reason is required when overriding a score.")
    a.override_score, a.override_reason = body.score, body.reason.strip()
    a.override_by, a.override_at = user.name, now_iso()
    db.commit()
    return answer_dict(a, q)


@router.post("/student-answers/{answer_id}/review")
def mark_reviewed(answer_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, q = own_answer(db, user, answer_id)
    a.reviewed = True
    db.commit()
    return answer_dict(a, q)


@router.get("/exams/{exam_id}/analytics")
def analytics(exam_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    exam = own_exam(db, user, exam_id)
    subs = db.query(Submission).filter(Submission.exam_id == exam.id).all()
    graded = [s for s in subs if s.status == "graded"]
    rows = [(s, summarize(s, exam)) for s in graded]
    pcts = [r[1]["total"] / exam.total_marks * 100 for r in rows]

    bins = [{"range": f"{i * 10}–{i * 10 + 10}%", "lo": i * 10, "count": 0} for i in range(10)]
    for p in pcts:
        bins[min(9, int(p // 10))]["count"] += 1

    per_question = []
    for q in exam.questions:
        answers = [a for s in graded for a in s.answers if a.question_id == q.id]
        avg = sum(effective_score(a) for a in answers) / (len(answers) or 1)
        per_question.append({
            "question": f"Q{q.number}", "type": q.type,
            "avgPct": round(avg / q.marks * 100) if q.marks else 0, "avg": round(avg, 1), "marks": q.marks,
            "flagged": sum(1 for a in answers if needs_review(a, q.marks, q.type)),
        })

    low_conf = mismatch = 0
    qs = {q.id: q for q in exam.questions}
    for s in graded:
        for a in s.answers:
            q = qs.get(a.question_id)
            if q and needs_review(a, q.marks, q.type):
                if answer_flags(a, q.marks, q.type)["mismatch"]:
                    mismatch += 1
                else:
                    low_conf += 1

    ordered = sorted(pcts)
    return {
        "exam": {"id": exam.id, "title": exam.title, "subject": exam.subject, "totalMarks": exam.total_marks},
        "totalSubmissions": len(subs),
        "processing": len(subs) - len(graded),
        "averageScore": sum(r[1]["total"] for r in rows) / len(rows) if rows else 0,
        "averagePct": sum(pcts) / len(pcts) if pcts else 0,
        "medianPct": ordered[len(ordered) // 2] if ordered else 0,
        "highestPct": ordered[-1] if ordered else 0,
        "flaggedSubmissions": sum(1 for r in rows if r[1]["status"] == "needs_review"),
        "cleanSubmissions": sum(1 for r in rows if r[1]["status"] == "graded"),
        "flaggedAnswers": {"lowConfidence": low_conf, "mismatch": mismatch},
        "distribution": bins,
        "perQuestion": per_question,
    }
