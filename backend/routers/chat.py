from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from datetime import datetime
import database, models, schemas
from auth import get_current_user
from rate_limit import limiter
from socket_events import emit_to_user

router = APIRouter()

# Messaging is a paid-feature surface (DB writes per keystroke-scale abuse).
# Generous for real conversations, hostile to bulk spam.
SEND_RATE_LIMIT = "30/minute"


def _current_user_id(current: Dict[str, Any]) -> int:
    try:
        return int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")


def _participants_share_booking(db: Session, a_id: int, a_role: str, b_id: int, b_role: str) -> bool:
    """True when the two identities appear together on at least one booking.

    This is what makes messaging opt-in rather than an open channel: you can
    only talk to someone you actually hired or were hired by. Users and
    workers live in separate tables, so the pair always normalizes to one
    (user_id, worker_id) row lookup."""
    if {a_role, b_role} != {"user", "worker"}:
        return False
    user_side = a_id if a_role == "user" else b_id
    worker_side = a_id if a_role == "worker" else b_id
    return (
        db.query(models.Booking.id)
        .filter(
            models.Booking.user_id == user_side,
            models.Booking.worker_id == worker_side,
        )
        .first()
        is not None
    )


def _resolve_receiver_role(db: Session, receiver_id: int, booking_id: Optional[int], sender_role: str) -> Optional[str]:
    """Determine whether the receiver is a user or a worker.

    Returns None when the receiver doesn't exist in either table. When the id
    exists in both (separate id spaces), prefer the booking's participant
    layout, then the opposite of the sender's role."""
    if booking_id is not None:
        booking = db.query(models.Booking).filter(models.Booking.id == booking_id).first()
        if booking is not None:
            if booking.worker_id == receiver_id:
                return "worker"
            if booking.user_id == receiver_id:
                return "user"
    is_user = db.query(models.User.id).filter(models.User.id == receiver_id).first() is not None
    is_worker = db.query(models.Worker.id).filter(models.Worker.id == receiver_id).first() is not None
    if is_user and is_worker:
        return "worker" if sender_role == "user" else "user"
    if is_worker:
        return "worker"
    if is_user:
        return "user"
    return None


