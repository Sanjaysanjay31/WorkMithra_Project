import os
import time
from dotenv import load_dotenv

load_dotenv()

# Fail fast on missing critical secrets — before the DB engine or routers load.
if not os.getenv("JWT_SECRET"):
    raise RuntimeError(
        "JWT_SECRET is not set in backend/.env. "
        "Generate one: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )

from fastapi import FastAPI, Depends, HTTPException, Request, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Dict, Any
import models, schemas, database
from database import engine, get_db
from auth import get_current_user, create_access_token, hash_password, verify_password
import requests as _requests_storage

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

# Create tables
models.Base.metadata.create_all(bind=engine)

# create_all() only creates missing tables — it never alters existing ones, so
# indexes added to models later must be applied explicitly. IF NOT EXISTS
# keeps this idempotent on both Postgres and SQLite.
_INDEX_DDL = (
    "CREATE INDEX IF NOT EXISTS ix_bookings_user_created ON bookings (user_id, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_bookings_worker_created ON bookings (worker_id, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_bookings_status ON bookings (status)",
    "CREATE INDEX IF NOT EXISTS ix_chat_messages_sender_sent ON chat_messages (sender_id, sent_at)",
    "CREATE INDEX IF NOT EXISTS ix_chat_messages_receiver_sent ON chat_messages (receiver_id, sent_at)",
    "CREATE INDEX IF NOT EXISTS ix_workers_city ON workers (city)",
    "CREATE INDEX IF NOT EXISTS ix_workers_skill ON workers (skill)",
)
try:
    with engine.begin() as _conn:
        from sqlalchemy import text as _sql_text
        for _ddl in _INDEX_DDL:
            _conn.execute(_sql_text(_ddl))
except Exception as _e:
    print("index creation skipped:", _e)

# One-time cleanup: drop the old assistant_* tables (no longer used).
try:
    with engine.begin() as _conn:
        from sqlalchemy import text as _sql_text
        _conn.execute(_sql_text("DROP TABLE IF EXISTS assistant_messages CASCADE"))
        _conn.execute(_sql_text("DROP TABLE IF EXISTS assistant_sessions CASCADE"))
except Exception as _e:
    print("assistant table cleanup skipped:", _e)

# One-time: chat_messages.sender_id/receiver_id reference users(id) but in this
# app a participant can be either a user OR a worker (separate tables), so the
# FK needs to be dropped to allow both id spaces.
try:
    with engine.begin() as _conn:
        from sqlalchemy import text as _sql_text
        _conn.execute(_sql_text("ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_sender_id_fkey"))
        _conn.execute(_sql_text("ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_receiver_id_fkey"))
        print("chat_messages FK constraints dropped (or already absent)")
except Exception as _e:
    print("chat_messages FK cleanup skipped:", _e)

# One-time: notifications.user_id references users(id), but a notification's
# recipient can be a user OR a worker (separate tables with overlapping
# ids). Drop the FK so worker recipients don't raise an IntegrityError.
try:
    with engine.begin() as _conn:
        from sqlalchemy import text as _sql_text
        _conn.execute(_sql_text("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey"))
        print("notifications.user_id FK constraint dropped (or already absent)")
except Exception as _e:
    print("notifications FK cleanup skipped:", _e)

app = FastAPI()

# Add CORS Middleware
# Origins come from ALLOWED_ORIGINS in backend/.env (comma-separated) so
# production enumerates exactly which web origins may call the API. When the
# variable is missing we fall back to the local dev origins — NEVER a
# wildcard, so a misconfigured deploy fails closed instead of opening to all.
# NOTE: allow_origins=["*"] and allow_credentials=True cannot be combined —
# browsers reject the preflight response. We use bearer tokens in headers
# (not cookies), so credentials stay off.
_DEV_ORIGINS = [
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:19006",
    "http://localhost:3000",
]
_origins_csv = os.getenv("ALLOWED_ORIGINS", "").strip()
ALLOWED_ORIGINS = [o.strip() for o in _origins_csv.split(",") if o.strip()] or _DEV_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,   # set True only if you use httpOnly cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting (in-memory, per client IP) for abuse-prone auth endpoints.
# Set RATE_LIMITING=0 in backend/.env or tests to disable.
limiter = Limiter(
    key_func=get_remote_address,
    enabled=os.getenv("RATE_LIMITING", "1") not in ("0", "false", "False"),
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Include routers (keeps main.py small)
from routers.workers import router as workers_router
from routers.bookings import router as bookings_router
from routers.profiles import router as profiles_router
from routers.chat import router as chat_router
from routers.ai import router as ai_router
from routers.reviews import router as reviews_router
from routers.notifications import router as notifications_router
from routers.services import router as services_router
from routers.worker_services import router as worker_services_router
from routers.availability import router as availability_router
from routers.job_history import router as job_history_router
from routers.assistant import router as assistant_router

app.include_router(workers_router, prefix="/workers", tags=["workers"])
app.include_router(bookings_router, prefix="/bookings", tags=["bookings"])
app.include_router(profiles_router, prefix="/profiles", tags=["profiles"])
app.include_router(chat_router, prefix="/chat", tags=["chat"])
app.include_router(ai_router, prefix="/ai", tags=["ai"])
app.include_router(reviews_router, prefix="/reviews", tags=["reviews"])
app.include_router(notifications_router, prefix="/notifications", tags=["notifications"])
app.include_router(services_router, prefix="/services", tags=["services"])
app.include_router(worker_services_router, prefix="/worker-services", tags=["worker_services"])
app.include_router(availability_router, prefix="/availability", tags=["availability"])
app.include_router(job_history_router, prefix="/job-history", tags=["job_history"])
app.include_router(assistant_router, prefix="/assistant", tags=["assistant"])

import requests as _requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET_NAME", "all_images")


@app.get("/health")
def health(db: Session = Depends(get_db)):
    """Liveness/readiness probe for load balancers and monitoring.
    Returns 200 when the API and database are reachable, 503 otherwise.
    The raw DB error is logged server-side but NOT returned to the client,
    so connection strings / driver details never leak."""
    from sqlalchemy import text as _sql_text
    try:
        db.execute(_sql_text("SELECT 1"))
        return {"status": "ok", "database": "up"}
    except Exception as e:
        print(f"[health] database check failed: {e}")
        raise HTTPException(status_code=503, detail={"status": "degraded", "database": "down"})

@app.post("/send-otp")
@limiter.limit("5/minute")
def send_otp(request: Request, data: schemas.OTPRequest):
    """Send an OTP email via Supabase Auth."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    try:
        r = _requests.post(
            f"{SUPABASE_URL}/auth/v1/otp",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
            },
            json={"email": data.email, "create_user": True},
            timeout=20,
        )
        if r.status_code >= 400:
            raise HTTPException(status_code=400, detail=r.json().get("msg") or r.text)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to send OTP: {e}")
    return {"message": "OTP sent successfully"}


@app.post("/verify-otp")
@limiter.limit("10/minute")
def verify_otp(request: Request, data: schemas.OTPVerify):
    """Verify the OTP via Supabase Auth."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    try:
        r = _requests.post(
            f"{SUPABASE_URL}/auth/v1/verify",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
            },
            json={"email": data.email, "token": data.otp, "type": "email"},
            timeout=20,
        )
        if r.status_code >= 400:
            body = {}
            try: body = r.json()
            except Exception: pass
            raise HTTPException(status_code=400, detail=body.get("msg") or body.get("error_description") or r.text)
        # Issue a short-lived reset token so /reset-password can only be used
        # by whoever just proved control of this email inbox via the OTP.
        from auth import create_reset_token
        # Only echo back the email we already know — never the full Supabase
        # user object (it can carry internal metadata/identifiers).
        return {
            "message": "OTP verified",
            "reset_token": create_reset_token(data.email),
            "email": data.email,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to verify OTP: {e}")


@app.post("/change-password")
def change_password(
    data: schemas.PasswordChange,
    db: Session = Depends(get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Change password using the current password for verification.
    The account being changed must belong to the authenticated token."""
    try:
        uid = int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")

    if current.get("role") == "worker":
        user = db.query(models.Worker).filter(models.Worker.id == uid).first()
    else:
        user = db.query(models.User).filter(models.User.id == uid).first()

    if not user:
        raise HTTPException(status_code=404, detail="No account found for this token")
    if user.email and data.email and user.email.lower() != data.email.lower():
        raise HTTPException(status_code=403, detail="Email does not match the logged-in account")
    if not verify_password(data.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.hashed_password = hash_password(data.new_password)
    db.commit()
    return {"message": "Password updated successfully"}


@app.post("/upload-profile-image")
async def upload_profile_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Upload an avatar to Supabase Storage (bucket: all_images) and save URL on the row.
    The target user/worker always comes from the authenticated token."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    try:
        uid = int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")
    role = current.get("role", "user")

    # Only accept images, and cap the size so a huge body can't exhaust memory.
    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are allowed")
    MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too larger than 5 MB")

    import re as _re
    base_name = (file.filename or "image").rsplit("/", 1)[-1]
    safe_name = _re.sub(r"[^A-Za-z0-9._-]", "_", base_name) or "image"
    path = f"{role}_{uid}/{int(time.time())}_{safe_name}"
    try:
        # requests is blocking — run it in a worker thread so the event loop
        # (and other clients) aren't stalled for the duration of the upload.
        import asyncio as _asyncio
        r = await _asyncio.to_thread(
            _requests_storage.post,
            f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{path}",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=content,
            timeout=30,
        )
        if r.status_code >= 400:
            print(f"[Supabase upload] {r.status_code} {r.text}")
            err = r.text[:500]
            try:
                j = r.json()
                err = j.get("message") or j.get("error") or err
            except Exception:
                pass
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Supabase storage rejected upload ({r.status_code}): {err}. "
                    f"Check: (1) bucket '{SUPABASE_BUCKET}' exists, (2) it is PUBLIC, "
                    f"(3) an INSERT policy allows the anon role to upload."
                ),
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upload failed: {e}")

    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{path}"

    # Best-effort: persist URL ONLY on the table the caller belongs to.
    # users and workers are separate tables with overlapping id space, so we
    # must use `role` to disambiguate — otherwise a user upload would also
    # overwrite the worker row that happens to share the same numeric id.
    try:
        if role == 'worker':
            w = db.query(models.Worker).filter(models.Worker.id == uid).first()
            if w:
                w.profile_image = public_url
                db.commit()
        else:
            u = db.query(models.User).filter(models.User.id == uid).first()
            if u:
                u.profile_image = public_url
                db.commit()
    except Exception as persist_err:
        # The upload succeeded but saving the URL failed — surface it instead of
        # silently returning a URL that was never persisted.
        print(f"[upload-profile-image] failed to persist URL: {persist_err}")
        db.rollback()

    return {"url": public_url, "path": path}


@app.post("/reset-password")
@limiter.limit("5/minute")
def reset_password(request: Request, data: schemas.PasswordReset, db: Session = Depends(get_db)):
    """Reset a user's password. Requires the reset_token issued by /verify-otp —
    without a verified OTP the reset is rejected."""
    from auth import decode_reset_token

    if not data.otp_token:
        raise HTTPException(status_code=400, detail="OTP verification required — verify the OTP first")

    payload = decode_reset_token(data.otp_token)
    if payload is None:
        raise HTTPException(status_code=400, detail="Reset link expired or invalid — request a new OTP")

    token_email = str(payload.get("sub", "")).lower()
    if token_email != data.email.lower():
        raise HTTPException(status_code=400, detail="This reset token was issued for a different email")

    user = db.query(models.User).filter(models.User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found for this email")
    user.hashed_password = hash_password(data.password)
    db.commit()
    return {"message": "Password reset successful"}


@app.post("/register", response_model=schemas.WorkerCreateResponse)
@limiter.limit("5/minute")
def register(request: Request, user: schemas.UserCreate, db: Session = Depends(get_db)):
    """Register a new user. The role field determines whether a User or Worker
    row is created. Both return the same response shape so the client can
    handle either role with one code path."""
    role = getattr(user, "role", "user")

    if role == "worker":
        db_worker = db.query(models.Worker).filter(
            or_(models.Worker.email == user.email, models.Worker.phone == user.phone)
        ).first()
        if db_worker:
            raise HTTPException(status_code=400, detail="Email or Phone already registered as worker")

        hashed_password = hash_password(user.password)
        new_worker = models.Worker(
            full_name=user.full_name,
            phone=user.phone,
            email=user.email,
            hashed_password=hashed_password,
        )
        db.add(new_worker)
        db.commit()
        db.refresh(new_worker)
        return {
            "id": new_worker.id,
            "full_name": new_worker.full_name,
            "phone": new_worker.phone,
            "email": new_worker.email,
            "role": "worker",
            "created_at": new_worker.created_at,
        }
    else:
        db_user = db.query(models.User).filter(
            or_(models.User.email == user.email, models.User.phone == user.phone)
        ).first()
        if db_user:
            raise HTTPException(status_code=400, detail="Email or Phone already registered")

        hashed_password = hash_password(user.password)
        new_user = models.User(
            full_name=user.full_name,
            phone=user.phone,
            email=user.email,
            hashed_password=hashed_password,
            role="user",
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        return {
            "id": new_user.id,
            "full_name": new_user.full_name,
            "phone": new_user.phone,
            "email": new_user.email,
            "role": "user",
            "created_at": new_user.created_at,
        }

@app.post("/login")
@limiter.limit("10/minute")
def login(request: Request, user: schemas.UserLogin, db: Session = Depends(get_db)):
    role = getattr(user, "role", "user")

    if role == "worker":
        db_user = db.query(models.Worker).filter(
            or_(models.Worker.email == user.identifier, models.Worker.phone == user.identifier)
        ).first()
    else:
        db_user = db.query(models.User).filter(
            or_(models.User.email == user.identifier, models.User.phone == user.identifier)
        ).first()

    # Guard against OTP-only accounts (nullable hashed_password): passlib raises
    # on a None hash, which would surface as an unhandled 500.
    if not db_user or not db_user.hashed_password:
        raise HTTPException(status_code=400, detail="Invalid credentials")
    if not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    # The role embedded in the JWT always comes from the database row — never from
    # the client request body, so a caller can't mint a token with an elevated role.
    token_role = "worker" if role == "worker" else getattr(db_user, "role", None) or "user"

    # JWT signed with the shared JWT_SECRET from auth.py
    access_token = create_access_token(db_user.id, token_role)

    return {
        "message": "Login successful",
        "access_token": access_token,
        "user": {
            "id": db_user.id,
            "full_name": db_user.full_name,
            "email": db_user.email,
            "role": token_role,
        }
    }


@app.post("/refresh")
def refresh_token(current: Dict[str, Any] = Depends(get_current_user)):
    """Issue a new access token for the currently authenticated user.
    Tokens expire after 7 days; call this endpoint to extend the session
    without requiring the user to re-enter their password."""
    try:
        uid = int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")
    role = current.get("role", "user")
    new_token = create_access_token(uid, role)
    return {
        "access_token": new_token,
        "user": {
            "id": uid,
            "role": role,
        }
    }



import socketio
from socket_events import sio, set_main_loop

# Wrap FastAPI app with Socket.IO ASGI application.
# Re-assign `app` so that `uvicorn main:app --reload` serves Socket.IO too.
_fastapi_app = app
app = socketio.ASGIApp(sio, other_asgi_app=_fastapi_app)


@_fastapi_app.on_event("startup")
async def _capture_event_loop():
    """Let sync REST endpoints schedule Socket.IO emits on the server loop."""
    import asyncio
    set_main_loop(asyncio.get_running_loop())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
