from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from typing import Dict, Any, Optional
import jwt as pyjwt
import bcrypt
import hashlib
import os
from dotenv import load_dotenv

# database.py has no dependency on auth, so this import is safe (no cycle)
# and lets get_current_user validate every token against the DB.
import database

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


def create_access_token(user_id: int, role: str, expires_days: int = 7, token_version: int = 0) -> str:
	from datetime import datetime, timedelta
	payload = {
		"sub": str(user_id),
		"role": role,
		# Revocation anchor: password change/reset bumps the account's
		# token_version and every token with an older "tv" stops working.
		"tv": int(token_version or 0),
		"exp": datetime.utcnow() + timedelta(days=expires_days),
		"iat": datetime.utcnow(),
	}
	return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def hash_reset_jti(jti: str) -> str:
	"""Store only a digest of the reset token id on the user row."""
	return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def create_reset_token(email: str, jti: str, expires_minutes: int = 15) -> str:
	"""Short-lived single-purpose token issued after a successful OTP verify.
	Required by /reset-password so a reset can't happen without proving
	control of the email inbox. The jti is recorded on the user row so the
	token can only be used once (and only the latest issued one works)."""
	from datetime import datetime, timedelta
	payload = {
		"sub": email.lower(),
		"purpose": "password_reset",
		"jti": jti,
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


# ---------------------------------------------------------------------------
# Email-verification tokens (registration).
#
# /verify-otp issues one of these after the OTP is accepted. /register
# requires it, so an account can't be created without proving control of the
# email inbox. The token is single-purpose (purpose="email_verify") so it can
# never be reused as a password-reset or session token, and single-use: the
# caller records the jti on the pending-verification row and consumes it.
# ---------------------------------------------------------------------------
_EMAIL_VERIFY_PURPOSE = "email_verify"


def create_email_verify_token(email: str, jti: str, expires_minutes: int = 10) -> str:
    """Short-lived token proving the OTP for this email was accepted."""
    from datetime import datetime, timedelta
    payload = {
        "sub": email.lower(),
        "purpose": "email_verify",
        "jti": jti,
        "exp": datetime.utcnow() + timedelta(minutes=expires_minutes),
        "iat": datetime.utcnow(),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_email_verify_token(token: str) -> Optional[Dict[str, Any]]:
    """Returns the payload only for a valid, unexpired email_verify token."""
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except pyjwt.PyJWTError:
        return None
    if payload.get("purpose") != "email_verify":
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


def _account_for_token(db, payload: Dict[str, Any]):
	"""Load the account a token refers to, or None when it no longer exists.

	Users and workers live in separate tables with overlapping ids, so the
	role claim decides which table to consult."""
	import models
	try:
		uid = int(payload.get("sub"))
	except (TypeError, ValueError):
		return None
	role = payload.get("role", "user")
	model = models.Worker if role == "worker" else models.User
	return db.query(model).filter(model.id == uid).first()


def validate_session(db, payload: Dict[str, Any]) -> None:
	"""Enforce what a signature check alone cannot: the account must still
	exist, must not be deactivated, and the token must not predate the last
	password change/reset (token_version bump). Raises 401 otherwise."""
	account = _account_for_token(db, payload)
	if account is None:
		raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found")
	if getattr(account, "is_active", True) is False:
		raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")
	current_version = getattr(account, "token_version", 0) or 0
	token_version = payload.get("tv", 0)
	try:
		token_version = int(token_version)
	except (TypeError, ValueError):
		token_version = 0
	if token_version < current_version:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Session expired — please log in again",
		)


# Sync on purpose: validate_session() does blocking DB work, and FastAPI runs
# sync dependencies in a worker thread. As `async def` this would execute on
# the event loop and stall every other request for the DB round-trip.
def get_current_user(
	credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
	db=Depends(database.get_db),
) -> Dict[str, Any]:
	if not credentials:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Authorization header missing",
		)
	payload = _decode_token(credentials.credentials)
	validate_session(db, payload)
	return payload


def require_role(*roles: str):
	"""Dependency factory: returns a dependency that checks the user's role."""
	def _check(current: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
		if current.get("role") not in roles:
			raise HTTPException(
				status_code=status.HTTP_403_FORBIDDEN,
				detail=f"Requires role: {', '.join(roles)}",
			)
		return current
	return _check
