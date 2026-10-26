import httpx

OLLAMA_URL = "http://localhost:11434/api/generate"


async def generate(model: str, prompt: str, images: list[str] | None = None, timeout: float = 1800,
                   num_ctx: int = 8192) -> str:
    """Sends a prompt (and optional base64 images) to a local Ollama model and returns the text response."""
    # Ollama's default 4096-token context is too small for multi-page answer sheets.
    payload = {"model": model, "prompt": prompt, "stream": False, "options": {"num_ctx": num_ctx}}
    if images:
        payload["images"] = images

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(OLLAMA_URL, json=payload)
        response.raise_for_status()
        return response.json().get("response", "")
