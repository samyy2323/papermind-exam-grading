from utils.ollama_client import generate
import base64
import logging
import re
from PIL import Image
import io

logger = logging.getLogger(__name__)

# Reading all pages in one request made the model tidy the answers into a 1, 2, 3 sequence and skip some, so
# every page is read on its own, with an explicit instruction to copy the numbers the student wrote.
PAGE_PROMPT = (
    "Transcribe the handwriting on this exam answer page exactly as written, from top to bottom. "
    "Start each answer on a new line that begins with the SAME question number written on the page (for example '29.'). "
    "Copy the numbers exactly: do not renumber, reorder, merge, skip or invent anything, even if the numbers are not in sequence. "
    "If the page has two columns (for example answers 1-10 on the left and 11-20 on the right), read the whole left column "
    "first, then the whole right column. Write only what is actually handwritten: never write exam questions, never "
    "make up text, and if the page has no readable handwriting output nothing. "
    "Write [?] for a word you cannot read. Output only the transcription."
)


_CHOICE_LINE = re.compile(r"(?m)^[ \t]*(\d{1,3})[ \t]*[\.\)][ \t]*\(?([A-Da-d])\)?[ \t]*$")
_COLUMN_PROMPT = (
    "These are handwritten multiple-choice answers, one per line like '1. B'. Write every line you can see, "
    "in order from top to bottom, and nothing else."
)


def _encode(path: str, right_part: bool = False, size: int = 768) -> str:
    with Image.open(path) as img:
        # Convert to RGB and shrink to save memory/tokens (768 px was enough to read the numbers correctly)
        img = img.convert("RGB")
        if right_part:  # the right-hand column of a two-column answer list
            w, h = img.size
            img = img.crop((int(w * 0.45), 0, w, int(h * 0.6)))
        img.thumbnail((size, size))
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=90)
        return base64.b64encode(buffer.getvalue()).decode("utf-8")


async def _right_column(path: str, text: str) -> str:
    """
    The 3B model often reads only the left column of a two-column MCQ list (1-10 on the left, 11-20 on the right).
    When a page has a list of letter answers that stops at a short run, the right-hand part is read again on its own
    and its lines are numbered on from where the left column ended.
    """
    left = [int(m.group(1)) for m in _CHOICE_LINE.finditer(text)]
    if len(left) < 5 or max(left) > 12:
        return ""
    try:
        right = await generate(model="qwen2.5vl:3b", prompt=_COLUMN_PROMPT, images=[_encode(path, right_part=True)], num_predict=200)
    except Exception as e:
        logger.warning(f"Right-column read failed: {e}")
        return ""
    letters = [m.group(2).upper() for m in _CHOICE_LINE.finditer(right)]
    if len(letters) < 5:
        return ""
    start = max(left)
    logger.info(f"Right column: {len(letters)} answers numbered {start + 1}-{start + len(letters)}")
    return "\n" + "\n".join(f"{start + k}. {c}" for k, c in enumerate(letters, 1))


async def extract_handwritten_text(image_paths: list[str]) -> str:
    """The text of every page, joined in order."""
    return "\n\n".join(p for p in await extract_page_texts(image_paths) if p)


async def extract_page_texts(image_paths: list[str]) -> list[str]:
    """
    Extracts handwritten text from a list of page images using Qwen2.5-VL, one page per request.
    Returns one string per page (empty if nothing was read) so that a question can be traced to its page.
    """
    logger.info(f"Extracting text from {len(image_paths)} images using qwen2.5vl:3b (one page at a time)")

    pages = []
    for i, path in enumerate(image_paths, start=1):
        try:
            encoded = _encode(path)
        except Exception as e:
            logger.error(f"Error encoding image {path}: {e}")
            raise
        try:
            # The cap stops a runaway reply; a page of dense writing is well under 1,500 tokens.
            text = await generate(model="qwen2.5vl:3b", prompt=PAGE_PROMPT, images=[encoded], num_predict=1800)
        except Exception as e:
            logger.error(f"Extraction failed on page {i}: {e}")
            raise
        logger.info(f"Page {i}/{len(image_paths)} read: {len(text)} characters")
        text = text.strip()
        text += await _right_column(path, text)
        pages.append(text)
    return pages
