from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_
import models, schemas, database
from database import engine, get_db
from passlib.context import CryptContext
import random, os
from datetime import datetime, timedelta, timezone
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
from dotenv import load_dotenv

load_dotenv()

# Create tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")
SENDER_EMAIL = os.getenv("SENDER_EMAIL")

# OTP Store
otp_store = {} # {email: (otp, expiry)}
OTP_EXPIRY_MINUTES = 4

def send_email_otp(to_email: str, otp: str):
    if not SENDGRID_API_KEY or not SENDER_EMAIL:
        # For development if keys are missing
        print(f"DEBUG: OTP for {to_email} is {otp}")
        return

    message = Mail(
        from_email=SENDER_EMAIL,
        to_emails=to_email,
        subject="WorkMithra Verification Code",
        html_content=f"Your OTP code is <strong>{otp}</strong>. It expires in {OTP_EXPIRY_MINUTES} minutes."
    )
    try:
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        sg.send(message)
    except Exception as e:
        print(f"Error sending email: {e}")
        raise HTTPException(status_code=500, detail="Failed to send OTP")

@app.post("/send-otp")
def send_otp(data: schemas.OTPRequest):
    otp = str(random.randint(100000, 999999))
    expiry = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES)
    otp_store[data.email] = (otp, expiry)
    send_email_otp(data.email, otp)
    return {"message": "OTP sent successfully"}

@app.post("/verify-otp")
def verify_otp(data: schemas.OTPVerify):
    record = otp_store.get(data.email)
    if not record:
        raise HTTPException(status_code=400, detail="OTP not found")
    
    otp, expiry = record
    if datetime.now(timezone.utc) > expiry:
        del otp_store[data.email]
        raise HTTPException(status_code=400, detail="OTP expired")
    
    if otp != data.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
    
    # We keep the record for a short time to allow registration
    return {"message": "OTP verified"}

@app.post("/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    # Verify email is in otp_store and verified (simplified for this exercise)
    # In a real app, you'd mark the email as verified in the DB or a cache
    
    db_user = db.query(models.User).filter(
        or_(models.User.email == user.email, models.User.phone_number == user.phone_number)
    ).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email or Phone already registered")

    hashed_password = pwd_context.hash(user.password)
    new_user = models.User(
        full_name=user.full_name,
        phone_number=user.phone_number,
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
        or_(models.User.email == user.identifier, models.User.phone_number == user.identifier)
    ).first()

    if not db_user or not pwd_context.verify(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    return {
        "message": "Login successful",
        "user": {
            "id": db_user.id,
            "full_name": db_user.full_name,
            "email": db_user.email
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
