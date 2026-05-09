from fastapi import APIRouter, Depends, HTTPException , Form , File , UploadFile
from sqlalchemy.orm import Session
from database import SessionLocal , supabase ,SUPABASE_URL , SUPABASE_KEY
from passlib.context import CryptContext
from sqlalchemy import or_, func
from datetime import datetime,timedelta, timezone
import random , os , uuid , models , schemas
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
from dotenv import load_dotenv

router = APIRouter()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# =========================
# ENV
# =========================
load_dotenv()
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")
SENDER_EMAIL = os.getenv("SENDER_EMAIL")



# ===============================
# OTP STORE (with expiry)
# ===============================
otp_store = {}  # {identifier: (otp, expiry_time)}
OTP_EXPIRY_MINUTES = 4

# =========================
# SEND EMAIL (SendGrid)
# =========================
def send_email_otp(to_email: str, otp: str):
    if not SENDGRID_API_KEY or not SENDER_EMAIL:
        raise HTTPException(status_code=500, detail="Email config missing")

    message = Mail(
        from_email=SENDER_EMAIL,
        to_emails=to_email,
        subject="Your OTP Code",
        html_content=f"""
        <div style="font-family: Arial; padding:16px">
            <h2>🔐 OTP Verification</h2>
            <p>Your OTP is:</p>
            <h1>{otp}</h1>
            <p>Expires in {OTP_EXPIRY_MINUTES} minutes.</p>
        </div>
        """
    )

    try:
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        resp = sg.send(message)
        print("SendGrid status:", resp.status_code)
    except Exception as e:
        print("SendGrid error:", e)
        raise HTTPException(status_code=500, detail="Failed to send email")




# Student registration form 

