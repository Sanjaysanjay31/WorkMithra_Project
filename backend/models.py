from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Boolean,
    Float,
    DateTime,
    Date,
    Time,
    ForeignKey,
    Numeric,
)
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(255), nullable=False, index=True)
    phone = Column(String(50), unique=True, index=True, nullable=True)
    email = Column(String(255), unique=True, index=True, nullable=True)
    profile_image = Column(Text, nullable=True)
    role = Column(String(50), default="user")
    gender = Column(String(50), nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(120), nullable=True)
    state = Column(String(120), nullable=True)
    pincode = Column(String(20), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_verified = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    hashed_password = Column(String(255), nullable=True)

    workers = relationship("Worker", back_populates="user")
    bookings = relationship("Booking", back_populates="user")
    payments = relationship("Payment", back_populates="user")
    reviews = relationship("RatingReview", back_populates="user")


class Worker(Base):
    __tablename__ = "workers"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    full_name = Column(String(255), nullable=False)
    phone = Column(String(50), nullable=True)
    skill = Column(String(255), nullable=True)
    experience_years = Column(Integer, nullable=True)
    bio = Column(Text, nullable=True)
    hourly_rate = Column(Numeric(10, 2), nullable=True)
    availability = Column(Boolean, default=True)
    current_status = Column(String(50), default="offline")
    profile_image = Column(Text, nullable=True)
    rating = Column(Float, default=0.0)
    total_jobs = Column(Integer, default=0)
    completed_jobs = Column(Integer, default=0)
    cancelled_jobs = Column(Integer, default=0)
    city = Column(String(120), nullable=True)
    location = Column(Text, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    aadhaar_verified = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="workers")
    services = relationship("WorkerService", back_populates="worker")
    bookings = relationship("Booking", back_populates="worker")
    availability_entries = relationship("WorkerAvailability", back_populates="worker")
    job_histories = relationship("JobHistory", back_populates="worker")


class Service(Base):
    __tablename__ = "services"

    id = Column(Integer, primary_key=True, index=True)
    service_name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(Text, nullable=True)
    base_price = Column(Numeric(10, 2), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    worker_links = relationship("WorkerService", back_populates="service")
    bookings = relationship("Booking", back_populates="service")


class WorkerService(Base):
    __tablename__ = "worker_services"

    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=False)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=False)
    experience_level = Column(String(50), nullable=True)
    service_price = Column(Numeric(10, 2), nullable=True)

    worker = relationship("Worker", back_populates="services")
    service = relationship("Service", back_populates="worker_links")


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True, index=True)
    booking_date = Column(Date, nullable=True)
    booking_time = Column(Time, nullable=True)
    status = Column(String(50), default="pending")
    problem_description = Column(Text, nullable=True)
    estimated_price = Column(Numeric(10, 2), nullable=True)
    final_price = Column(Numeric(10, 2), nullable=True)
    customer_address = Column(Text, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=True)

    user = relationship("User", back_populates="bookings")
    worker = relationship("Worker", back_populates="bookings")
    service = relationship("Service", back_populates="bookings")
    payments = relationship("Payment", back_populates="booking")
    reviews = relationship("RatingReview", back_populates="booking")
    job_history = relationship("JobHistory", back_populates="booking")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    amount = Column(Numeric(10, 2), nullable=False)
    payment_method = Column(String(50), nullable=True)
    payment_status = Column(String(50), default="pending")
    transaction_id = Column(String(255), nullable=True)
    paid_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True)

    booking = relationship("Booking", back_populates="payments")
    user = relationship("User", back_populates="payments")


class RatingReview(Base):
    __tablename__ = "ratings_reviews"

    id = Column(Integer, primary_key=True, index=True)
    rating = Column(Float, nullable=False)
    review_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True)

    booking = relationship("Booking", back_populates="reviews")
    user = relationship("User", back_populates="reviews")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=True)
    message = Column(Text, nullable=True)
    type = Column(String(50), nullable=True)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class OTPVerification(Base):
    __tablename__ = "otp_verification"

    id = Column(Integer, primary_key=True, index=True)
    phone = Column(String(50), nullable=True)
    otp_code = Column(String(20), nullable=False)
    expires_at = Column(DateTime, nullable=True)
    verified = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    message = Column(Text, nullable=True)
    sent_at = Column(DateTime, default=datetime.utcnow)


class WorkerAvailability(Base):
    __tablename__ = "worker_availability"

    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=False)
    available_day = Column(String(50), nullable=True)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    is_available = Column(Boolean, default=True)

    worker = relationship("Worker", back_populates="availability_entries")


class JobHistory(Base):
    __tablename__ = "job_history"

    id = Column(Integer, primary_key=True, index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    completion_notes = Column(Text, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    booking = relationship("Booking", back_populates="job_history")
    worker = relationship("Worker", back_populates="job_histories")

