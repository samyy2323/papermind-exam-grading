import json
import os
import re
from typing import List, Optional

import aiofiles
import pymupdf
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ai_exam_system.database import get_db
from ai_exam_system.key_parser import extract_questions, read_key_text
from ai_exam_system.models import (Exam, Klass, KnowledgeDoc, Question, RosterStudent, Submission, User, new_id,
                                   now_iso)
from ai_exam_system.security import current_user, hash_password, make_token, verify_password

router = APIRouter(prefix="/api")


# ---- Auth ------------------------------------------------------------------
class RegisterBody(BaseModel):
    name: str
    email: str
    password: str


class LoginBody(BaseModel):
    email: str
    password: str


def user_payload(user: User) -> dict:
    return {"id": user.id, "role": user.role, "name": user.name, "email": user.email, "token": make_token(user.id)}


@router.post("/auth/register")
def register(body: RegisterBody, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Enter your name.")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = User(name=body.name.strip(), email=email, password_hash=hash_password(body.password), role="teacher")
    db.add(user)
    db.commit()
    return user_payload(user)


@router.post("/auth/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.strip().lower()).first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    return user_payload(user)


# ---- Helpers -----------------------------------------------------------------
def question_dict(q: Question) -> dict:
    out = {"id": q.id, "number": q.number, "type": q.type, "text": q.text, "referenceAnswer": q.reference_answer,
           "marks": q.marks}
    if q.extraction_confidence is not None:
        out["extractionConfidence"] = q.extraction_confidence
    return out


def exam_dict(exam: Exam, submission_count: Optional[int] = None) -> dict:
    out = {
        "id": exam.id, "title": exam.title, "subject": exam.subject, "subDomain": exam.sub_domain,
        "totalMarks": exam.total_marks, "numQuestions": exam.num_questions or len(exam.questions),
        "status": exam.status, "classId": exam.class_id, "publishedAt": exam.published_at,
        "createdAt": exam.created_at, "answerKeyFile": exam.answer_key_file,
        "questions": [question_dict(q) for q in exam.questions],
    }
    if submission_count is not None:
        out["submissionCount"] = submission_count
    return out


def get_class(db: Session, teacher_id: str, sub_domain: str) -> Klass:
    klass = db.query(Klass).filter(Klass.teacher_id == teacher_id, Klass.sub_domain == sub_domain).first()
    if klass is None:
        klass = Klass(teacher_id=teacher_id, sub_domain=sub_domain)
        db.add(klass)
        db.flush()
    return klass


def own_exam(db: Session, user: User, exam_id: str) -> Exam:
    exam = db.get(Exam, exam_id)
    if exam is None or exam.teacher_id != user.id:
        raise HTTPException(status_code=404, detail="Exam not found.")
    return exam


def own_class(db: Session, user: User, class_id: str) -> Klass:
    klass = db.get(Klass, class_id)
    if klass is None or klass.teacher_id != user.id:
        raise HTTPException(status_code=404, detail="Class not found.")
    return klass


# ---- Exams -------------------------------------------------------------------
class ExamCreate(BaseModel):
    title: str
    subject: str
    subDomain: str
    totalMarks: float
    numQuestions: Optional[int] = None


class ExamPatch(BaseModel):
    title: Optional[str] = None
    subject: Optional[str] = None
    subDomain: Optional[str] = None
    totalMarks: Optional[float] = None
    numQuestions: Optional[int] = None
    answerKeyFile: Optional[str] = None


class QuestionIn(BaseModel):
    id: Optional[str] = None
    number: int
    type: str = "subjective"
    text: str = ""
    referenceAnswer: str = ""
    marks: float = 1
    extractionConfidence: Optional[float] = None


@router.get("/exams")
def list_exams(user: User = Depends(current_user), db: Session = Depends(get_db)):
    exams = db.query(Exam).filter(Exam.teacher_id == user.id).order_by(Exam.created_at.desc()).all()
    counts = {e.id: db.query(Submission).filter(Submission.exam_id == e.id).count() for e in exams}
    return [exam_dict(e, counts[e.id]) for e in exams]


@router.post("/exams")
def create_exam(body: ExamCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.totalMarks <= 0:
        raise HTTPException(status_code=400, detail="Total marks must be greater than zero.")
    klass = get_class(db, user.id, body.subDomain)
    exam = Exam(teacher_id=user.id, class_id=klass.id, title=body.title.strip(), subject=body.subject.strip(),
                sub_domain=body.subDomain, total_marks=body.totalMarks, num_questions=body.numQuestions or 0)
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam_dict(exam)


@router.get("/exams/{exam_id}")
def get_exam(exam_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return exam_dict(own_exam(db, user, exam_id))


@router.patch("/exams/{exam_id}")
def patch_exam(exam_id: str, body: ExamPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    exam = own_exam(db, user, exam_id)
    if exam.status == "published":
        raise HTTPException(status_code=409, detail="Published exams are locked.")
    if body.title is not None:
        exam.title = body.title.strip()
    if body.subject is not None:
        exam.subject = body.subject.strip()
    if body.subDomain is not None and body.subDomain != exam.sub_domain:
        exam.sub_domain = body.subDomain
        exam.class_id = get_class(db, user.id, body.subDomain).id
    if body.totalMarks is not None:
        exam.total_marks = body.totalMarks
    if body.numQuestions is not None:
        exam.num_questions = body.numQuestions
    if body.answerKeyFile is not None:
        exam.answer_key_file = body.answerKeyFile
    db.commit()
    return exam_dict(exam)


@router.put("/exams/{exam_id}/questions")
def put_questions(exam_id: str, body: List[QuestionIn], user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    exam = own_exam(db, user, exam_id)
    if exam.status == "published":
        raise HTTPException(status_code=409, detail="Published exams are locked.")
    existing = {q.id for q in exam.questions}
    exam.questions.clear()
    db.flush()
    for i, q in enumerate(body, start=1):
        qid = q.id if q.id in existing else new_id()
        exam.questions.append(Question(id=qid, number=i, type=q.type if q.type in ("objective", "subjective") else "subjective",
                                       text=q.text, reference_answer=q.referenceAnswer, marks=q.marks,
                                       extraction_confidence=q.extractionConfidence))
    exam.num_questions = len(body)
    db.commit()
    db.refresh(exam)
    return [question_dict(q) for q in exam.questions]


@router.post("/exams/{exam_id}/publish")
def publish_exam(exam_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    exam = own_exam(db, user, exam_id)
    if not exam.questions:
        raise HTTPException(status_code=400, detail="Add at least one question before publishing.")
    total = sum(q.marks for q in exam.questions)
    if abs(total - exam.total_marks) > 1e-6:
        raise HTTPException(status_code=400, detail=f"Question marks add up to {total:g}, but total marks is {exam.total_marks:g}.")
    exam.status = "published"
    exam.published_at = now_iso()
    db.commit()
    return exam_dict(exam)


@router.delete("/exams/{exam_id}")
def delete_exam(exam_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    exam = own_exam(db, user, exam_id)
    if db.query(Submission).filter(Submission.exam_id == exam.id).count():
        raise HTTPException(status_code=409, detail="This exam has answer sheets and can't be deleted.")
    db.delete(exam)
    db.commit()
    return {"ok": True}


@router.post("/exams/{exam_id}/answer-key")
async def upload_answer_key(
    exam_id: str,
    file: UploadFile = File(...),
    totalMarks: Optional[float] = Form(None),
    numQuestions: Optional[int] = Form(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    exam = own_exam(db, user, exam_id)
    if exam.status == "published":
        raise HTTPException(status_code=409, detail="Published exams are locked.")
    workdir = os.path.join("data", "keys", exam.id)
    os.makedirs(workdir, exist_ok=True)
    path = os.path.join(workdir, os.path.basename(file.filename or "answer_key.pdf"))
    async with aiofiles.open(path, "wb") as out:
        await out.write(await file.read())

    try:
        text = await read_key_text(path, workdir)
        if not text.strip():
            raise ValueError("no text found")
        questions = await extract_questions(text, totalMarks or exam.total_marks, numQuestions or exam.num_questions)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not read the answer key: {e}")
    if not questions:
        raise HTTPException(status_code=422, detail="No questions could be found in this answer key. Add them manually below.")

    exam.answer_key_file = os.path.basename(path)
    db.commit()
    return [{"id": new_id(), **q} for q in questions]


@router.get("/exams/{exam_id}/answer-key-file")
def answer_key_file(exam_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The answer key as uploaded, so the teacher can read it next to the extracted questions."""
    exam = own_exam(db, user, exam_id)
    if not exam.answer_key_file:
        raise HTTPException(status_code=404, detail="No answer key has been uploaded for this exam.")
    path = os.path.join("data", "keys", exam.id, os.path.basename(exam.answer_key_file))
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="The uploaded answer key is no longer on the server.")
    media = "application/pdf" if path.lower().endswith(".pdf") else "text/plain; charset=utf-8"
    with open(path, "rb") as f:
        return Response(content=f.read(), media_type=media, headers={"Content-Disposition": f'inline; filename="{os.path.basename(path)}"'})


# ---- Roster ------------------------------------------------------------------
class StudentIn(BaseModel):
    name: Optional[str] = None
    rollNumber: Optional[str] = None


def student_dict(s: RosterStudent) -> dict:
    return {"id": s.id, "name": s.name, "rollNumber": s.roll_number}


@router.get("/classes/{class_id}/roster")
def get_roster(class_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    klass = own_class(db, user, class_id)
    return [student_dict(s) for s in sorted(klass.students, key=lambda s: s.roll_number)]


@router.post("/classes/{class_id}/roster")
def add_student(class_id: str, body: StudentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    klass = own_class(db, user, class_id)
    name, roll = (body.name or "").strip(), (body.rollNumber or "").strip()
    if not name or not roll:
        raise HTTPException(status_code=400, detail="Name and roll number are required.")
    if any(s.roll_number.lower() == roll.lower() for s in klass.students):
        raise HTTPException(status_code=409, detail="That roll number is already on the roster.")
    student = RosterStudent(class_id=klass.id, name=name, roll_number=roll)
    db.add(student)
    db.commit()
    return student_dict(student)


@router.patch("/classes/{class_id}/roster/{student_id}")
def update_student(class_id: str, student_id: str, body: StudentIn, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    own_class(db, user, class_id)
    student = db.get(RosterStudent, student_id)
    if student is None or student.class_id != class_id:
        raise HTTPException(status_code=404, detail="Student not found.")
    if body.name and body.name.strip():
        student.name = body.name.strip()
    if body.rollNumber and body.rollNumber.strip():
        student.roll_number = body.rollNumber.strip()
    db.commit()
    return student_dict(student)


@router.delete("/classes/{class_id}/roster/{student_id}")
def remove_student(class_id: str, student_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    own_class(db, user, class_id)
    student = db.get(RosterStudent, student_id)
    if student is None or student.class_id != class_id:
        raise HTTPException(status_code=404, detail="Student not found.")
    db.delete(student)
    db.commit()
    return {"ok": True}


# ---- Knowledge base ------------------------------------------------------------
def chunk_text(text: str, size: int = 700) -> list[str]:
    """Splits on paragraph/sentence boundaries into ~size-character chunks."""
    pieces = [p.strip() for p in re.split(r"\n\s*\n|(?<=[.!?])\s+", text) if p.strip()]
    chunks, current = [], ""
    for p in pieces:
        if current and len(current) + len(p) > size:
            chunks.append(current)
            current = p
        else:
            current = f"{current} {p}".strip()
    if current:
        chunks.append(current)
    return chunks


def doc_dict(d: KnowledgeDoc) -> dict:
    return {"id": d.id, "fileName": d.file_name, "subDomain": d.sub_domain, "sizeKb": d.size_kb,
            "chunksIndexed": len(json.loads(d.chunks_json or "[]")), "uploadedAt": d.uploaded_at, "status": "indexed"}


@router.get("/knowledge-base")
def list_docs(subDomain: Optional[str] = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(KnowledgeDoc).filter(KnowledgeDoc.teacher_id == user.id)
    if subDomain:
        q = q.filter(KnowledgeDoc.sub_domain == subDomain)
    return [doc_dict(d) for d in q.order_by(KnowledgeDoc.uploaded_at.desc()).all()]


@router.post("/knowledge-base")
async def upload_doc(file: UploadFile = File(...), subDomain: str = Form(...), user: User = Depends(current_user),
                     db: Session = Depends(get_db)):
    content = await file.read()
    name = file.filename or "document"
    try:
        if name.lower().endswith(".pdf"):
            with pymupdf.open(stream=content, filetype="pdf") as doc:
                text = "\n\n".join(page.get_text() for page in doc)
        else:
            text = content.decode("utf-8", errors="replace")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not read this file: {e}")
    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=422, detail="No text found in this file (scanned PDFs are not supported here).")
    doc = KnowledgeDoc(teacher_id=user.id, sub_domain=subDomain, file_name=name,
                       size_kb=max(1, round(len(content) / 1024)), chunks_json=json.dumps(chunks))
    db.add(doc)
    db.commit()
    return doc_dict(doc)


@router.delete("/knowledge-base/{doc_id}")
def delete_doc(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = db.get(KnowledgeDoc, doc_id)
    if doc is None or doc.teacher_id != user.id:
        raise HTTPException(status_code=404, detail="Document not found.")
    db.delete(doc)
    db.commit()
    return {"ok": True}
