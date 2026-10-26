import os
import shutil
from typing import Optional
from fastapi import FastAPI, Depends, File, UploadFile, Form, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
import logging

from ai_exam_system.database import engine, get_db, Base
from ai_exam_system.models import Result
from ai_exam_system.crew import run_pipeline
from ai_exam_system.grader import mark_interrupted
from ai_exam_system.routes_core import router as core_router
from ai_exam_system.routes_submissions import router as submissions_router
from utils.pdf_utils import pdf_to_images, save_images

import aiofiles

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="AI Exam Assessment System")
app.include_router(core_router)
app.include_router(submissions_router)
mark_interrupted()

# Setup static and templates
os.makedirs("static", exist_ok=True)
os.makedirs("templates", exist_ok=True)
os.makedirs("data/input", exist_ok=True)
os.makedirs("data/output", exist_ok=True)

try:
    app.mount("/static", StaticFiles(directory="static"), name="static")
except Exception as e:
    logger.warning("Static directory mount failed (might be empty).")

templates = Jinja2Templates(directory="templates")

@app.get("/", response_class=HTMLResponse)
async def read_index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.post("/evaluate")
async def evaluate_exam(
    roll_number: str = Form(...),
    max_marks: float = Form(...),
    answer_sheet: UploadFile = File(...),
    answer_key_text: str = Form(""),
    answer_key_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    logger.info(f"Received evaluation request for roll_number: {roll_number}")
    
    if not answer_key_text and not answer_key_file:
        raise HTTPException(status_code=400, detail="Must provide either answer_key_text or answer_key_file")

    base_dir = f"data/input/{roll_number}"
    os.makedirs(base_dir, exist_ok=True)

    # 1. Process Answer Sheet
    file_path = os.path.join(base_dir, answer_sheet.filename)
    async with aiofiles.open(file_path, 'wb') as out_file:
        content = await answer_sheet.read()
        await out_file.write(content)

    image_paths = []
    if file_path.lower().endswith('.pdf'):
        try:
            images = pdf_to_images(file_path)
            image_paths = save_images(images, base_dir, prefix="answer")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"PDF conversion failed: {e}")
    elif file_path.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.heic', '.bmp')):
        image_paths = [file_path]
    else:
        raise HTTPException(status_code=400, detail="Unsupported answer sheet format. Use PDF or images (.png, .jpg, .webp).")

    # 2. Process Answer Key
    raw_answer_key = answer_key_text
    if answer_key_file and answer_key_file.filename:
        key_path = os.path.join(base_dir, f"key_{answer_key_file.filename}")
        async with aiofiles.open(key_path, 'wb') as out_file:
            content = await answer_key_file.read()
            await out_file.write(content)
        
        # Support proper text extraction for PDF Answer Keys:
        try:
            if key_path.lower().endswith('.pdf'):
                import fitz # PyMuPDF
                with fitz.open(key_path) as doc:
                    for page in doc:
                        raw_answer_key += "\n" + page.get_text()
            else:
                with open(key_path, 'r', encoding='utf-8') as f:
                    raw_answer_key += "\n" + f.read()
        except Exception as e:
            logger.warning(f"Failed extracting text from key file: {e}")
            if not raw_answer_key.strip():
                raise HTTPException(status_code=400, detail="Could not extract text from the Answer Key file. Please ensure it's a PDF or text file, or just use the text box.")

    if not raw_answer_key.strip():
        raise HTTPException(status_code=400, detail="Answer key content is empty.")

    # 3. Run AI Pipeline
    try:
        pipeline_result = await run_pipeline(image_paths, raw_answer_key, max_marks)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Pipeline failed: {str(e)}")

    # 4. Save to Database
    db_result = Result(
        roll_number=roll_number,
        student_answers=pipeline_result["student_answers"],
        evaluation=pipeline_result["evaluation"],
        confidence=pipeline_result["confidence"],
        final_score=pipeline_result["final_score"]
    )
    db.add(db_result)
    db.commit()
    db.refresh(db_result)

    # 5. Return result
    return {
        "success": True,
        "roll_number": roll_number,
        "final_score": pipeline_result["final_score"],
        "max_marks": max_marks,
        "confidence": pipeline_result["confidence"],
        "details": {
            "obtained_raw": pipeline_result["obtained"],
            "possible_raw": pipeline_result["possible"]
        }
    }

@app.get("/results")
async def get_results(db: Session = Depends(get_db)):
    """Fetch all evaluate results."""
    results = db.query(Result).order_by(Result.created_at.desc()).all()
    return results
