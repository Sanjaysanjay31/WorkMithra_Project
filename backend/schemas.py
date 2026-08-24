from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, List
from datetime import date, time, datetime

# Minimum password length enforced at registration and reset. Bare `str`
# previously accepted a 1-character password.
PASSWORD_MIN_LENGTH = 8
# bcrypt silently truncates beyond 72 bytes; reject instead (see auth.py).
PASSWORD_MAX_BYTES = 72


def _check_password_bytes(v: str) -> str:
    if len(v.encode("utf-8")) > PASSWORD_MAX_BYTES:
        raise ValueError(f"Password must be at most {PASSWORD_MAX_BYTES} bytes")
    return v


class UserBase(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    profile_image: Optional[str] = None
    role: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class UserCreate(UserBase):
    password: str = Field(min_length=PASSWORD_MIN_LENGTH)

    @field_validator("password")
    @classmethod
    def _password_max_bytes(cls, v: str) -> str:
        return _check_password_bytes(v)


class UserResponse(UserBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    class Config:
        from_attributes = True


# Backwards-compatible request/response models expected by existing code
class OTPRequest(BaseModel):
    email: EmailStr


class OTPVerify(BaseModel):
    email: EmailStr
    otp: str


class PasswordReset(BaseModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN_LENGTH)
    otp_token: Optional[str] = None

    @field_validator("password")
    @classmethod
    def _password_max_bytes(cls, v: str) -> str:
        return _check_password_bytes(v)


class PasswordChange(BaseModel):
    email: EmailStr
    current_password: str
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH)

    @field_validator("new_password")
    @classmethod
    def _password_max_bytes(cls, v: str) -> str:
        return _check_password_bytes(v)


class UserLogin(BaseModel):
    identifier: str
    password: str
    role: str = "user"


class WorkerBase(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    skill: Optional[str] = None
    experience_years: Optional[int] = None
    bio: Optional[str] = None
    hourly_rate: Optional[float] = None
    availability: Optional[bool] = None
    current_status: Optional[str] = None
    profile_image: Optional[str] = None
    city: Optional[str] = None
    location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class WorkerCreate(WorkerBase):
    user_id: Optional[int] = None
    password: str = Field(min_length=PASSWORD_MIN_LENGTH)


class WorkerResponse(WorkerBase):
    id: int
    rating: Optional[float] = None
    total_jobs: Optional[int] = None
    completed_jobs: Optional[int] = None
    aadhaar_verified: Optional[bool] = None
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True


class WorkerUpdate(BaseModel):
    """Editable worker fields only — rating/job counters are server-managed."""
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    skill: Optional[str] = None
    experience_years: Optional[int] = None
    bio: Optional[str] = None
    hourly_rate: Optional[float] = None
    availability: Optional[bool] = None
    current_status: Optional[str] = None
    profile_image: Optional[str] = None
    city: Optional[str] = None
    location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ServiceBase(BaseModel):
    service_name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    base_price: Optional[float] = None


class ServiceCreate(ServiceBase):
    pass


class ServiceResponse(ServiceBase):
    id: int
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True


class WorkerServiceBase(BaseModel):
    worker_id: int
    service_id: int
    experience_level: Optional[str] = None
    service_price: Optional[float] = None


class BookingBase(BaseModel):
    worker_id: Optional[int] = None
    service_id: Optional[int] = None
    booking_date: Optional[date] = None
    booking_time: Optional[time] = None
    status: Optional[str] = None
    problem_description: Optional[str] = None
    estimated_price: Optional[float] = None
    final_price: Optional[float] = None
    customer_address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class BookingCreate(BookingBase):
    pass


class BookingUpdate(BaseModel):
    """Fields a booking participant may change. user_id/worker_id/service_id are
    intentionally excluded — ownership cannot be reassigned via the API."""
    status: Optional[str] = None
    estimated_price: Optional[float] = None
    final_price: Optional[float] = None
    booking_date: Optional[date] = None
    booking_time: Optional[time] = None
    problem_description: Optional[str] = None
    customer_address: Optional[str] = None


class UserBrief(BaseModel):
    """Minimal client info embedded in booking responses so screens don't need
    a second round-trip per booking."""
    id: int
    full_name: Optional[str] = None
    profile_image: Optional[str] = None


class WorkerBrief(BaseModel):
    """Minimal worker info embedded in booking responses."""
    id: int
    full_name: Optional[str] = None
    skill: Optional[str] = None
    hourly_rate: Optional[float] = None
    rating: Optional[float] = None
    profile_image: Optional[str] = None


class BookingResponse(BookingBase):
    id: int
    user_id: int
    created_at: Optional[datetime] = None
    user: Optional[UserBrief] = None
    worker: Optional[WorkerBrief] = None
    class Config:
        from_attributes = True


class PaymentBase(BaseModel):
    booking_id: Optional[int] = None
    user_id: Optional[int] = None
    worker_id: Optional[int] = None
    amount: float
    payment_method: Optional[str] = None
    payment_status: Optional[str] = None
    transaction_id: Optional[str] = None
    paid_at: Optional[datetime] = None


class PaymentResponse(PaymentBase):
    id: int
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True


class WorkerCreateResponse(BaseModel):
    """Response for worker registration — mirrors WorkerResponse but without
    the password field."""
    id: int
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    role: str = "worker"
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True


class RatingReviewBase(BaseModel):
    booking_id: Optional[int] = None
    user_id: Optional[int] = None
    worker_id: Optional[int] = None
    rating: float
    review_text: Optional[str] = None


class RatingReviewResponse(RatingReviewBase):
    id: int
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True


class NotificationBase(BaseModel):
    user_id: Optional[int] = None
    title: Optional[str] = None
    message: Optional[str] = None
    type: Optional[str] = None
    is_read: Optional[bool] = None


class OTPVerificationBase(BaseModel):
    phone: Optional[str] = None
    otp_code: str
    expires_at: Optional[datetime] = None
    verified: Optional[bool] = None


class ChatMessageBase(BaseModel):
    sender_id: Optional[int] = None
    receiver_id: Optional[int] = None
    booking_id: Optional[int] = None
    message: Optional[str] = Field(default=None, max_length=4000)
    sent_at: Optional[datetime] = None


class ChatMessageResponse(ChatMessageBase):
    id: int
    class Config:
        from_attributes = True


class WorkerAvailabilityBase(BaseModel):
    worker_id: int
    available_day: Optional[str] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    is_available: Optional[bool] = None


class JobHistoryBase(BaseModel):
    booking_id: Optional[int] = None
    worker_id: Optional[int] = None
    user_id: Optional[int] = None
    completion_notes: Optional[str] = None
    completed_at: Optional[datetime] = None


class AssistantMessageCreate(BaseModel):
    role: str  # 'ai' | 'me'
    text: str


class AssistantMessageResponse(BaseModel):
    id: int
    role: str
    text: str
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True

