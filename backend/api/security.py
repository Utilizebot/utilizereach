"""
Security helpers

Local JWT (HS256) encoding/decoding and bcrypt password hashing.
Replaces Supabase Auth.
"""

import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
import jwt

JWT_ALGORITHM = "HS256"

# Persisted auto-generated secret (config volume in Docker, backend dir locally)
_SECRET_FILE = Path("/app/config/.jwt_secret") if os.path.exists("/app") \
    else Path(__file__).resolve().parent.parent / ".jwt_secret"
_cached_secret: str = ""


def get_jwt_secret() -> str:
    """JWT signing secret: env var if set, else a generated secret persisted
    across restarts. Empty env values (docker-compose defaults) are ignored."""
    global _cached_secret
    env_secret = os.getenv("JWT_SECRET") or ""
    if env_secret.strip():
        return env_secret.strip()
    if _cached_secret:
        return _cached_secret
    try:
        if _SECRET_FILE.exists():
            _cached_secret = _SECRET_FILE.read_text().strip()
        if not _cached_secret:
            _cached_secret = secrets.token_urlsafe(48)
            _SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
            _SECRET_FILE.write_text(_cached_secret)
            _SECRET_FILE.chmod(0o600)
    except OSError:
        # Last resort (read-only filesystem): stable only within this process
        if not _cached_secret:
            _cached_secret = secrets.token_urlsafe(48)
    return _cached_secret


def get_jwt_expires_days() -> int:
    try:
        return int(os.getenv("JWT_EXPIRES_DAYS", "7"))
    except ValueError:
        return 7


def create_access_token(user_id: str, email: str, role: str) -> str:
    """Create a signed JWT for a sales rep."""
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=get_jwt_expires_days()),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decode and verify a JWT. Raises jwt.PyJWTError on invalid/expired tokens."""
    return jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Check a plaintext password against a bcrypt hash."""
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False
