from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import date, time, datetime


class UserBase(BaseModel):
    full_name: Optional[str]
    phone: Optional[str]
    email: Optional[EmailStr]
    profile_image: Optional[str]
    role: Optional[str]
    gender: Optional[str]
    address: Optional[str]
    city: Optional[str]
    state: Optional[str]
    pincode: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]


class UserCreate(UserBase):
    password: str


class UserResponse(UserBase):
    id: int
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    class Config:
        orm_mode = True


class WorkerBase(BaseModel):
    full_name: Optional[str]
    phone: Optional[str]
    skill: Optional[str]
    experience_years: Optional[int]
    bio: Optional[str]
    hourly_rate: Optional[float]
    availability: Optional[bool]
    current_status: Optional[str]
    profile_image: Optional[str]
    city: Optional[str]
    location: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]


class WorkerCreate(WorkerBase):
    user_id: Optional[int]


class WorkerResponse(WorkerBase):
    id: int
    rating: Optional[float]
    total_jobs: Optional[int]
    created_at: Optional[datetime]

    class Config:
        orm_mode = True


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
        orm_mode = True


class WorkerServiceBase(BaseModel):
    worker_id: int
    service_id: int
    experience_level: Optional[str]
    service_price: Optional[float]


class BookingBase(BaseModel):
    user_id: int
    worker_id: Optional[int]
    service_id: Optional[int]
    booking_date: Optional[date]
    booking_time: Optional[time]
    status: Optional[str]
    problem_description: Optional[str]
    estimated_price: Optional[float]
    final_price: Optional[float]
    customer_address: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]


class BookingCreate(BookingBase):
    pass


class BookingResponse(BookingBase):
    id: int
    created_at: Optional[datetime]

    class Config:
        orm_mode = True


class PaymentBase(BaseModel):
    booking_id: Optional[int]
    user_id: Optional[int]
    worker_id: Optional[int]
    amount: float
    payment_method: Optional[str]
    payment_status: Optional[str]
    transaction_id: Optional[str]
    paid_at: Optional[datetime]


class PaymentResponse(PaymentBase):
    id: int
    created_at: Optional[datetime]

    class Config:
        orm_mode = True


class RatingReviewBase(BaseModel):
    booking_id: Optional[int]
    user_id: Optional[int]
    worker_id: Optional[int]
    rating: float
    review_text: Optional[str]


class RatingReviewResponse(RatingReviewBase):
    id: int
    created_at: Optional[datetime]

    class Config:
        orm_mode = True


class NotificationBase(BaseModel):
    user_id: Optional[int]
    title: Optional[str]
    message: Optional[str]
    type: Optional[str]
    is_read: Optional[bool]


class OTPVerificationBase(BaseModel):
    phone: Optional[str]
    otp_code: str
    expires_at: Optional[datetime]
    verified: Optional[bool]


class ChatMessageBase(BaseModel):
    sender_id: Optional[int]
    receiver_id: Optional[int]
    booking_id: Optional[int]
    message: Optional[str]
    sent_at: Optional[datetime]


class WorkerAvailabilityBase(BaseModel):
    worker_id: int
    available_day: Optional[str]
    start_time: Optional[time]
    end_time: Optional[time]
    is_available: Optional[bool]


class JobHistoryBase(BaseModel):
    booking_id: Optional[int]
    worker_id: Optional[int]
    user_id: Optional[int]
    completion_notes: Optional[str]
    completed_at: Optional[datetime]

