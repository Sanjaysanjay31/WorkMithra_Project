from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import List, Dict, Any
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from datetime import datetime, date
import database, models, schemas
from auth import get_current_user
from rate_limit import limiter
from booking_status import normalize_status
from socket_events import emit_to_user
from routers.notifications import build_notification, publish_notification

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

# Sanity bounds for agreed prices (Numeric(10,2) would silently accept
# absurd values; a voice/typo input should not create a ₹99,999,999 job).
_MAX_PRICE = 10_000_000


def _check_price(value, field: str):
    if value is None:
        return
    # Zero is rejected alongside negatives: a ₹0 opening proposal would let
    # the negotiation start from a meaningless number.
    if value <= 0 or value > _MAX_PRICE:
        raise HTTPException(status_code=400, detail=f"{field} must be greater than 0 and below {_MAX_PRICE}")

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
@limiter.limit("20/minute")
def create_booking(
    request: Request,
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

    # Validate the service exists — an unchecked id would fail the FK on
    # commit and surface as an unhandled 500.
    if booking.service_id is not None:
        service = db.query(models.Service).filter(models.Service.id == booking.service_id).first()
        if service is None:
            raise HTTPException(status_code=404, detail="Service not found")
        # If the worker has configured their service list, the requested
        # service must be on it. (Workers without any links yet are not
        # blocked, so existing profiles keep working.)
        offers_any = (
            db.query(models.WorkerService.id)
            .filter(models.WorkerService.worker_id == worker.id)
            .first()
            is not None
        )
        if offers_any:
            offers_this = (
                db.query(models.WorkerService.id)
                .filter(
                    models.WorkerService.worker_id == worker.id,
                    models.WorkerService.service_id == booking.service_id,
                )
                .first()
                is not None
            )
            if not offers_this:
                raise HTTPException(status_code=400, detail="This worker does not offer the selected service")

    _check_price(booking.estimated_price, "estimated_price")

    if booking.booking_date is not None and booking.booking_date < datetime.utcnow().date():
        raise HTTPException(status_code=400, detail="booking_date cannot be in the past")

    _validate_worker_bookable(db, worker, booking)

    # Serialize creation per worker: take a row lock on the worker BEFORE the
    # double-booking check. Two concurrent POSTs for the same slot would
    # otherwise both see zero conflicts (check-then-insert race); the loser
    # blocks here until the winner commits, then re-reads and correctly 409s.
    # SQLite ignores FOR UPDATE, which is fine for its single-writer model.
    db.query(models.Worker).filter(models.Worker.id == booking.worker_id).with_for_update().first()

    # Reject double-booking the same worker at the same date/time.
    if booking.booking_date is not None:
        conflict_q = db.query(models.Booking.id).filter(
            models.Booking.worker_id == booking.worker_id,
            models.Booking.booking_date == booking.booking_date,
            models.Booking.status.in_(["pending", "upcoming"]),
        )
        if booking.booking_time is not None:
            conflict_q = conflict_q.filter(models.Booking.booking_time == booking.booking_time)
        if conflict_q.first() is not None:
            raise HTTPException(
                status_code=409,
                detail="This worker already has a booking at the requested date/time",
            )

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
        # A budget supplied at booking time is the client's opening proposal —
        # the worker can accept it outright via /accept-price.
        price_proposed_by="user" if booking.estimated_price is not None else None,
        customer_address=booking.customer_address,
        latitude=booking.latitude,
        longitude=booking.longitude,
        created_at=datetime.utcnow(),
    )
    db.add(new_booking)

    # Persist the request so an OFFLINE worker still sees it on next open —
    # the socket emit below only reaches currently-connected clients.
    job = (booking.problem_description or "").strip() or "a new job"
    notif_request = build_notification(
        db,
        booking.worker_id,
        "worker",
        "booking_request",
        "New booking request",
        f"New request: {job}",
    )

    db.commit()
    db.refresh(new_booking)

    publish_notification(db, notif_request, "worker")

    # Realtime: notify the worker (best-effort; the DB row above is the source of truth).
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
        # Customers don't set prices via raw PUT — their side of the
        # negotiation goes through /propose-price and /accept-price.
        data.pop("estimated_price", None)
        data.pop("final_price", None)
    elif booking.final_price is not None and ("estimated_price" in data or "final_price" in data):
        # Once both sides agreed, the price is locked — a unilateral PUT must
        # not be able to rewrite an agreed amount.
        raise HTTPException(
            status_code=400,
            detail="The price for this booking is already agreed and locked",
        )

    _check_price(data.get("estimated_price"), "estimated_price")
    _check_price(data.get("final_price"), "final_price")

    current_status = normalize_status(booking.status) or "pending"

    # Terminal bookings are immutable (price rewrites, date changes, etc.).
    # This check MUST run before status handling: with "status" in the body
    # a same-status PUT would otherwise skip the guard and rewrite fields on
    # a finished job (e.g. {"status": "completed", "final_price": 999999}).
    if current_status in ("completed", "rejected"):
        only_same_status = (
            set(data.keys()) == {"status"}
            and normalize_status(data.get("status")) == current_status
        )
        if data and not only_same_status:
            raise HTTPException(
                status_code=400,
                detail=f"This booking is {current_status} and can no longer be modified",
            )
        # Idempotent no-op (e.g. a retried completion request).
        return booking

    if "status" in data:
        normalized = normalize_status(data["status"])
        if normalized is None:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{data['status']}'. Allowed: pending, upcoming, completed, rejected",
            )
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

    # Reschedules must satisfy the same rules as a new booking — otherwise a
    # participant could move a job into a slot the worker never offered.
    if ("booking_date" in data or "booking_time" in data) and booking.worker_id is not None:
        new_date = data.get("booking_date", booking.booking_date)
        new_time = data.get("booking_time", booking.booking_time)
        if new_date is not None and new_date < datetime.utcnow().date():
            raise HTTPException(status_code=400, detail="booking_date cannot be in the past")
        worker_row = db.query(models.Worker).filter(models.Worker.id == booking.worker_id).first()
        if worker_row is not None:
            _validate_worker_bookable(
                db, worker_row,
                schemas.BookingCreate(
                    worker_id=booking.worker_id,
                    booking_date=new_date,
                    booking_time=new_time,
                ),
            )
        # Same double-booking rule as creation: another ACTIVE booking for
        # this worker at the target slot blocks the move (this booking itself
        # is excluded, so rescheduling within the same slot stays allowed).
        if new_date is not None:
            conflict_q = db.query(models.Booking.id).filter(
                models.Booking.worker_id == booking.worker_id,
                models.Booking.booking_date == new_date,
                models.Booking.status.in_(["pending", "upcoming"]),
                models.Booking.id != booking.id,
            )
            if new_time is not None:
                conflict_q = conflict_q.filter(models.Booking.booking_time == new_time)
            if conflict_q.first() is not None:
                raise HTTPException(
                    status_code=409,
                    detail="This worker already has a booking at the requested date/time",
                )

    became_completed = (
        data.get("status") == "completed"
        and current_status != "completed"
    )
    status_changed = data.get("status") is not None and data.get("status") != current_status

    # Persist a status-change notification for the OTHER participant in the
    # same transaction, so someone who was offline when the status flipped
    # still sees it in their inbox on next open (mirrors the price flow).
    status_notif = None
    status_notif_audience = None
    if status_changed:
        if is_worker_side:
            recipient_id, status_notif_audience = booking.user_id, "user"
        else:
            recipient_id, status_notif_audience = booking.worker_id, "worker"
        job = _job_label(booking)
        new_status = data["status"]
        if new_status == "upcoming":
            status_notif = build_notification(
                db, recipient_id, status_notif_audience, "booking_accepted",
                "Booking accepted ✓",
                f"Your {job} booking was accepted. Check the details and get ready.",
            )
        elif new_status == "completed":
            status_notif = build_notification(
                db, recipient_id, status_notif_audience, "booking_completed",
                "Job completed 🎉",
                f"The {job} job was marked completed. Leave a review for the other side.",
            )
        elif new_status == "rejected":
            declined_by_client = not is_worker_side
            status_notif = build_notification(
                db, recipient_id, status_notif_audience, "booking_declined",
                "Booking cancelled" if declined_by_client else "Booking declined",
                (
                    f"The client cancelled the {job} booking."
                    if declined_by_client
                    else f"Your request for {job} was declined by the worker."
                ),
            )

    for field, value in data.items():
        setattr(booking, field, value)

    # A worker quote made via PUT is a proposal the client can accept via
    # /accept-price.
    if is_worker_side and "estimated_price" in data and booking.final_price is None:
        booking.price_proposed_by = "worker"

    # Completing the job settles the negotiation: if no agreement was reached,
    # the latest number on the table becomes the final price so a completed
    # booking never dangles without one.
    if became_completed and booking.final_price is None and booking.estimated_price is not None:
        booking.final_price = booking.estimated_price

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
        # Atomic SQL increment — a read-modify-write here loses updates when
        # two bookings for the same worker complete concurrently. coalesce
        # guards legacy rows whose counters are NULL.
        db.query(models.Worker).filter(models.Worker.id == booking.worker_id).update(
            {
                "completed_jobs": func.coalesce(models.Worker.completed_jobs, 0) + 1,
                "total_jobs": func.coalesce(models.Worker.total_jobs, 0) + 1,
            },
            synchronize_session=False,
        )

    db.commit()
    db.refresh(booking)

    if status_notif is not None:
        # Only reached after the commit landed, so the socket event can never
        # point at a notification row that was rolled back.
        publish_notification(db, status_notif, status_notif_audience)

    if not data:
        # Empty PUT: nothing changed, so don't spam the other participant.
        return booking

    # Realtime: notify the OTHER participant of the change (status and/or price).
    if is_worker_side:
        other_id, other_role = booking.user_id, "user"
    else:
        other_id, other_role = booking.worker_id, "worker"
    emit_to_user(other_id, "booking_status_changed", {
        "booking_id": booking.id,
        "status": booking.status,
        "estimated_price": float(booking.estimated_price) if booking.estimated_price is not None else None,
        "final_price": float(booking.final_price) if booking.final_price is not None else None,
        "price_proposed_by": booking.price_proposed_by,
        "updated_by": uid,
        "timestamp": datetime.utcnow().isoformat(),
    }, role=other_role)

    return booking


