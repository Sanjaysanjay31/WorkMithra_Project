from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from typing import Dict, Any, Optional
import jwt as pyjwt
import bcrypt
import os
from dotenv import load_dotenv

load_dotenv()

_jwt_secret: str = os.getenv("JWT_SECRET", "")
if not _jwt_secret:
	raise RuntimeError(
		"JWT_SECRET is not set in backend/.env. "
		"Generate one: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
	)

JWT_SECRET = _jwt_secret
JWT_ALGORITHM = "HS256"

_bearer_scheme = HTTPBearer(auto_error=False)

# bcrypt only hashes the first 72 bytes of a password — anything beyond that
# is silently ignored, so two passwords sharing the first 72 bytes would
# verify identically. Reject longer passwords outright instead.
BCRYPT_MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    if len(password.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        raise ValueError("Password is too long (max 72 bytes)")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        # Malformed stored hash (e.g. legacy/OTP-only row) — treat as a
        # verification failure rather than a 500.
        return False


def create_access_token(user_id: int, role: str, expires_days: int = 7) -> str:
	from datetime import datetime, timedelta
	payload = {
		"sub": str(user_id),
		"role": role,
		"exp": datetime.utcnow() + timedelta(days=expires_days),
		"iat": datetime.utcnow(),
	}
	return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_reset_token(email: str, expires_minutes: int = 15) -> str:
	"""Short-lived single-purpose token issued after a successful OTP verify.
	Required by /reset-password so a reset can't happen without proving
	control of the email inbox."""
	from datetime import datetime, timedelta
	payload = {
		"sub": email.lower(),
		"purpose": "password_reset",
		"exp": datetime.utcnow() + timedelta(minutes=expires_minutes),
		"iat": datetime.utcnow(),
	}
	return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_reset_token(token: str) -> Optional[Dict[str, Any]]:
	"""Returns the payload only for a valid, unexpired password_reset token."""
	try:
		payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
	except pyjwt.PyJWTError:
		return None
	if payload.get("purpose") != "password_reset":
		return None
	return payload


def _decode_token(token: str) -> Dict[str, Any]:
	try:
		payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
	except pyjwt.ExpiredSignatureError:
		raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
	except pyjwt.InvalidTokenError:
		raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
	# Single-purpose tokens (e.g. password reset) must never work as sessions.
	if payload.get("purpose") is not None:
		raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
	return payload


def decode_token_safe(token: str) -> Optional[Dict[str, Any]]:
	"""Non-raising variant for contexts without HTTP (e.g. Socket.IO handshake)."""
	try:
		return pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
	except pyjwt.PyJWTError:
		return None


async def get_current_user(
	credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> Dict[str, Any]:
	if not credentials:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Authorization header missing",
		)
	return _decode_token(credentials.credentials)


def require_role(*roles: str):
	"""Dependency factory: returns a dependency that checks the user's role."""
	async def _check(current: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
		if current.get("role") not in roles:
			raise HTTPException(
				status_code=status.HTTP_403_FORBIDDEN,
				detail=f"Requires role: {', '.join(roles)}",
			)
		return current
	return _check
