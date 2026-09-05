from fastapi import APIRouter, Depends, HTTPException, Body, Query, Request
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import datetime
import threading
import requests
import database, models
from auth import get_current_user
from rate_limit import limiter
from socket_events import emit_to_user

router = APIRouter()

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


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


def _audience_filter(audience: str):
    """SQL filter for an audience's notifications.

    Legacy rows written before the "audience:kind" encoding have no prefix;
    _decode_type treats those as user notifications, so the user inbox must
    include them — otherwise they silently disappear forever."""
    prefixed = models.Notification.type.like(f"{audience}:%")
    role_match = or_(
        models.Notification.user_role == audience,
        models.Notification.user_role.is_(None),
    )
    if audience == "user":
        return role_match & or_(prefixed, models.Notification.type.notlike("%:%"))
    return role_match & prefixed


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


def _unread_count(db: Session, uid: int, audience: str) -> int:
    q = db.query(models.Notification).filter(
        models.Notification.is_read == False,  # noqa: E712
        models.Notification.user_id == uid,
    )
    q = q.filter(_audience_filter(audience))
    return q.count()


def build_notification(
    db: Session,
    recipient_id: int,
    audience: str,
    kind: str,
    title: str,
    body: str,
) -> models.Notification:
    """Add an unread notification row to the session — no commit, no emit.

    Server-side writers (bookings price flow, the POST endpoint below) share
    this so every row uses the 'audience:kind' type encoding. Call
    publish_notification() AFTER committing so the socket event never points
    at a row that gets rolled back."""
    n = models.Notification(
        user_id=recipient_id,
        user_role=audience,
        title=(title or "")[:255],
        message=(body or "")[:1000],
        type=_encode_type(audience, kind),
        is_read=False,
        created_at=datetime.utcnow(),
    )
    db.add(n)
    return n


def publish_notification(db: Session, n: models.Notification, audience: str) -> None:
    """Push a committed notification to the recipient's private socket room.

    The payload carries the fresh unread count so badge screens can update
    without refetching. Best-effort: when the recipient is offline the emit
    is skipped and the row simply appears on their next load."""
    payload = _to_dict(n)
    payload["unread_count"] = _unread_count(db, n.user_id, audience)
    emit_to_user(n.user_id, "notification_created", payload, role=audience)
    _push_to_device(db, n, audience)


def _push_to_device(db: Session, n: models.Notification, audience: str) -> None:
    """Send a system push via the Expo push API so the notification arrives
    even when the app is closed or in the background.

    Best-effort and off-thread: a slow/unreachable Expo endpoint must never
    delay the request that created the notification. Tokens are looked up
    synchronously (cheap local query); only the HTTP call is backgrounded."""
    rows = (
        db.query(models.PushToken.token)
        .filter(
            models.PushToken.user_id == n.user_id,
            models.PushToken.role == audience,
        )
        .all()
    )
    tokens = [t for (t,) in rows if t]
    if not tokens:
        return
    kind = _decode_type(n.type)["kind"]
    threading.Thread(
        target=_send_expo_push,
        args=(tokens, n.title or "WorkMithra", (n.message or "")[:256], {"id": n.id, "kind": kind}),
        daemon=True,
    ).start()


def _prune_dead_tokens(dead_tokens: List[str]) -> None:
    if not dead_tokens:
        return
    db = database.SessionLocal()
    try:
        db.query(models.PushToken).filter(models.PushToken.token.in_(dead_tokens)).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _send_expo_push(tokens: List[str], title: str, body: str, data: Dict[str, Any]) -> None:
    messages = [
        {
            "to": token,
            "sound": "default",
            "title": title,
            "body": body,
            "data": data,
            "priority": "high",
        }
        for token in tokens
    ]
    try:
        resp = requests.post(EXPO_PUSH_URL, json=messages, timeout=5)
        if resp.ok:
            tickets = (resp.json() or {}).get("data", [])
            dead_tokens = []
            for i, ticket in enumerate(tickets):
                if ticket.get("status") == "error":
                    details = ticket.get("details", {})
                    if details.get("error") in ("DeviceNotRegistered", "DeviceUnregistered"):
                        if i < len(tokens):
                            dead_tokens.append(tokens[i])
            if dead_tokens:
                _prune_dead_tokens(dead_tokens)
    except Exception:
        # Push is best-effort — the in-app inbox still has the row.
        pass


@router.post("/push-token")
@limiter.limit("10/minute")
def register_push_token(
    request: Request,
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Register the caller's Expo push token. The role is taken from the
    authenticated token — never from the client — so a token can only be
    bound to the caller's own (id, role) pair."""
    token = str(payload.get("token") or "").strip()
    if not token or len(token) > 255:
        raise HTTPException(status_code=400, detail="token is required")
    uid = _current_user_id(current)
    role = current.get("role", "user")
    if role not in ("user", "worker"):
        role = "user"
    # A device token belongs to exactly one account: re-registering from a
    # different login reassigns it instead of leaving a stale row that would
    # push the wrong person's alerts to this device.
    db.query(models.PushToken).filter(models.PushToken.token == token).delete()
    db.add(models.PushToken(user_id=uid, role=role, token=token))
    db.commit()
    return {"ok": True}


@router.delete("/push-token")
def unregister_push_token(
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Remove the caller's push tokens (logout / role switch)."""
    uid = _current_user_id(current)
    role = current.get("role", "user")
    deleted = (
        db.query(models.PushToken)
        .filter(models.PushToken.user_id == uid, models.PushToken.role == role)
        .delete()
    )
    db.commit()
    return {"ok": True, "deleted": deleted}


@router.post("/")
@limiter.limit("30/minute")
def create_notification(
    request: Request,
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

    n = build_notification(db, recipient_id, audience, kind, title, body)
    db.commit()
    db.refresh(n)
    publish_notification(db, n, audience)
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
    # Filter by audience prefix in the type column (legacy prefix-less rows
    # are included for the user audience).
    q = q.filter(_audience_filter(audience))
    rows = q.order_by(models.Notification.created_at.desc(), models.Notification.id.desc()).offset(skip).limit(limit).all()
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
    return {"count": _unread_count(db, uid, audience)}


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
    payload: Optional[Dict[str, Any]] = Body(default=None),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Mark all of the caller's notifications read. The body is optional —
    audience defaults to the caller's role."""
    audience = _own_audience((payload or {}).get("audience") or current.get("role", "user"), current)
    uid = _current_user_id(current)
    updated = (
        db.query(models.Notification)
        .filter(
            _audience_filter(audience),
            models.Notification.user_id == uid,
            models.Notification.is_read == False,  # noqa: E712
        )
        .update({"is_read": True}, synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "updated": updated}


@router.delete("/")
def clear_all(
    audience: str = "user",
    recipient_id: Optional[str] = None,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    audience = _own_audience(audience, current)
    uid = _current_user_id(current)
    deleted = (
        db.query(models.Notification)
        .filter(
            _audience_filter(audience),
            models.Notification.user_id == uid,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "deleted": deleted}
