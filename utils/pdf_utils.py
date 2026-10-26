import os

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


def save_images(images: list[Image.Image], output_dir: str, prefix: str = "page") -> list[str]:
    """Saves images as <prefix>_<n>.jpg in output_dir and returns their paths."""
    os.makedirs(output_dir, exist_ok=True)
    paths = []
    for i, img in enumerate(images, start=1):
        path = os.path.join(output_dir, f"{prefix}_{i}.jpg")
        img.convert("RGB").save(path, format="JPEG")
        paths.append(path)
    return paths
