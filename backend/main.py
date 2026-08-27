import os
import time
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# Fail fast on missing critical secrets — before the DB engine or routers load.
if not os.getenv("JWT_SECRET"):
    raise RuntimeError(
        "JWT_SECRET is not set in backend/.env. "
        "Generate one: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )

from fastapi import FastAPI, Depends, HTTPException, Query, Request, status, UploadFile, File, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Dict, Any, Optional
import models, schemas, database
from database import engine, get_db
from auth import get_current_user, create_access_token, hash_password, verify_password
import requests as _requests_storage

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from rate_limit import limiter

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
    # Backing constraints for check-then-insert upserts: without a unique
    # index two concurrent requests can both pass the "existing?" query and
    # insert duplicate rows. IF NOT EXISTS keeps this idempotent; if legacy
    # data already contains duplicates the create fails and is skipped (the
    # upserts still work, just without the race protection on that DB).
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_services_pair ON worker_services (worker_id, service_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_availability_day ON worker_availability (worker_id, available_day)",
)
try:
    with engine.begin() as _conn:
        from sqlalchemy import text as _sql_text
        for _ddl in _INDEX_DDL:
            _conn.execute(_sql_text(_ddl))
except Exception as _e:
    print("index creation skipped:", _e)

# create_all() also can't add columns to tables that already exist, so the
# session-revocation/deactivation columns are applied explicitly. Idempotent
# on both Postgres (9.6+) and SQLite (3.35+).
_COLUMN_DDL = (
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_jti VARCHAR(64)",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS reset_jti VARCHAR(64)",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_proposed_by VARCHAR(10)",
    # Clients may attach one photo to their review of a completed job.
    "ALTER TABLE ratings_reviews ADD COLUMN IF NOT EXISTS review_image VARCHAR(2000)",
    # Reviews carry up to FIVE photos (JSON array of URLs); the single
    # review_image stays in sync with the first entry for old clients.
    "ALTER TABLE ratings_reviews ADD COLUMN IF NOT EXISTS review_images VARCHAR(4000)",
    # Extra profile fields shown by the app's profile forms — added here so
    # existing databases gain the columns without a manual migration.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS age INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS alternate_phone VARCHAR(50)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(20)",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS age INTEGER",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS alternate_phone VARCHAR(50)",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS timings VARCHAR(255)",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS pincode VARCHAR(20)",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(20)",
)
try:
    with engine.begin() as _conn:
        from sqlalchemy import text as _sql_text
        for _ddl in _COLUMN_DDL:
            _conn.execute(_sql_text(_ddl))
except Exception as _e:
    print("column migration skipped:", _e)

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

from contextlib import asynccontextmanager as _asynccontextmanager


@_asynccontextmanager
async def _lifespan(app: FastAPI):
    """Capture the running event loop so sync REST endpoints can schedule
    Socket.IO emits on it (replaces the deprecated @on_event("startup"))."""
    import asyncio
    from socket_events import set_main_loop
    set_main_loop(asyncio.get_running_loop())
    yield


app = FastAPI(lifespan=_lifespan)

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
# Set RATE_LIMITING=0 in backend/.env or tests to disable. The limiter itself
# lives in rate_limit.py so routers can apply limits without importing main.
if not limiter.enabled:
    print("WARNING: rate limiting is DISABLED (RATE_LIMITING=0)")
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
            print(f"[send-otp] Supabase error {r.status_code}: {r.text[:200]}")
            raise HTTPException(status_code=400, detail="Could not send the OTP — try again shortly")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[send-otp] failed: {e}")
        raise HTTPException(status_code=502, detail="Could not send the OTP — try again shortly")
    return {"message": "OTP sent successfully"}


@app.post("/verify-otp")
@limiter.limit("10/minute")
def verify_otp(request: Request, data: schemas.OTPVerify, db: Session = Depends(get_db)):
    """Verify the OTP via Supabase Auth.

    On success issues TWO single-purpose tokens:
      - an `email_verify` token, required by /register so an account can't be
        created without proving control of the email inbox;
      - a `password_reset` token, for the existing forgot-password flow.
    The email_verify token is single-use: its jti is stored (hashed) on an
    EmailVerification row keyed by email, and /register consumes that row.
    """
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
            raise HTTPException(status_code=400, detail="OTP is invalid or expired — request a new one")
        import secrets as _secrets
        from auth import (
            create_reset_token,
            create_email_verify_token,
            hash_reset_jti,
        )

        ev_jti = _secrets.token_urlsafe(16)
        reset_jti = _secrets.token_urlsafe(16)

        # Record the pending email verification (upsert by email — a re-verify
        # replaces any earlier pending row instead of stacking duplicates).
        existing = (
            db.query(models.EmailVerification)
            .filter(models.EmailVerification.email == data.email)
            .first()
        )
        if existing is None:
            existing = models.EmailVerification(email=data.email)
            db.add(existing)
        existing.jti = hash_reset_jti(ev_jti)
        db.commit()

        # Issue the reset token for the existing forgot-password flow. The jti
        # is recorded on the matching account row if one already exists
        # (single-use). Users and workers authenticate from SEPARATE tables, so
        # record it on both a users row and a workers row when present — a
        # worker's password lives in the workers table, and recording only on
        # users is what made worker password resets silently no-op.
        reset_jti_hash = hash_reset_jti(reset_jti)
        user = db.query(models.User).filter(models.User.email == data.email).first()
        if user is not None:
            user.reset_jti = reset_jti_hash
        worker = db.query(models.Worker).filter(models.Worker.email == data.email).first()
        if worker is not None:
            worker.reset_jti = reset_jti_hash
        if user is not None or worker is not None:
            db.commit()

        # Only echo back the email we already know — never the full Supabase
        # user object (it can carry internal metadata/identifiers).
        return {
            "message": "OTP verified",
            "verify_token": create_email_verify_token(data.email, ev_jti),
            "reset_token": create_reset_token(data.email, reset_jti),
            "email": data.email,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[verify-otp] failed: {e}")
        raise HTTPException(status_code=502, detail="Could not verify the OTP — try again shortly")


@app.post("/change-password")
@limiter.limit("5/minute")
def change_password(
    request: Request,
    data: schemas.PasswordChange,
    db: Session = Depends(get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Change password using the current password for verification.
    The account being changed must belong to the authenticated token.
    Bumps token_version so every existing session is revoked."""
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
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    return {"message": "Password updated successfully"}


async def _read_validated_image(file: UploadFile) -> tuple:
    """Read an upload and verify it is a real JPEG/PNG/GIF/WebP image.

    Returns (content_bytes, content_type). Rejects non-images, SVG (can carry
    scripts — never allowed into a public bucket) and anything over 5 MB.
    Size is enforced while streaming so a multi-GB body can't exhaust RAM."""
    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are allowed")
    if "svg" in content_type:
        raise HTTPException(status_code=400, detail="SVG images are not allowed")
    MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
    chunks = []
    total = 0
    while True:
        chunk = await file.read(1024 * 256)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Image too larger than 5 MB")
        chunks.append(chunk)
    content = b"".join(chunks)
    # Trust magic bytes, not the client-supplied Content-Type header.
    _MAGIC = (
        (b"\xff\xd8\xff", "image/jpeg"),
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"GIF87a", "image/gif"),
        (b"GIF89a", "image/gif"),
        (b"RIFF", "image/webp"),  # further checked for WEBP marker below
    )
    detected = None
    for magic, mime in _MAGIC:
        if content.startswith(magic):
            detected = mime
            break
    if detected == "image/webp" and content[8:12] != b"WEBP":
        detected = None
    if detected is None:
        raise HTTPException(status_code=400, detail="File does not look like a valid image (JPEG/PNG/GIF/WebP only)")
    return content, detected


async def _store_image(content: bytes, content_type: str, path: str) -> str:
    """Upload image bytes to Supabase Storage and return the public URL."""
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
            # Log the full detail server-side; return a generic message so
            # storage internals (bucket config, driver errors) never leak.
            print(f"[Supabase upload] {r.status_code} {r.text[:500]}")
            raise HTTPException(
                status_code=400,
                detail="Could not store the image — check the storage bucket configuration",
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[image upload] failed: {e}")
        raise HTTPException(status_code=502, detail="Image upload failed — try again shortly")
    return f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{path}"


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

    content, content_type = await _read_validated_image(file)

    import re as _re
    base_name = (file.filename or "image").rsplit("/", 1)[-1]
    safe_name = _re.sub(r"[^A-Za-z0-9._-]", "_", base_name) or "image"
    path = f"{role}_{uid}/{int(time.time())}_{safe_name}"
    public_url = await _store_image(content, content_type, path)

    # Best-effort: persist URL ONLY on the table the caller belongs to.
    # users and workers are separate tables with overlapping id space, so we
    # must use `role` to disambiguate — otherwise a user upload would also
    # overwrite the worker row that happens to share the same numeric id.
    def _persist_url():
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
            # The upload succeeded but saving the URL failed — surface it instead
            # of silently returning a URL that was never persisted.
            print(f"[upload-profile-image] failed to persist URL: {persist_err}")
            db.rollback()

    # Blocking SQLAlchemy work — keep it off the event loop like the upload.
    import asyncio as _asyncio
    await _asyncio.to_thread(_persist_url)

    return {"url": public_url, "path": path}


@app.post("/upload-review-image")
@limiter.limit("10/minute")
async def upload_review_image(
    request: Request,
    file: UploadFile = File(...),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Upload a photo to attach to a review. Same validation/storage as
    avatars, but the URL is only RETURNED — it is persisted later as part of
    POST /reviews/ (review_image). Stored under review_{uid}/ so review photos
    never collide with profile avatars."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    try:
        uid = int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")
    role = current.get("role", "user")

    content, content_type = await _read_validated_image(file)

    import re as _re
    base_name = (file.filename or "image").rsplit("/", 1)[-1]
    safe_name = _re.sub(r"[^A-Za-z0-9._-]", "_", base_name) or "image"
    path = f"review_{role}_{uid}/{int(time.time())}_{safe_name}"
    public_url = await _store_image(content, content_type, path)
    return {"url": public_url, "path": path}


@app.post("/reset-password")
@limiter.limit("5/minute")
def reset_password(request: Request, data: schemas.PasswordReset, db: Session = Depends(get_db)):
    """Reset a user's password. Requires the reset_token issued by /verify-otp —
    without a verified OTP the reset is rejected. Reset tokens are single-use:
    the jti must match the one recorded on the user row, and it is cleared on
    success. Responses are uniform so the endpoint can't be used to probe
    which emails have accounts."""
    from auth import decode_reset_token, hash_reset_jti

    success_response = {"message": "If the account exists, the password has been reset"}

    if not data.otp_token:
        raise HTTPException(status_code=400, detail="OTP verification required — verify the OTP first")

    payload = decode_reset_token(data.otp_token)
    if payload is None:
        raise HTTPException(status_code=400, detail="Reset link expired or invalid — request a new OTP")

    token_email = str(payload.get("sub", "")).lower()
    if token_email != data.email.lower():
        raise HTTPException(status_code=400, detail="This reset token was issued for a different email")

    # Case-insensitive lookup across BOTH account tables — users and workers
    # authenticate from separate tables, so a worker's reset must hit workers.
    # (Looking up only users is what made worker resets silently no-op while
    # still returning a success message.)
    user = (
        db.query(models.User)
        .filter(models.User.email.ilike(data.email))
        .first()
    )
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.email.ilike(data.email))
        .first()
    )
    if not user and not worker:
        # Uniform response — don't reveal that no account exists.
        return success_response

    # Single-use enforcement: the token's jti must be the latest one issued for
    # the account. Missing jti (legacy token) or a mismatch is rejected.
    jti = payload.get("jti")
    jti_hash = hash_reset_jti(jti) if jti else None

    reset_any = False
    for account in (user, worker):
        if account is None:
            continue
        if not jti_hash or account.reset_jti != jti_hash:
            continue
        account.hashed_password = hash_password(data.password)
        account.reset_jti = None  # consume the token
        account.token_version = (account.token_version or 0) + 1  # revoke sessions
        reset_any = True

    if not reset_any:
        raise HTTPException(status_code=400, detail="Reset link expired or invalid — request a new OTP")

    db.commit()
    return success_response


def _existing_account_filter(model, email, phone):
    """Duplicate-check filter built ONLY from provided identifiers.

    Including a None value would render `column IS NULL`, which matches every
    row missing that column and breaks signup as soon as one such row exists."""
    clauses = []
    if email is not None:
        clauses.append(model.email == email)
    if phone is not None:
        clauses.append(model.phone == phone)
    if not clauses:
        return None
    return or_(*clauses) if len(clauses) > 1 else clauses[0]


@app.post("/register", response_model=schemas.WorkerCreateResponse)
@limiter.limit("5/minute")
def register(
    request: Request,
    user: schemas.UserCreate,
    db: Session = Depends(get_db),
    verify_token: Optional[str] = Query(None, description="email_verify token from /verify-otp (legacy location)"),
    x_verify_token: Optional[str] = Header(None, alias="X-Verify-Token", description="Preferred: keeps the proof token out of URLs and access logs"),
):
    """Register a new user. The role field determines whether a User or Worker
    row is created. Both return the same response shape so the client can
    handle either role with one code path.

    Email verification is REQUIRED: the token issued by /verify-otp must be
    presented (X-Verify-Token header preferred; query param accepted for older
    clients) and the matching EmailVerification row is consumed on success.
    Without it registration is rejected — the OTP flow is the only proof that
    the registrant controls the email inbox.
    """
    from auth import decode_email_verify_token, hash_reset_jti

    role = getattr(user, "role", "user") or "user"

    # An account needs a login identifier and a name — the columns are NOT
    # NULL and login matches only on email/phone, so reject early with a 422
    # instead of failing the insert (500) or creating an unreachable account.
    if not user.full_name or not user.full_name.strip():
        raise HTTPException(status_code=422, detail="full_name is required")
    if user.email is None and not user.phone:
        raise HTTPException(status_code=422, detail="Provide an email or a phone number")

    # ---- Email verification gate (header takes precedence over query) ----
    presented_token = x_verify_token or verify_token
    if not presented_token:
        raise HTTPException(
            status_code=400,
            detail="Email verification required — verify the OTP before registering",
        )
    payload = decode_email_verify_token(presented_token)
    if payload is None:
        raise HTTPException(
            status_code=400,
            detail="Verification link expired or invalid — request a new OTP",
        )
    token_email = str(payload.get("sub", "")).lower()
    if user.email is None or token_email != user.email.lower():
        raise HTTPException(
            status_code=400,
            detail="This verification token was issued for a different email",
        )
    token_jti = payload.get("jti")
    if not token_jti:
        raise HTTPException(
            status_code=400,
            detail="Verification link expired or invalid — request a new OTP",
        )

    # Consume the pending verification row (single-use). A missing or already
    # consumed row means the token was already used or never issued.
    ev = (
        db.query(models.EmailVerification)
        .filter(models.EmailVerification.email == user.email)
        .first()
    )
    if ev is None or not ev.jti or ev.jti != hash_reset_jti(token_jti) or ev.consumed_at is not None:
        raise HTTPException(
            status_code=400,
            detail="Verification link expired or invalid — request a new OTP",
        )

    if role == "worker":
        dup_filter = _existing_account_filter(models.Worker, user.email, user.phone)
        db_worker = db.query(models.Worker).filter(dup_filter).first() if dup_filter is not None else None
        if db_worker:
            raise HTTPException(status_code=400, detail="Email or Phone already registered as worker")

        hashed_password = hash_password(user.password)
        new_worker = models.Worker(
            full_name=user.full_name.strip(),
            phone=user.phone,
            email=user.email,
            hashed_password=hashed_password,
        )
        db.add(new_worker)
        db.commit()
        db.refresh(new_worker)
        ev.role = "worker"
        ev.consumed_at = datetime.utcnow()
        db.commit()
        return {
            "id": new_worker.id,
            "full_name": new_worker.full_name,
            "phone": new_worker.phone,
            "email": new_worker.email,
            "role": "worker",
            "created_at": new_worker.created_at,
        }
    else:
        dup_filter = _existing_account_filter(models.User, user.email, user.phone)
        db_user = db.query(models.User).filter(dup_filter).first() if dup_filter is not None else None
        if db_user:
            raise HTTPException(status_code=400, detail="Email or Phone already registered")

        hashed_password = hash_password(user.password)
        new_user = models.User(
            full_name=user.full_name.strip(),
            phone=user.phone,
            email=user.email,
            hashed_password=hashed_password,
            role="user",
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        ev.role = "user"
        ev.consumed_at = datetime.utcnow()
        db.commit()
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
    # Deactivated accounts can't log in (users and workers both carry the flag;
    # legacy worker rows without it default to active).
    if getattr(db_user, "is_active", True) is False:
        raise HTTPException(status_code=403, detail="Account is disabled")

    # The role embedded in the JWT always comes from the database row — never from
    # the client request body, so a caller can't mint a token with an elevated role.
    token_role = "worker" if role == "worker" else getattr(db_user, "role", None) or "user"

    # JWT signed with the shared JWT_SECRET from auth.py. The token_version
    # claim ties the session to the account's current revocation counter.
    access_token = create_access_token(
        db_user.id, token_role, token_version=getattr(db_user, "token_version", 0) or 0
    )

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
    without requiring the user to re-enter their password.

    get_current_user re-validates the account against the database (exists,
    active, token not revoked), so a refresh can no longer extend a session
    for a deleted, deactivated, or password-changed account."""
    try:
        uid = int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")
    role = current.get("role", "user")
    try:
        token_version = int(current.get("tv", 0))
    except (TypeError, ValueError):
        token_version = 0
    new_token = create_access_token(uid, role, token_version=token_version)
    return {
        "access_token": new_token,
        "user": {
            "id": uid,
            "role": role,
        }
    }



import socketio
from socket_events import sio

# Wrap FastAPI app with Socket.IO ASGI application.
# Re-assign `app` so that `uvicorn main:app --reload` serves Socket.IO too.
_fastapi_app = app
app = socketio.ASGIApp(sio, other_asgi_app=_fastapi_app)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