# ---------------------------------------------------------------------------
# Price negotiation
#
# The agreed-price flow: either side proposes a number (a worker quote or a
# client budget/counter), and the OTHER side accepts it. While negotiating,
# estimated_price holds the latest proposal and price_proposed_by says who
# made it. Acceptance copies it into final_price, which locks the price —
# after that neither side can change it through PUT or new proposals.
# ---------------------------------------------------------------------------

def _fmt_price(value) -> str:
    """₹500 not ₹500.00 — 'g' drops trailing zeros on floats and Decimals."""
    return f"₹{value:g}"


def _job_label(booking: models.Booking) -> str:
    return (booking.problem_description or "").strip() or "your job"


def _price_payload(booking: models.Booking, actor_uid: int) -> Dict[str, Any]:
    return {
        "booking_id": booking.id,
        "status": booking.status,
        "estimated_price": float(booking.estimated_price) if booking.estimated_price is not None else None,
        "final_price": float(booking.final_price) if booking.final_price is not None else None,
        "price_proposed_by": booking.price_proposed_by,
        "updated_by": actor_uid,
        "timestamp": datetime.utcnow().isoformat(),
    }


def _notify_price_event(
    db: Session,
    booking: models.Booking,
    recipient_id: int,
    audience: str,  # 'user' | 'worker'
    kind: str,
    title: str,
    body: str,
) -> models.Notification:
    """Queue a price-flow notification in the same transaction as the price
    change. Returns the row so the caller can publish it (socket emit) after
    the commit lands."""
    return build_notification(db, recipient_id, audience, kind, title, body)


