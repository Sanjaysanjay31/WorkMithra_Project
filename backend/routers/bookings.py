from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Dict, Any
from sqlalchemy.orm import Session, joinedload
from datetime import datetime
import database, models, schemas
from auth import get_current_user
from booking_status import normalize_status
from socket_events import emit_to_user

router = APIRouter()

# Allowed status transitions: pending -> upcoming -> completed, with either
# participant able to reject/cancel while the booking is still active.
# completed and rejected are terminal.
_ALLOWED_TRANSITIONS = {
    "pending": {"upcoming", "rejected"},
    "upcoming": {"completed", "rejected"},
    "completed": set(),
    "rejected": set(),
}

_DAY_NAMES = {
    "monday": "monday", "mon": "monday",
    "tuesday": "tuesday", "tue": "tuesday", "tues": "tuesday",
    "wednesday": "wednesday", "wed": "wednesday",
    "thursday": "thursday", "thu": "thursday", "thur": "thursday", "thurs": "thursday",
    "friday": "friday", "fri": "friday",
    "saturday": "saturday", "sat": "saturday",
    "sunday": "sunday", "sun": "sunday",
}


def _validate_worker_bookable(db: Session, worker: models.Worker, booking: schemas.BookingCreate) -> None:
    """Reject bookings for workers who are offline, unavailable, or have no
    matching availability slot for the requested day/time."""
    if worker.availability is False:
        raise HTTPException(status_code=400, detail="This worker is not accepting new bookings")
    if worker.current_status == "offline":
        raise HTTPException(status_code=400, detail="This worker is currently offline")

    if booking.booking_date is None:
        return  # date-less requests are allowed; nothing to check against

    day = _DAY_NAMES.get(booking.booking_date.strftime("%A").lower())
    slots = (
        db.query(models.WorkerAvailability)
        .filter(models.WorkerAvailability.worker_id == worker.id)
        .all()
    )
    if not slots:
        return  # worker has not configured availability slots yet

    for slot in slots:
        if not slot.is_available:
            continue
        slot_day = _DAY_NAMES.get(str(slot.available_day or "").strip().lower())
        if slot_day != day:
            continue
        if booking.booking_time is None:
            return  # right day, no specific time requested
        if slot.start_time and booking.booking_time < slot.start_time:
            continue
        if slot.end_time and booking.booking_time > slot.end_time:
            continue
        return  # slot covers the requested day and time

    raise HTTPException(
        status_code=400,
        detail="Worker is not available at the requested date/time",
    )


def _current_user_id(current: Dict[str, Any]) -> int:
    try:
        return int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")


def _assert_participant(booking: models.Booking, current: Dict[str, Any]) -> None:
    """Only the booking's client or worker may view/modify it."""
    uid = _current_user_id(current)
    role = current.get("role")
    if role == "worker":
        if booking.worker_id != uid:
            raise HTTPException(status_code=403, detail="Not your booking")
    else:
        if booking.user_id != uid:
            raise HTTPException(status_code=403, detail="Not your booking")


