import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Integer, String, Float, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ai_exam_system.database import Base


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class User(Base):
    __tablename__ = "users"

    id = Column(String(32), primary_key=True, default=new_id)
    name = Column(String(120), nullable=False)
    email = Column(String(200), unique=True, index=True, nullable=False)
    password_hash = Column(String(300), nullable=False)
    role = Column(String(20), nullable=False, default="teacher")
    created_at = Column(String(40), default=now_iso)


class Klass(Base):
    """A teacher's class for one sub-domain; holds the roster."""
    __tablename__ = "classes"

    id = Column(String(32), primary_key=True, default=new_id)
    teacher_id = Column(String(32), ForeignKey("users.id"), index=True)
    sub_domain = Column(String(120), nullable=False)

    students = relationship("RosterStudent", cascade="all, delete-orphan")


class RosterStudent(Base):
    __tablename__ = "roster_students"

    id = Column(String(32), primary_key=True, default=new_id)
    class_id = Column(String(32), ForeignKey("classes.id"), index=True)
    name = Column(String(120), nullable=False)
    roll_number = Column(String(50), nullable=False)


class Exam(Base):
    __tablename__ = "exams"

    id = Column(String(32), primary_key=True, default=new_id)
    teacher_id = Column(String(32), ForeignKey("users.id"), index=True)
    class_id = Column(String(32), ForeignKey("classes.id"))
    title = Column(String(200), nullable=False)
    subject = Column(String(200), nullable=False)
    sub_domain = Column(String(120), nullable=False)
    total_marks = Column(Float, nullable=False)
    num_questions = Column(Integer, default=0)
    status = Column(String(20), default="draft")  # draft | published
    answer_key_file = Column(String(300))
    created_at = Column(String(40), default=now_iso)
    published_at = Column(String(40))

    questions = relationship("Question", cascade="all, delete-orphan", order_by="Question.number")


class Question(Base):
    __tablename__ = "questions"

    id = Column(String(32), primary_key=True, default=new_id)
    exam_id = Column(String(32), ForeignKey("exams.id"), index=True)
    number = Column(Integer, nullable=False)
    type = Column(String(20), default="subjective")  # objective | subjective
    text = Column(Text, default="")
    reference_answer = Column(Text, default="")
    marks = Column(Float, default=1)
    extraction_confidence = Column(Float)


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(String(32), primary_key=True, default=new_id)
    exam_id = Column(String(32), ForeignKey("exams.id"), index=True)
    roster_student_id = Column(String(32))
    student_name = Column(String(120))
    usn = Column(String(50), index=True)
    submitted_at = Column(String(40), default=now_iso)
    pages = Column(Integer, default=0)
    status = Column(String(20), default="processing")  # processing | graded
    stage = Column(String(20), default="ocr")
    error = Column(Text)
    files_json = Column(Text, default="[]")  # saved page image paths

    answers = relationship("AnswerRow", cascade="all, delete-orphan")


class AnswerRow(Base):
    __tablename__ = "answers"

    id = Column(String(40), primary_key=True, default=new_id)
    submission_id = Column(String(32), ForeignKey("submissions.id"), index=True)
    question_id = Column(String(32))
    ocr_text = Column(Text, default="")
    ai_score = Column(Float, default=0)
    confidence = Column(Float, default=0.6)
    relevance = Column(Float, default=1.0)
    justification = Column(Text)
    flagged_reason = Column(String(40))
    override_score = Column(Float)
    override_reason = Column(Text)
    override_by = Column(String(120))
    override_at = Column(String(40))
    reviewed = Column(Boolean, default=False)


class KnowledgeDoc(Base):
    __tablename__ = "knowledge_docs"

    id = Column(String(32), primary_key=True, default=new_id)
    teacher_id = Column(String(32), ForeignKey("users.id"), index=True)
    sub_domain = Column(String(120), index=True)
    file_name = Column(String(300))
    size_kb = Column(Integer)
    chunks_json = Column(Text, default="[]")
    uploaded_at = Column(String(40), default=now_iso)


class Result(Base):
    __tablename__ = "results"

    id = Column(Integer, primary_key=True, index=True)
    roll_number = Column(String(50), index=True)
    student_answers = Column(Text)
    evaluation = Column(Text)
    confidence = Column(String(20))
    final_score = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