def _load_booking_for_update(db: Session, booking_id: int) -> models.Booking:
    booking = (
        db.query(models.Booking)
        .filter(models.Booking.id == booking_id)
        .with_for_update()
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    return booking


def _reject_if_terminal(booking: models.Booking) -> None:
    current_status = normalize_status(booking.status) or "pending"
    if current_status in ("completed", "rejected"):
        raise HTTPException(
            status_code=400,
            detail=f"This booking is {current_status} and can no longer be modified",
        )


@router.post("/{booking_id}/propose-price", response_model=schemas.BookingResponse)
@limiter.limit("20/minute")
def propose_price(
    request: Request,
    booking_id: int,
    proposal: schemas.PriceProposal,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Put a number on the table — a worker quote or a client budget/counter.
    Either participant may propose; the other side accepts via /accept-price.
    Proposing is blocked once a price is agreed (final_price set)."""
    booking = _load_booking_for_update(db, booking_id)
    _assert_participant(booking, current)
    _reject_if_terminal(booking)

    uid = _current_user_id(current)
    is_worker_side = current.get("role") == "worker" and booking.worker_id == uid

    if booking.final_price is not None:
        raise HTTPException(
            status_code=400,
            detail="The price for this booking is already agreed and locked",
        )
    if booking.worker_id is None:
        raise HTTPException(status_code=400, detail="This booking has no worker to negotiate with")

    _check_price(proposal.amount, "amount")

    booking.estimated_price = proposal.amount
    booking.price_proposed_by = "worker" if is_worker_side else "user"

    job = _job_label(booking)
    amount = _fmt_price(proposal.amount)
    if is_worker_side:
        notif = _notify_price_event(
            db, booking, booking.user_id, "user", "price_proposed",
            "Worker shared a price quote",
            f"{amount} proposed for {job}. Open the booking to accept it or send a counter-offer.",
        )
        notif_audience = "user"
    else:
        notif = _notify_price_event(
            db, booking, booking.worker_id, "worker", "price_proposed",
            "New price proposal",
            f"The client proposed {amount} for {job}. Open the request to accept it or send a counter-offer.",
        )
        notif_audience = "worker"

    db.commit()
    db.refresh(booking)
    publish_notification(db, notif, notif_audience)

    other_id, other_role = (booking.user_id, "user") if is_worker_side else (booking.worker_id, "worker")
    emit_to_user(other_id, "booking_status_changed", _price_payload(booking, uid), role=other_role)

    return booking


@router.post("/{booking_id}/accept-price", response_model=schemas.BookingResponse)
@limiter.limit("20/minute")
def accept_price(
    request: Request,
    booking_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Accept the number currently on the table and lock it as the agreed
    price. Only the side that did NOT propose can accept — accepting your own
    proposal would let either side force an agreement. Re-accepting an already
    agreed price is an idempotent success (safe retry)."""
    booking = _load_booking_for_update(db, booking_id)
    _assert_participant(booking, current)

    uid = _current_user_id(current)
    is_worker_side = current.get("role") == "worker" and booking.worker_id == uid

    if booking.final_price is not None:
        # Already agreed — accept again is a no-op, not an error.
        return booking

    _reject_if_terminal(booking)

    if booking.estimated_price is None:
        raise HTTPException(
            status_code=400,
            detail="There is no price to accept yet — wait for a quote or propose one first",
        )

    # Legacy rows predate price_proposed_by; historically only workers could
    # set prices, so a NULL marker is treated as a worker quote.
    proposed_by = booking.price_proposed_by or "worker"
    my_side = "worker" if is_worker_side else "user"
    if proposed_by == my_side:
        raise HTTPException(
            status_code=400,
            detail="This is your own proposal — wait for the other side to accept it or send a counter-offer",
        )

    booking.final_price = booking.estimated_price

    amount = _fmt_price(booking.final_price)
    job = _job_label(booking)
    other_id, other_role = (booking.user_id, "user") if is_worker_side else (booking.worker_id, "worker")
    notif = _notify_price_event(
        db, booking, other_id, other_role, "price_agreed",
        f"Price agreed {amount} ✓",
        f"Both sides agreed on {amount} for {job}.",
    )

    db.commit()
    db.refresh(booking)

    publish_notification(db, notif, other_role)
    emit_to_user(other_id, "booking_status_changed", _price_payload(booking, uid), role=other_role)

    return booking