@router.post("/Student_register")
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):

    if db.query(models.User).filter(models.User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    if db.query(models.User).filter(models.User.student_id == user.student_id).first():
        raise HTTPException(status_code=400, detail="Student ID already exists")

    hashed_password = pwd_context.hash(user.password)

    new_user = models.User(
        full_name=user.full_name,
        student_id=user.student_id,
        phone_number=user.phone_number,
        email=user.email,
        college=user.college,
        department=user.department,
        hashed_password=hashed_password
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "message": "User registered successfully",
        "student_id": new_user.id,
        "user_id":new_user.student_id,
        "role":"student"
    }

# Student Login

@router.post("/Student_login")
def login(user: schemas.Login, db: Session = Depends(get_db)):

    db_user = db.query(models.User).filter(
        or_(
            models.User.email == user.identifier,
            models.User.student_id == user.identifier
        )
    ).first()

    if not db_user:
        raise HTTPException(status_code=400, detail="Invalid email or roll number")

    if not pwd_context.verify(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid password")

    return {
        "message": "Login successful",
        "id": db_user.id,
        "user_id": db_user.student_id,
        "full_name": db_user.full_name,
        "email":db_user.email,
        "role":"student"
    }


# Get Student Info
@router.get("/get-user/{user_id}")
def get_user(user_id: int, db: Session = Depends(get_db)):

    user = db.query(models.User).filter(models.User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": user.id,
        "full_name": user.full_name,
        "user_id": user.student_id,
        "phone_number": user.phone_number,
        "email": user.email,
        "college": user.college,
        "department": user.department,
        "bio": user.bio or "",
        "degree": user.degree or "",
        "linkedin": user.linkedin or "",
        "github": user.github or "",
        "portfolio": user.portfolio or "",
        "image": user.image or ""
    }



#--------------------
# Update Student Profile
#--------------------
@router.patch("/update-profile/{id}")
async def update_profile(
    id: int,
    name: str = Form(None),
    phone: str = Form(None),
    email: str = Form(None),
    college: str = Form(None),
    department: str = Form(None),
    bio: str = Form(None),
    linkedin: str = Form(None),
    github: str = Form(None),

    # 🔐 Password fields
    current_password: str = Form(None),
    new_password: str = Form(None),

    image: UploadFile = File(None),
    db: Session = Depends(get_db)
):
    # =========================
    # 🔍 Get User
    # =========================
    user = db.query(models.User).filter(models.User.id == id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # =========================
    # ✅ Email Check
    # =========================
    if email:
        existing = db.query(models.User).filter(models.User.email == email).first()
        if existing and existing.id != id:
            raise HTTPException(status_code=400, detail="Email already in use")

    # =========================
    # 🔐 Password Update
    # =========================
    if current_password or new_password:

        if not (current_password and new_password):
            raise HTTPException(status_code=400, detail="Both passwords required")

        # ✅ Verify current password
        if not pwd_context.verify(current_password, user.hashed_password):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

        # ✅ Validate new password
        if len(new_password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

        # ✅ Update password
        user.hashed_password = pwd_context.hash(new_password)

    # =========================
    # 🖼️ Image Upload
    # =========================
    if image:
        try:
            file_bytes = await image.read()
            file_name = f"{id}_{uuid.uuid4()}.jpg"

            supabase.storage.from_("Profile_Images").upload(
                file_name,
                file_bytes,
                {"content-type": image.content_type}
            )

            user.image = f"{SUPABASE_URL}/storage/v1/object/public/Profile_Images/{file_name}"

        except Exception as e:
            print("Image Upload Error:", e)
            raise HTTPException(status_code=500, detail="Image upload failed")

    # =========================
    # ✏️ Update Other Fields
    # =========================
    if name: user.full_name = name
    if phone: user.phone_number = phone
    if email: user.email = email
    if college: user.college = college
    if department: user.department = department
    if bio: user.bio = bio
    if linkedin: user.linkedin = linkedin
    if github: user.github = github

    # =========================
    # 💾 Save Changes
    # =========================
    db.commit()
    db.refresh(user)

    return {
        "message": "Profile updated successfully",
        "image": user.image
    }

# ===============================
# SEND OTP
# ===============================
@router.post("/send-otp")
def send_otp(data: schemas.OTPRequest, db: Session = Depends(get_db)):

    if data.role == "student":
        user = db.query(models.User).filter(
            func.lower(models.User.email) == func.lower(data.email),
            func.lower(models.User.student_id) == func.lower(data.user_id)
        ).first()
    elif data.role == "organizer":
        user = db.query(models.Organizer).filter(
            func.lower(models.Organizer.email) == func.lower(data.email),
            func.lower(models.Organizer.organizer_id) == func.lower(data.user_id)
        ).first()
    else:
        raise HTTPException(status_code=400, detail="Invalid role")

    if not user:
        raise HTTPException(status_code=404, detail="User not found with provided ID and Email")
    
    otp_key = f"{data.role}:{data.email}"

    # simple rate-limit
    if otp_key in otp_store:
        _, old_exp = otp_store[otp_key]
        if datetime.now(timezone.utc) < old_exp:
            raise HTTPException(status_code=429, detail="Wait before requesting again")

    otp = str(random.randint(100000, 999999))
    expiry = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES)

    otp_store[otp_key] = (otp, expiry)

    send_email_otp(data.email, otp)

    return {"message": "OTP sent successfully"}


# ===============================
# VERIFY OTP
# ===============================
@router.post("/verify-otp")
def verify_otp(data: schemas.OTPVerify):
    
    otp_key = f"{data.role}:{data.email}"
    record = otp_store.get(otp_key)

    if not record:
        raise HTTPException(status_code=400, detail="OTP not found")

    otp, expiry = record

    if datetime.now(timezone.utc) > expiry:
        otp_store.pop(otp_key)
        raise HTTPException(status_code=400, detail="OTP expired")

    if otp != data.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")

    return {"message": "OTP verified"}


# ===============================
# RESET PASSWORD
# ===============================
@router.post("/reset-password")
def reset_password(data: schemas.ResetPassword, db: Session = Depends(get_db)):
    
    otp_key = f"{data.role}:{data.email}"
    record = otp_store.get(otp_key)

    if not record:
        raise HTTPException(status_code=400, detail="Verify OTP first")

    if data.role == "student":
        user = db.query(models.User).filter(
            func.lower(models.User.email) == func.lower(data.email),
            func.lower(models.User.student_id) == func.lower(data.user_id)
        ).first()
    elif data.role == "organizer":
        user = db.query(models.Organizer).filter(
            func.lower(models.Organizer.email) == func.lower(data.email),
            func.lower(models.Organizer.organizer_id) == func.lower(data.user_id)
        ).first()
    else:
        raise HTTPException(status_code=400, detail="Invalid role")

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if data.role == "student":
        user.hashed_password = pwd_context.hash(data.new_password)
    else:
        user.password = pwd_context.hash(data.new_password)

    # 🔥 Remove OTP after use
    otp_store.pop(otp_key)

    db.commit()
    db.refresh(user)
    return {"message": "Password updated successfully"}