@router.post("/", response_model=dict)
@limiter.limit(SEND_RATE_LIMIT)
def send_message(
    request: Request,
    message: schemas.ChatMessageBase,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Send a chat message. The sender is always the authenticated user.

    Messaging is allowed before a booking is created — workers and clients can
    chat to discuss requirements, pricing, and availability. When a booking_id
    is provided the message is linked to it; otherwise it is a free-form chat.
    The message is persisted first (source of truth), then pushed to the
    receiver over Socket.IO as a best-effort realtime notification."""
    if not message.receiver_id:
        raise HTTPException(status_code=400, detail="receiver_id is required")
    if not message.message or not message.message.strip():
        raise HTTPException(status_code=400, detail="message is required")

    sender_id = _current_user_id(current)
    sender_role = current.get("role", "user")
    receiver_role = _resolve_receiver_role(db, int(message.receiver_id), message.booking_id, sender_role)
    if receiver_role is None:
        raise HTTPException(status_code=404, detail="Recipient not found")
    # Same numeric id in the same role = messaging yourself (users and
    # workers have overlapping id spaces, so the role must match too).
    if int(message.receiver_id) == sender_id and receiver_role == sender_role:
        raise HTTPException(status_code=400, detail="Cannot send a message to yourself")

    # When a booking is referenced, BOTH participants must belong to it —
    # otherwise a participant of booking X could attach booking_id=X to a
    # message addressed to an unrelated third party.
    if message.booking_id is not None:
        booking = db.query(models.Booking).filter(models.Booking.id == message.booking_id).first()
        if booking is None:
            raise HTTPException(status_code=404, detail="Booking not found")
        if sender_id not in (booking.user_id, booking.worker_id):
            raise HTTPException(status_code=403, detail="You are not part of this booking")
        if int(message.receiver_id) not in (booking.user_id, booking.worker_id):
            raise HTTPException(status_code=403, detail="The recipient is not part of this booking")

    new_message = models.ChatMessage(
        sender_id=sender_id,
        sender_role=sender_role,
        receiver_id=message.receiver_id,
        receiver_role=receiver_role,
        booking_id=message.booking_id,
        message=message.message,
        sent_at=datetime.utcnow(),
    )
    db.add(new_message)
    db.commit()
    db.refresh(new_message)

    payload = {
        "id": new_message.id,
        "sender_id": sender_id,
        "sender_role": sender_role,
        "receiver_id": new_message.receiver_id,
        "receiver_role": receiver_role,
        "message": new_message.message,
        "booking_id": new_message.booking_id,
        "sent_at": new_message.sent_at.isoformat() if new_message.sent_at else None,
        "timestamp": datetime.utcnow().isoformat(),
    }
    # Deliver to the receiver, and echo back to the sender's room so the
    # sender's other devices stay in sync.
    emit_to_user(new_message.receiver_id, "receive_message", payload, role=receiver_role)
    emit_to_user(sender_id, "receive_message", payload, role=sender_role)

    return {"id": new_message.id, "status": "sent"}


@router.get("/{user_id}/messages", response_model=List[schemas.ChatMessageResponse])
def get_user_messages(
    user_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Get messages for a user. Users may only read their own inbox.

    Identity is (id, role): users and workers have overlapping id spaces, so
    an id-only check would let worker #N read user #N's inbox. Legacy rows
    with NULL roles are NOT matched — a NULL row would otherwise be readable
    by user #N AND worker #N, who are different people."""
    if user_id != _current_user_id(current):
        raise HTTPException(status_code=403, detail="You can only read your own messages")
    role = current.get("role", "user")
    sent_me = (models.ChatMessage.receiver_id == user_id) & (models.ChatMessage.receiver_role == role)
    from_me = (models.ChatMessage.sender_id == user_id) & (models.ChatMessage.sender_role == role)
    messages = db.query(models.ChatMessage).filter(
        sent_me | from_me
    ).order_by(
        models.ChatMessage.sent_at.desc(), models.ChatMessage.id.desc()
    ).offset(skip).limit(limit).all()
    return messages


@router.get("/conversation/{user_id}/{other_user_id}", response_model=List[schemas.ChatMessageResponse])
def get_conversation(
    user_id: int,
    other_user_id: int,
    other_role: Optional[str] = Query(None, description="Role of the other participant ('user' or 'worker')"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Get conversation between two users. Caller must be one of the participants.
    The `user_id` path param is validated against the JWT, and the caller's
    role must also match — preventing a worker with a colliding numeric id
    from reading a user's conversation.
    If `other_role` is supplied, messages are strictly filtered to that counterpart's role,
    preventing ID collisions between User #N and Worker #N."""
    uid = _current_user_id(current)
    role = current.get("role", "user")
    if uid not in (user_id, other_user_id):
        raise HTTPException(status_code=403, detail="You are not part of this conversation")
    # The caller's side of the conversation must involve their own role.
    # Legacy NULL-role rows are excluded: they'd otherwise be visible to two
    # different people who happen to share a numeric id.
    me_as_sender = (models.ChatMessage.sender_id == uid) & (models.ChatMessage.sender_role == role)
    me_as_receiver = (models.ChatMessage.receiver_id == uid) & (models.ChatMessage.receiver_role == role)

    if other_role:
        norm_other_role = other_role.strip().lower()
        if norm_other_role not in ("user", "worker"):
            raise HTTPException(status_code=400, detail="other_role must be 'user' or 'worker'")
        other_filter = (
            (me_as_sender & (models.ChatMessage.receiver_id == other_user_id) & (models.ChatMessage.receiver_role == norm_other_role)) |
            (me_as_receiver & (models.ChatMessage.sender_id == other_user_id) & (models.ChatMessage.sender_role == norm_other_role))
        )
        query = db.query(models.ChatMessage).filter(other_filter)
    else:
        pair = (
            ((models.ChatMessage.sender_id == user_id) & (models.ChatMessage.receiver_id == other_user_id)) |
            ((models.ChatMessage.sender_id == other_user_id) & (models.ChatMessage.receiver_id == user_id))
        )
        query = db.query(models.ChatMessage).filter(pair & (me_as_sender | me_as_receiver))

    messages = query.order_by(
        models.ChatMessage.sent_at.asc(), models.ChatMessage.id.asc()
    ).offset(skip).limit(limit).all()
    return messages
