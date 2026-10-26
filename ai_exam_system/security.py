import base64
import hashlib
import hmac
import os
import secrets
import time

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ai_exam_system.database import get_db
from ai_exam_system.models import User

TOKEN_TTL_SECONDS = 7 * 24 * 3600
_SECRET_PATH = os.path.join("data", "secret.key")


def _secret() -> bytes:
    os.makedirs("data", exist_ok=True)
    if not os.path.exists(_SECRET_PATH):
        with open(_SECRET_PATH, "wb") as f:
            f.write(secrets.token_bytes(32))
    with open(_SECRET_PATH, "rb") as f:
        return f.read()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 200_000)
    return hmac.compare_digest(digest.hex(), digest_hex)


def make_token(user_id: str) -> str:
    payload = f"{user_id}.{int(time.time()) + TOKEN_TTL_SECONDS}"
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}.{sig}".encode()).decode()


def _read_token(token: str) -> str | None:
    try:
        user_id, expires, sig = base64.urlsafe_b64decode(token.encode()).decode().rsplit(".", 2)
    except Exception:
        return None
    expected = hmac.new(_secret(), f"{user_id}.{expires}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected) or int(expires) < time.time():
        return None
    return user_id


def current_user(authorization: str = Header(default=""), db: Session = Depends(get_db)) -> User:
    token = authorization.removeprefix("Bearer ").strip()
    user_id = _read_token(token) if token else None
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status_code=401, detail="Please sign in again.")
    return user


