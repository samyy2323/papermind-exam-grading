import os
import shutil

import pymupdf
from PIL import Image


def pdf_to_images(pdf_path: str, dpi: int = 150) -> list[Image.Image]:
    """Renders each page of a PDF to a PIL image using PyMuPDF."""
    images = []
    with pymupdf.open(pdf_path) as doc:
        for page in doc:
            pix = page.get_pixmap(dpi=dpi)
            images.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    return images


def build_sheet_pdf(sources: list[str], out_path: str) -> None:
    """Merges uploaded PDFs and photos, in order, into one PDF for the teacher. A single PDF is kept as it is."""
    if len(sources) == 1 and sources[0].lower().endswith(".pdf"):
        shutil.copyfile(sources[0], out_path)
        return
    doc = pymupdf.open()
    try:
        for path in sources:
            if path.lower().endswith(".pdf"):
                with pymupdf.open(path) as src:
                    doc.insert_pdf(src)
            else:
                with pymupdf.open(path) as img:
                    rect = img[0].rect
                    width = 595  # A4 width in points; the height keeps the photo's proportions
                    page = doc.new_page(width=width, height=rect.height * width / rect.width)
                    page.insert_image(page.rect, filename=path)
        doc.save(out_path, garbage=3, deflate=True)
    finally:
        doc.close()


def save_images(images: list[Image.Image], output_dir: str, prefix: str = "page") -> list[str]:
    """Saves images as <prefix>_<n>.jpg in output_dir and returns their paths."""
    os.makedirs(output_dir, exist_ok=True)
    paths = []
    for i, img in enumerate(images, start=1):
        path = os.path.join(output_dir, f"{prefix}_{i}.jpg")
        img.convert("RGB").save(path, format="JPEG")
        paths.append(path)
    return paths
