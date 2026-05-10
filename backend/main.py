from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import or_
import models, schemas, database
from database import engine, get_db
from passlib.context import CryptContext
import os
from dotenv import load_dotenv

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

app = FastAPI()

# Add CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers (keeps main.py small)
from routers.workers import router as workers_router
from routers.bookings import router as bookings_router
from routers.profiles import router as profiles_router
from routers.chat import router as chat_router
from routers.ai import router as ai_router

app.include_router(workers_router, prefix="/workers", tags=["workers"])
app.include_router(bookings_router, prefix="/bookings", tags=["bookings"])
app.include_router(profiles_router, prefix="/profiles", tags=["profiles"])
app.include_router(chat_router, prefix="/chat", tags=["chat"])
app.include_router(ai_router, prefix="/ai", tags=["ai"])

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
    # Verify email is in otp_store and verified (simplified for this exercise)
    # In a real app, you'd mark the email as verified in the DB or a cache
    
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
        hashed_password=hashed_password
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/login")
def login(user: schemas.UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(
        or_(models.User.email == user.identifier, models.User.phone == user.identifier)
    ).first()

    if not db_user or not pwd_context.verify(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    return {
        "message": "Login successful",
        "user": {
            "id": db_user.id,
            "full_name": db_user.full_name,
            "email": db_user.email,
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
