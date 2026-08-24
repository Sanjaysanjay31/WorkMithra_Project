from fastapi import APIRouter, Depends, HTTPException, Body, Query
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from datetime import datetime
import database, models
from auth import get_current_user

router = APIRouter()


def _current_user_id(current: Dict[str, Any]) -> int:
    try:
        return int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")


def _valid_audience(audience: str) -> str:
    """Audience is interpolated into a SQL LIKE pattern, so it must be one of
    the two known values — anything else (including %/_ wildcards) is rejected."""
    audience = (audience or "user").strip()
    if audience not in ("user", "worker"):
        raise HTTPException(status_code=400, detail="audience must be 'user' or 'worker'")
    return audience


def _own_audience(audience: str, current: Dict[str, Any]) -> str:
    """Validate the audience AND require it to match the caller's role.

    users and workers have overlapping numeric ids, and the recipient is
    stored as a bare user_id — so without this check a worker with id N could
    list/read/clear the notifications of user N (a different person)."""
    audience = _valid_audience(audience)
    role = current.get("role", "user")
    if audience != role:
        raise HTTPException(status_code=403, detail="You can only access your own notifications")
    return audience

# We encode (audience, kind) into the `type` column as "audience:kind",
# e.g. "user:booking_accepted", "worker:booking_request". This keeps the
# existing notifications table schema untouched.


def _encode_type(audience: str, kind: str) -> str:
    return f"{audience}:{kind}"


def _decode_type(t: Optional[str]) -> Dict[str, str]:
    if not t or ":" not in t:
        return {"audience": "user", "kind": (t or "info")}
    audience, kind = t.split(":", 1)
    return {"audience": audience, "kind": kind}


def _to_dict(n: models.Notification) -> Dict[str, Any]:
    decoded = _decode_type(n.type)
    return {
        "id": n.id,
        "title": n.title or "",
        "body": n.message or "",
        "audience": decoded["audience"],
        "recipient_id": str(n.user_id) if n.user_id is not None else "",
        "kind": decoded["kind"],
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "read": bool(n.is_read),
    }


@router.post("/")
def create_notification(
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Create a notification.
    Expected body: { audience, recipient_id, title, body, kind, data? }
    `recipient_id` is stored as user_id (int) on the notifications table.

    Anti-spoofing: the sender must share a booking with the recipient —
    clients can only notify workers they've booked, workers can only notify
    clients who booked them. Arbitrary notifications to strangers are
    rejected."""
    audience = (payload.get("audience") or "user").strip()
    if audience not in ("user", "worker"):
        raise HTTPException(status_code=400, detail="audience must be 'user' or 'worker'")
    kind = (payload.get("kind") or "info").strip()
    if not kind.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="invalid kind")
    title = str(payload.get("title") or "")[:255]
    body = str(payload.get("body") or "")[:1000]
    recipient_raw = payload.get("recipient_id")
    try:
        recipient_id = int(recipient_raw) if recipient_raw not in (None, "") else None
    except (ValueError, TypeError):
        recipient_id = None
    if recipient_id is None:
        raise HTTPException(status_code=400, detail="recipient_id is required")

    sender_id = _current_user_id(current)
    sender_role = current.get("role", "user")
    if sender_role == "worker":
        # worker -> client: a booking must exist between them
        linked = (
            db.query(models.Booking.id)
            .filter(
                models.Booking.worker_id == sender_id,
                models.Booking.user_id == recipient_id,
            )
            .first()
        )
        if audience != "user":
            raise HTTPException(status_code=403, detail="Workers can only notify clients")
    else:
        # client -> worker: a booking must exist between them
        linked = (
            db.query(models.Booking.id)
            .filter(
                models.Booking.user_id == sender_id,
                models.Booking.worker_id == recipient_id,
            )
            .first()
        )
        if audience != "worker":
            raise HTTPException(status_code=403, detail="Clients can only notify workers")
    if linked is None:
        raise HTTPException(
            status_code=403,
            detail="You can only notify users you share a booking with",
        )

    n = models.Notification(
        title=title,
        message=body,
        type=_encode_type(audience, kind),
        is_read=False,
        user_id=recipient_id,
        created_at=datetime.utcnow(),
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return _to_dict(n)


@router.get("/")
def list_notifications(
    audience: str = "user",
    recipient_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """List notifications for the logged-in user (latest first).
    `recipient_id` is accepted for compatibility but always resolves to the token owner."""
    audience = _own_audience(audience, current)
    uid = _current_user_id(current)
    if recipient_id not in (None, ""):
        try:
            if int(recipient_id) != uid:
                raise HTTPException(status_code=403, detail="You can only read your own notifications")
        except (ValueError, TypeError):
            return []
    q = db.query(models.Notification).filter(models.Notification.user_id == uid)
    # Filter by audience prefix in the type column.
    q = q.filter(models.Notification.type.like(f"{audience}:%"))
    rows = q.order_by(models.Notification.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_dict(r) for r in rows]


@router.get("/unread-count")
def unread_count(
    audience: str = "user",
    recipient_id: Optional[str] = None,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    audience = _own_audience(audience, current)
    uid = _current_user_id(current)
    if recipient_id not in (None, ""):
        try:
            if int(recipient_id) != uid:
                raise HTTPException(status_code=403, detail="You can only read your own notifications")
        except (ValueError, TypeError):
            return {"count": 0}
    q = db.query(models.Notification).filter(
        models.Notification.is_read == False,  # noqa: E712
        models.Notification.user_id == uid,
    )
    q = q.filter(models.Notification.type.like(f"{audience}:%"))
    return {"count": q.count()}


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    n = db.query(models.Notification).filter(models.Notification.id == notification_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    if n.user_id != _current_user_id(current):
        raise HTTPException(status_code=403, detail="Not your notification")
    # The stored audience (encoded in `type`) must match the caller's role —
    # ids overlap between users and workers.
    if _decode_type(n.type)["audience"] != current.get("role", "user"):
        raise HTTPException(status_code=403, detail="Not your notification")
    n.is_read = True
    db.commit()
    return {"ok": True}


@router.post("/mark-all-read")
def mark_all_read(
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    audience = _own_audience(payload.get("audience") or "user", current)
    uid = _current_user_id(current)
    q = db.query(models.Notification).filter(
        models.Notification.type.like(f"{audience}:%"),
        models.Notification.user_id == uid,
    )
    rows = q.all()
    for n in rows:
        n.is_read = True
    db.commit()
    return {"ok": True, "updated": len(rows)}


@router.delete("/")
def clear_all(
    audience: str = "user",
    recipient_id: Optional[str] = None,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    audience = _own_audience(audience, current)
    uid = _current_user_id(current)
    q = db.query(models.Notification).filter(
        models.Notification.type.like(f"{audience}:%"),
        models.Notification.user_id == uid,
    )
    rows = q.all()
    count = len(rows)
    for n in rows:
        db.delete(n)
    db.commit()
    return {"ok": True, "deleted": count}
