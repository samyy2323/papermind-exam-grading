import httpx

OLLAMA_URL = "http://localhost:11434/api/generate"


async def generate(model: str, prompt: str, images: list[str] | None = None, timeout: float = 1800,
                   num_ctx: int = 8192, json_schema: dict | None = None, num_predict: int | None = None) -> str:
    """Sends a prompt (and optional base64 images) to a local Ollama model and returns the text response.

    json_schema forces the reply to be JSON of that shape, which also makes the model stop when the JSON is
    complete. num_predict caps the reply length: on a CPU every extra token costs about 0.3 seconds, so an
    unbounded reply can cost many minutes.
    """
    # Ollama's default 4096-token context is too small for multi-page answer sheets.
    options = {"num_ctx": num_ctx}
    if num_predict:
        options["num_predict"] = num_predict
    payload = {"model": model, "prompt": prompt, "stream": False, "options": options}
    if json_schema:
        payload["format"] = json_schema
    if images:
        payload["images"] = images

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(OLLAMA_URL, json=payload)
        response.raise_for_status()
        return response.json().get("response", "")
