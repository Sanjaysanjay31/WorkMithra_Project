from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import or_
import models, schemas, database
from database import engine, get_db
from passlib.context import CryptContext
import os, time
from dotenv import load_dotenv
import requests as _requests_storage

load_dotenv()

# Create tables
models.Base.metadata.create_all(bind=engine)

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

app = FastAPI()

# Add CORS Middleware
# NOTE: allow_origins=["*"] and allow_credentials=True cannot be combined —
# browsers reject the preflight response. We either enumerate origins (with
# credentials) or keep wildcard (without credentials). For a public API that
# uses bearer tokens in the body / headers (not cookies), wildcard + no
# credentials is the correct choice.
ALLOWED_ORIGINS = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,   # set True only if you use httpOnly cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

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

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

import requests as _requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

@app.post("/send-otp")
def send_otp(data: schemas.OTPRequest):
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
def verify_otp(data: schemas.OTPVerify):
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
        payload = r.json()
        return {
            "message": "OTP verified",
            "access_token": payload.get("access_token"),
            "user": payload.get("user"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to verify OTP: {e}")


@app.post("/change-password")
def change_password(data: schemas.PasswordChange, db: Session = Depends(get_db)):
    """Change password using the current password for verification."""
    user = db.query(models.User).filter(models.User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found for this email")
    if not pwd_context.verify(data.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.hashed_password = pwd_context.hash(data.new_password)
    db.commit()
    return {"message": "Password updated successfully"}


@app.post("/upload-profile-image")
async def upload_profile_image(
    file: UploadFile = File(...),
    user_id: str = Form("guest"),
    role: str = Form("user"),
    db: Session = Depends(get_db),
):
    """Upload an avatar to Supabase Storage (bucket: all_images) and save URL on the user row."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    content = await file.read()
    safe_name = (file.filename or "image").replace("/", "_").replace(" ", "_")
    path = f"{user_id}/{int(time.time())}_{safe_name}"
    try:
        r = _requests_storage.post(
            f"{SUPABASE_URL}/storage/v1/object/all_images/{path}",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": file.content_type or "application/octet-stream",
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
                    f"Check: (1) bucket 'all_images' exists, (2) it is PUBLIC, "
                    f"(3) an INSERT policy allows the anon role to upload."
                ),
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upload failed: {e}")

    public_url = f"{SUPABASE_URL}/storage/v1/object/public/all_images/{path}"

    # Best-effort: persist URL ONLY on the table the caller belongs to.
    # users and workers are separate tables with overlapping id space, so we
    # must use `role` to disambiguate — otherwise a user upload would also
    # overwrite the worker row that happens to share the same numeric id.
    try:
        uid = int(user_id)
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
    except Exception:
        pass

    return {"url": public_url, "path": path}


@app.post("/reset-password")
def reset_password(data: schemas.PasswordReset, db: Session = Depends(get_db)):
    """Reset a user's password. Caller is expected to have verified an OTP first."""
    user = db.query(models.User).filter(models.User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found for this email")
    user.hashed_password = pwd_context.hash(data.password)
    db.commit()
    return {"message": "Password reset successful"}


@app.post("/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    # Add role handling
    role = getattr(user, "role", "user")

    if role == "worker":
        db_worker = db.query(models.Worker).filter(
            or_(models.Worker.email == user.email, models.Worker.phone == user.phone)
        ).first()
        if db_worker:
            raise HTTPException(status_code=400, detail="Email or Phone already registered as worker")
        
        hashed_password = pwd_context.hash(user.password)
        new_worker = models.Worker(
            full_name=user.full_name,
            phone=user.phone,
            email=user.email,
            hashed_password=hashed_password
        )
        db.add(new_worker)
        db.commit()
        db.refresh(new_worker)
        # Return a mock UserResponse since endpoint expects it, or change response model
        # For simplicity, returning a dictionary that satisfies UserResponse loosely
        return {
            "id": new_worker.id,
            "full_name": new_worker.full_name,
            "phone": new_worker.phone,
            "email": new_worker.email,
            "role": "worker"
        }
    else:
        db_user = db.query(models.User).filter(
            or_(models.User.email == user.email, models.User.phone == user.phone)
        ).first()
        if db_user:
            raise HTTPException(status_code=400, detail="Email or Phone already registered")

        hashed_password = pwd_context.hash(user.password)
        new_user = models.User(
            full_name=user.full_name,
            phone=user.phone,
            email=user.email,
            hashed_password=hashed_password,
            role="user"
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        return new_user

import jwt as pyjwt
from datetime import datetime, timedelta

@app.post("/login")
def login(user: schemas.UserLogin, db: Session = Depends(get_db)):
    role = getattr(user, "role", "user")

    if role == "worker":
        db_user = db.query(models.Worker).filter(
            or_(models.Worker.email == user.identifier, models.Worker.phone == user.identifier)
        ).first()
    else:
        db_user = db.query(models.User).filter(
            or_(models.User.email == user.identifier, models.User.phone == user.identifier)
        ).first()

    if not db_user or not pwd_context.verify(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    # Generate a simple JWT token
    secret_key = os.getenv("JWT_SECRET", "supersecretkey")
    token_data = {"sub": str(db_user.id), "role": role, "exp": datetime.utcnow() + timedelta(days=7)}
    access_token = pyjwt.encode(token_data, secret_key, algorithm="HS256")

    return {
        "message": "Login successful",
        "access_token": access_token,
        "user": {
            "id": db_user.id,
            "full_name": db_user.full_name,
            "email": db_user.email,
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
