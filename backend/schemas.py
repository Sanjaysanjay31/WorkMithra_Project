from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import date, time, datetime


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
    password: str


class UserResponse(UserBase):
    id: int
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
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
    password: str


class UserLogin(BaseModel):
    identifier: str
    password: str


class WorkerBase(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
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
    user_id: Optional[int]


class WorkerResponse(WorkerBase):
    id: int
    rating: Optional[float]
    total_jobs: Optional[int]
    created_at: Optional[datetime]
    class Config:
        from_attributes = True


class ServiceBase(BaseModel):
    service_name: str
    description: Optional[str]
    icon: Optional[str]
    base_price: Optional[float]


class ServiceCreate(ServiceBase):
    pass


class ServiceResponse(ServiceBase):
    id: int
    created_at: Optional[datetime]
    class Config:
        from_attributes = True


class WorkerServiceBase(BaseModel):
    worker_id: int
    service_id: int
    experience_level: Optional[str]
    service_price: Optional[float]


class BookingBase(BaseModel):
    user_id: int
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


class BookingResponse(BookingBase):
    id: int
    created_at: Optional[datetime]
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
    created_at: Optional[datetime]
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
    created_at: Optional[datetime]
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
    message: Optional[str] = None
    sent_at: Optional[datetime] = None


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

