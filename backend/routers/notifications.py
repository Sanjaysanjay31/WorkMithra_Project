from fastapi import APIRouter, Depends, HTTPException, Body
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from datetime import datetime
import database, models

router = APIRouter()

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
def create_notification(payload: Dict[str, Any] = Body(...), db: Session = Depends(database.get_db)):
    """Create a notification.
    Expected body: { audience, recipient_id, title, body, kind, data? }
    `recipient_id` is stored as user_id (int) on the notifications table.
    """
    audience = (payload.get("audience") or "user").strip()
    kind = (payload.get("kind") or "info").strip()
    title = payload.get("title") or ""
    body = payload.get("body") or ""
    recipient_raw = payload.get("recipient_id")
    try:
        recipient_id = int(recipient_raw) if recipient_raw not in (None, "") else None
    except (ValueError, TypeError):
        recipient_id = None

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
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(database.get_db),
):
    """List notifications for the given audience + recipient (latest first)."""
    q = db.query(models.Notification)
    if recipient_id is not None and recipient_id != "":
        try:
            q = q.filter(models.Notification.user_id == int(recipient_id))
        except (ValueError, TypeError):
            return []
    # Filter by audience prefix in the type column.
    q = q.filter(models.Notification.type.like(f"{audience}:%"))
    rows = q.order_by(models.Notification.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_dict(r) for r in rows]


@router.get("/unread-count")
def unread_count(
    audience: str = "user",
    recipient_id: Optional[str] = None,
    db: Session = Depends(database.get_db),
):
    q = db.query(models.Notification).filter(models.Notification.is_read == False)  # noqa: E712
    if recipient_id:
        try:
            q = q.filter(models.Notification.user_id == int(recipient_id))
        except (ValueError, TypeError):
            return {"count": 0}
    q = q.filter(models.Notification.type.like(f"{audience}:%"))
    return {"count": q.count()}


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, db: Session = Depends(database.get_db)):
    n = db.query(models.Notification).filter(models.Notification.id == notification_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.is_read = True
    db.commit()
    return {"ok": True}


@router.post("/mark-all-read")
def mark_all_read(
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(database.get_db),
):
    audience = (payload.get("audience") or "user").strip()
    recipient_id = payload.get("recipient_id")
    q = db.query(models.Notification).filter(models.Notification.type.like(f"{audience}:%"))
    if recipient_id not in (None, ""):
        try:
            q = q.filter(models.Notification.user_id == int(recipient_id))
        except (ValueError, TypeError):
            return {"ok": True, "updated": 0}
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
):
    q = db.query(models.Notification).filter(models.Notification.type.like(f"{audience}:%"))
    if recipient_id not in (None, ""):
        try:
            q = q.filter(models.Notification.user_id == int(recipient_id))
        except (ValueError, TypeError):
            return {"ok": True, "deleted": 0}
    rows = q.all()
    count = len(rows)
    for n in rows:
        db.delete(n)
    db.commit()
    return {"ok": True, "deleted": count}