@router.post("/", response_model=schemas.BookingResponse)
def create_booking(
    booking: schemas.BookingCreate,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Create a new booking. The client id always comes from the token.
    New bookings ALWAYS start as 'pending' — a client-supplied status is
    ignored so customers can't create bookings already marked completed."""
    if not booking.worker_id:
        raise HTTPException(status_code=400, detail="worker_id is required")
    user_id = _current_user_id(current)

    worker = db.query(models.Worker).filter(models.Worker.id == booking.worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    _validate_worker_bookable(db, worker, booking)

    status = "pending"

    new_booking = models.Booking(
        user_id=user_id,
        worker_id=booking.worker_id,
        service_id=booking.service_id,
        booking_date=booking.booking_date,
        booking_time=booking.booking_time,
        status=status,
        problem_description=booking.problem_description,
        estimated_price=booking.estimated_price,
        customer_address=booking.customer_address,
        latitude=booking.latitude,
        longitude=booking.longitude,
        created_at=datetime.utcnow(),
    )
    db.add(new_booking)
    db.commit()
    db.refresh(new_booking)

    # Realtime: notify the worker (best-effort; the DB row is the source of truth).
    emit_to_user(new_booking.worker_id, "new_booking_request", {
        "booking_id": new_booking.id,
        "client_id": new_booking.user_id,
        "worker_id": new_booking.worker_id,
        "booking_date": str(new_booking.booking_date) if new_booking.booking_date else None,
        "booking_time": str(new_booking.booking_time) if new_booking.booking_time else None,
        "problem_description": new_booking.problem_description,
        "estimated_price": float(new_booking.estimated_price) if new_booking.estimated_price is not None else None,
        "status": new_booking.status,
        "timestamp": datetime.utcnow().isoformat(),
    }, role="worker")

    return new_booking


@router.get("/", response_model=List[schemas.BookingResponse])
def list_bookings(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """List the logged-in user's bookings (own as client, or assigned as worker).
    Scope always comes from the authenticated token — never a client-supplied id."""
    uid = _current_user_id(current)
    query = db.query(models.Booking).options(
        joinedload(models.Booking.user), joinedload(models.Booking.worker)
    )
    if current.get("role") == "worker":
        query = query.filter(models.Booking.worker_id == uid)
    else:
        query = query.filter(models.Booking.user_id == uid)
    bookings = query.order_by(models.Booking.created_at.desc()).offset(skip).limit(limit).all()
    return bookings


@router.get("/{booking_id}", response_model=schemas.BookingResponse)
def get_booking(
    booking_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Get a specific booking by ID (participants only)."""
    booking = db.query(models.Booking).options(
        joinedload(models.Booking.user), joinedload(models.Booking.worker)
    ).filter(models.Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    _assert_participant(booking, current)
    return booking


@router.put("/{booking_id}", response_model=schemas.BookingResponse)
def update_booking(
    booking_id: int,
    booking_update: schemas.BookingUpdate,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Update a booking (partial update — participants only).

    Status changes must follow the lifecycle in shared/booking-status.json:
    pending -> upcoming -> completed, with rejection allowed while active.
    Only the worker may accept (pending->upcoming) or complete
    (upcoming->completed); either participant may reject/cancel.
    Price fields (estimated/final) are worker-writable only — a customer
    must not be able to rewrite the agreed price on their own booking."""
    # with_for_update() takes a row lock so concurrent updates (e.g. the
    # client rejecting while the worker completes) can't both pass the
    # transition check. The SQLite dialect ignores the hint, which is fine
    # for single-writer dev databases.
    booking = (
        db.query(models.Booking)
        .filter(models.Booking.id == booking_id)
        .with_for_update()
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    _assert_participant(booking, current)

    uid = _current_user_id(current)
    is_worker_side = current.get("role") == "worker" and booking.worker_id == uid

    data = booking_update.model_dump(exclude_unset=True)
    if not is_worker_side:
        # Customers can't set or change prices — the worker quotes the job.
        data.pop("estimated_price", None)
        data.pop("final_price", None)
    if "status" in data:
        normalized = normalize_status(data["status"])
        if normalized is None:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{data['status']}'. Allowed: pending, upcoming, completed, rejected",
            )
        current_status = normalize_status(booking.status) or "pending"
        if normalized != current_status:
            allowed = _ALLOWED_TRANSITIONS.get(current_status, set())
            if normalized not in allowed:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot change status from '{current_status}' to '{normalized}'",
                )
            if normalized in ("upcoming", "completed") and not is_worker_side:
                raise HTTPException(
                    status_code=403,
                    detail="Only the worker can accept or complete a booking",
                )
        data["status"] = normalized
    elif (normalize_status(booking.status) or "pending") in ("completed", "rejected"):
        # Terminal bookings are immutable (price rewrites, date changes, etc.).
        # Compare on the normalized status so legacy spellings (success,
        # declined, ...) are treated as terminal too.
        if data:
            raise HTTPException(
                status_code=400,
                detail=f"This booking is {booking.status} and can no longer be modified",
            )

    became_completed = (
        data.get("status") == "completed"
        and (normalize_status(booking.status) or "pending") != "completed"
    )

    for field, value in data.items():
        setattr(booking, field, value)

    if became_completed:
        # Record the job history entry and bump worker stats in the SAME
        # transaction as the status change, so completing a job can't drift
        # from the worker's counters. Skipped silently if an entry already
        # exists (e.g. created manually via /job-history/).
        existing_history = (
            db.query(models.JobHistory)
            .filter(models.JobHistory.booking_id == booking.id)
            .first()
        )
        if existing_history is None:
            db.add(models.JobHistory(
                booking_id=booking.id,
                worker_id=booking.worker_id,
                user_id=booking.user_id,
                completed_at=datetime.utcnow(),
            ))
        worker = db.query(models.Worker).filter(models.Worker.id == booking.worker_id).first()
        if worker is not None:
            worker.completed_jobs = (worker.completed_jobs or 0) + 1
            worker.total_jobs = (worker.total_jobs or 0) + 1

    db.commit()
    db.refresh(booking)

    # Realtime: notify the OTHER participant of the change (status and/or price).
    if is_worker_side:
        other_id, other_role = booking.user_id, "user"
    else:
        other_id, other_role = booking.worker_id, "worker"
    emit_to_user(other_id, "booking_status_changed", {
        "booking_id": booking.id,
        "status": booking.status,
        "estimated_price": float(booking.estimated_price) if booking.estimated_price is not None else None,
        "updated_by": uid,
        "timestamp": datetime.utcnow().isoformat(),
    }, role=other_role)

    return booking
