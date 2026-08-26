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
    Index,
    Numeric,
    UniqueConstraint,
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
    age = Column(Integer, nullable=True)
    address = Column(Text, nullable=True)
    # Free-form locality label shown on profiles ("Madhapur, Hyderabad") —
    # distinct from the structured address/city/state fields.
    location = Column(Text, nullable=True)
    alternate_phone = Column(String(50), nullable=True)
    city = Column(String(120), nullable=True)
    state = Column(String(120), nullable=True)
    pincode = Column(String(20), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    # The language the user speaks — read by chat to pick the translation
    # target for messages addressed to them (mirrors workers.preferred_language).
    preferred_language = Column(String(20), default="en-IN")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_verified = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    hashed_password = Column(String(255), nullable=True)
    # Bumped on password change/reset; tokens carrying an older version are
    # rejected (session revocation). Added by startup DDL on existing DBs.
    token_version = Column(Integer, default=0, nullable=False)
    # SHA-256 digest of the jti of the latest issued password-reset token.
    # Makes reset tokens single-use (only the newest one works, once).
    reset_jti = Column(String(64), nullable=True)

    workers = relationship("Worker", back_populates="user")
    bookings = relationship("Booking", back_populates="user")
    payments = relationship("Payment", back_populates="user")
    reviews = relationship("RatingReview", back_populates="user")


class Worker(Base):
    __tablename__ = "workers"
    __table_args__ = (
        Index("ix_workers_city", "city"),
        Index("ix_workers_skill", "skill"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    full_name = Column(String(255), nullable=False)
    phone = Column(String(50), nullable=True)
    age = Column(Integer, nullable=True)
    alternate_phone = Column(String(50), nullable=True)
    skill = Column(String(255), nullable=True)
    experience_years = Column(Integer, nullable=True)
    bio = Column(Text, nullable=True)
    # Free-text working hours as entered by the worker, e.g. "Mon-Sat 9am-6pm".
    timings = Column(String(255), nullable=True)
    hourly_rate = Column(Numeric(10, 2), nullable=True)
    availability = Column(Boolean, default=True)
    current_status = Column(String(50), default="offline")
    profile_image = Column(Text, nullable=True)
    rating = Column(Float, default=0.0)
    total_jobs = Column(Integer, default=0)
    completed_jobs = Column(Integer, default=0)
    cancelled_jobs = Column(Integer, default=0)
    city = Column(String(120), nullable=True)
    pincode = Column(String(20), nullable=True)
    location = Column(Text, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    aadhaar_verified = Column(Boolean, default=False)
    email = Column(String(255), unique=True, index=True, nullable=True)
    hashed_password = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    # The language the worker speaks — used by chat to pick the right
    # translation target for messages addressed to them.
    preferred_language = Column(String(20), default="te-IN")
    # Deactivated workers can't log in or keep socket sessions (mirrors users).
    is_active = Column(Boolean, default=True)
    # Session revocation anchor — see users.token_version.
    token_version = Column(Integer, default=0, nullable=False)

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
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=False, index=True)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=False, index=True)
    experience_level = Column(String(50), nullable=True)
    service_price = Column(Numeric(10, 2), nullable=True)

    worker = relationship("Worker", back_populates="services")
    service = relationship("Service", back_populates="worker_links")


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        Index("ix_bookings_user_created", "user_id", "created_at"),
        Index("ix_bookings_worker_created", "worker_id", "created_at"),
        Index("ix_bookings_status", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    booking_date = Column(Date, nullable=True)
    booking_time = Column(Time, nullable=True)
    status = Column(String(50), default="pending")
    problem_description = Column(Text, nullable=True)
    estimated_price = Column(Numeric(10, 2), nullable=True)
    final_price = Column(Numeric(10, 2), nullable=True)
    # Whose number is currently on the table: 'user' | 'worker'. While
    # final_price is NULL the booking is in price negotiation — estimated_price
    # holds the latest proposal and this column says who made it, so the other
    # side can accept it. NULL on legacy rows (only workers could set prices
    # then, so NULL is treated as a worker quote).
    price_proposed_by = Column(String(10), nullable=True)
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

    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True)

    booking = relationship("Booking", back_populates="payments")
    user = relationship("User", back_populates="payments")


class RatingReview(Base):
    __tablename__ = "ratings_reviews"
    __table_args__ = (
        # One review per booking — enforced at the DB level so concurrent
        # duplicate submissions can't both pass the check-then-insert.
        UniqueConstraint("booking_id", name="uq_ratings_reviews_booking_id"),
        Index("ix_ratings_reviews_worker", "worker_id"),
        Index("ix_ratings_reviews_user", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    rating = Column(Float, nullable=False)
    review_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True)

    booking = relationship("Booking", back_populates="reviews")
    user = relationship("User", back_populates="reviews")


class UserProfile(Base):
    """Extended user preferences and settings — persisted to the database
    instead of an in-memory dict so data survives restarts and multi-worker
    deployments."""

    __tablename__ = "user_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    role = Column(String(20), nullable=False, default="user")
    full_name = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)
    preferred_language = Column(String(20), default="en-IN")
    notification_enabled = Column(Boolean, default=True)
    bio = Column(Text, nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(120), nullable=True)
    state = Column(String(120), nullable=True)
    pincode = Column(String(20), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    profile_image = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        # One extended profile per (user, role). Existing databases that may
        # already contain duplicates are handled at the app level
        # (profiles._get_or_create_profile recovers from the IntegrityError).
        UniqueConstraint("user_id", "role", name="uq_user_profiles_user_role"),
        Index("ix_user_profiles_user_role", "user_id", "role"),
    )


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=True)
    message = Column(Text, nullable=True)
    type = Column(String(50), nullable=True)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # No FK: the recipient can be a user OR a worker (separate tables with
    # overlapping id space). The FK to users(id) is dropped at startup.
    user_id = Column(Integer, nullable=True, index=True)


class PushToken(Base):
    __tablename__ = "push_tokens"

    id = Column(Integer, primary_key=True, index=True)
    # Same overlapping-id convention as Notification: role disambiguates
    # whether user_id points at a user or a worker.
    user_id = Column(Integer, nullable=False, index=True)
    role = Column(String(10), nullable=False, default="user")
    token = Column(String(255), nullable=False, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class OTPVerification(Base):
    __tablename__ = "otp_verification"

    id = Column(Integer, primary_key=True, index=True)
    phone = Column(String(50), nullable=True)
    otp_code = Column(String(20), nullable=False)
    expires_at = Column(DateTime, nullable=True)
    verified = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class EmailVerification(Base):
    """Pending registration — created when /verify-otp succeeds, consumed by
    /register. Carries the SHA-256 digest of the email_verify token's jti so
    the token is single-use (only the newest one works, once)."""

    __tablename__ = "email_verification"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=False, index=True)
    # SHA-256 digest of the email_verify token's jti.
    jti = Column(String(64), nullable=True)
    role = Column(String(20), nullable=True, default="user")
    full_name = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    password_hash = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    consumed_at = Column(DateTime, nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_sender_sent", "sender_id", "sent_at"),
        Index("ix_chat_messages_receiver_sent", "receiver_id", "sent_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    # No FK: sender/receiver can be either a user or a worker (different tables).
    sender_id = Column(Integer, nullable=True)
    receiver_id = Column(Integer, nullable=True)
    # users and workers have overlapping id spaces, so the numeric ids alone
    # are ambiguous — the role of each participant is stored alongside.
    # Legacy rows (added before these columns existed) have NULL roles.
    sender_role = Column(String(20), nullable=True)
    receiver_role = Column(String(20), nullable=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True, index=True)
    message = Column(Text, nullable=True)
    sent_at = Column(DateTime, default=datetime.utcnow)


class WorkerAvailability(Base):
    __tablename__ = "worker_availability"

    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=False, index=True)
    available_day = Column(String(50), nullable=True)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    is_available = Column(Boolean, default=True)

    worker = relationship("Worker", back_populates="availability_entries")


class JobHistory(Base):
    __tablename__ = "job_history"
    __table_args__ = (
        # One history entry per booking (stats are derived from these rows).
        UniqueConstraint("booking_id", name="uq_job_history_booking_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True, index=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    completion_notes = Column(Text, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    booking = relationship("Booking", back_populates="job_history")
    worker = relationship("Worker", back_populates="job_histories")


class AssistantMessage(Base):
    """Persisted AI-assistant conversation. The owner can be a user OR a worker
    (separate tables with overlapping id space), so — like chat_messages — the
    owner is stored as (user_id, user_role) without a foreign key."""
    __tablename__ = "assistant_history"
    __table_args__ = (
        Index("ix_assistant_history_user_created", "user_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    user_role = Column(String(20), nullable=False, default="user")
    role = Column(String(10), nullable=False)  # 'ai' | 'me'
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)



