import asyncio
import functools
import os
import socketio
import logging
from datetime import datetime
from typing import Optional
from socket_manager import socket_manager
from auth import decode_token_safe

logger = logging.getLogger(__name__)

# Same origin allowlist as the REST API (ALLOWED_ORIGINS in backend/.env).
# When unset we fall back to the local dev origins — never a wildcard, so a
# misconfigured production deploy fails closed instead of opening to everyone.
_DEV_ORIGINS = [
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:19006",
    "http://localhost:3000",
]
_origins_csv = os.getenv("ALLOWED_ORIGINS", "").strip()
_allowed_origins = [o.strip() for o in _origins_csv.split(",") if o.strip()] or _DEV_ORIGINS

# Initialize Socket.IO AsyncServer
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins=_allowed_origins)

# Statuses a client may set for itself. Anything else is rejected so a socket
# can't broadcast arbitrary strings to every connected client.
_ALLOWED_STATUSES = {"online", "available", "busy", "offline"}

# Room that every authenticated socket joins so presence events reach only
# logged-in clients instead of broadcasting to the whole world (including
# unauthenticated connections).
PRESENCE_ROOM = "presence"

# ---------------------------------------------------------------------------
# Thread-safe emit bridge
#
# REST endpoints (bookings, chat) run in worker threads, but Socket.IO emits
# must be scheduled on the ASGI server's event loop. main.py captures that
# loop at startup via set_main_loop(); emit_to_user() then lets any sync
# endpoint push realtime events safely.
# ---------------------------------------------------------------------------
_main_loop = None


def set_main_loop(loop) -> None:
    global _main_loop
    _main_loop = loop


def room_for(user_id, role: str = "user") -> str:
    """Private room name for an identity. Role-scoped because users and
    workers are separate tables with overlapping numeric ids."""
    if role not in ("user", "worker"):
        role = "user"
    return f"{role}_{int(user_id)}"


def emit_to_user(user_id, event: str, data: dict, role: str = "user") -> bool:
    """Emit an event to a user's private room from any thread.

    Returns True if the emit was scheduled. Silently returns False when the
    user is offline or the loop is unavailable — the persisted DB row is the
    source of truth and the client loads it on next open.
    """
    if user_id is None or _main_loop is None or _main_loop.is_closed():
        return False
    try:
        asyncio.run_coroutine_threadsafe(
            sio.emit(event, data, room=room_for(user_id, role)), _main_loop
        )
        return True
    except (RuntimeError, ValueError, TypeError) as e:
        logger.warning(f"emit_to_user({user_id}, {event}) failed: {e}")
        return False


def _resolve_role(user_id: int, prefer: str = None) -> str:
    """Determine whether an id belongs to a user or a worker.

    When the id exists in BOTH tables (they are separate id spaces), prefer
    the given role — callers pass the opposite of their own role, since
    clients chat with workers and workers chat with clients.

    Results are cached: ids never move between tables, and typing indicators
    make this a per-keystroke lookup — opening a fresh DB session each time
    churned the connection pool."""
    return _resolve_role_cached(int(user_id), prefer)


@functools.lru_cache(maxsize=2048)
def _resolve_role_cached(user_id: int, prefer: Optional[str]) -> str:
    import database, models
    db = database.SessionLocal()
    try:
        if prefer in ("user", "worker"):
            row = (
                db.query(models.User.id).filter(models.User.id == user_id).first()
                if prefer == "user"
                else db.query(models.Worker.id).filter(models.Worker.id == user_id).first()
            )
            if row:
                return prefer
        if db.query(models.User.id).filter(models.User.id == user_id).first():
            return "user"
        if db.query(models.Worker.id).filter(models.Worker.id == user_id).first():
            return "worker"
        return "user"
    finally:
        db.close()


def _auth(sid):
    """(user_id, role) for an authenticated socket, else None."""
    return socket_manager.get_user_for_socket(sid)


# ---------------------------------------------------------------------------
# Blocking DB helpers
#
# Socket.IO handlers below are async and run on the event loop, so any
# synchronous SQLAlchemy work must go through asyncio.to_thread() — a slow
# query would otherwise freeze every connected socket.
# ---------------------------------------------------------------------------


def _load_account(user_id: int, role: str):
    """(is_active, token_version) for the account a token refers to, or None
    when the account no longer exists. Returns plain values (not ORM rows) so
    nothing is touched after the session closes."""
    import database, models
    db = database.SessionLocal()
    try:
        model = models.Worker if role == "worker" else models.User
        account = db.query(model).filter(model.id == user_id).first()
        if account is None:
            return None
        return (getattr(account, "is_active", True), getattr(account, "token_version", 0) or 0)
    finally:
        db.close()


def _persist_worker_status(user_id: int, status_value: str) -> None:
    """Write a worker's presence status to the DB (booking validation reads it)."""
    import database, models
    db = database.SessionLocal()
    try:
        db.query(models.Worker).filter(models.Worker.id == user_id).update(
            {"current_status": status_value}, synchronize_session=False
        )
        db.commit()
    except Exception as e:
        logger.warning(f"set_status persist failed for worker {user_id}: {e}")
        db.rollback()
    finally:
        db.close()


@sio.event
async def connect(sid, environ):
    logger.info(f"Socket connected: {sid}")
    await sio.emit('connected', {'sid': sid}, room=sid)

@sio.event
async def disconnect(sid):
    # remove_connection returns the identity only when the LAST socket for
    # that user disconnects — no false 'user_offline' while other sockets
    # are still live.
    identity = socket_manager.remove_connection(sid)
    if identity:
        user_id, role = identity
        logger.info(f"{role} {user_id} (socket {sid}) disconnected")
        await sio.emit('user_offline', {
            'user_id': user_id,
            'role': role,
            'timestamp': datetime.utcnow().isoformat()
        }, room=PRESENCE_ROOM)
    else:
        logger.info(f"Socket disconnected: {sid}")

@sio.event
async def authenticate(sid, data):
    """Authenticate a socket. Requires a valid JWT whose `sub` matches user_id.
    The role comes from the token (never the client), and the account must
    still exist in the database."""
    user_id = data.get('user_id')
    token = data.get('token')
    if not user_id:
        await sio.emit('auth_error', {'error': 'User ID required'}, room=sid)
        return
    if not token:
        await sio.emit('auth_error', {'error': 'Token required'}, room=sid)
        return

    payload = decode_token_safe(token)
    if payload is None:
        await sio.emit('auth_error', {'error': 'Invalid or expired token'}, room=sid)
        return
    # Single-purpose tokens (password reset) must never work as sessions.
    if payload.get("purpose") is not None:
        await sio.emit('auth_error', {'error': 'Invalid token'}, room=sid)
        return

    try:
        user_id = int(user_id)
    except (ValueError, TypeError):
        await sio.emit('auth_error', {'error': 'Invalid User ID'}, room=sid)
        return

    # The token must belong to the claimed user — prevents impersonation.
    if str(payload.get("sub")) != str(user_id):
        await sio.emit('auth_error', {'error': 'Token does not match user ID'}, room=sid)
        return

    role = payload.get("role", "user")
    if role not in ("user", "worker"):
        role = "user"

    # The account must still exist and be active, and the token must not
    # predate the last password change/reset (token_version bump). The DB
    # round-trip runs in a worker thread so it never stalls the event loop.
    account = await asyncio.to_thread(_load_account, user_id, role)
    if account is None:
        await sio.emit('auth_error', {'error': 'Account not found'}, room=sid)
        return
    is_active, current_version = account
    if is_active is False:
        await sio.emit('auth_error', {'error': 'Account is disabled'}, room=sid)
        return
    try:
        token_version = int(payload.get("tv", 0))
    except (TypeError, ValueError):
        token_version = 0
    if token_version < current_version:
        await sio.emit('auth_error', {'error': 'Session expired — please log in again'}, room=sid)
        return

    # Re-authentication on the same socket (account switch / token refresh):
    # leave the PREVIOUS identity's room and clean its mapping first, or the
    # old identity stays marked online forever and the socket keeps receiving
    # the previous account's events.
    previous = socket_manager.get_user_for_socket(sid)
    if previous is not None:
        prev_uid, prev_role = previous
        await sio.leave_room(sid, room_for(prev_uid, prev_role))
        socket_manager.remove_connection(sid)

    socket_manager.add_connection(user_id, sid, role)

    # Join the user's private room for direct notifications (role-scoped so
    # user 3 and worker 3 never share a room), plus the presence room.
    await sio.enter_room(sid, room_for(user_id, role))
    await sio.enter_room(sid, PRESENCE_ROOM)

    await sio.emit('authenticated', {
        'user_id': user_id,
        'role': role,
        'status': 'online',
        'timestamp': datetime.utcnow().isoformat()
    }, room=sid)

    # Notify other authenticated clients this user is online
    await sio.emit('user_online', {
        'user_id': user_id,
        'role': role,
        'timestamp': datetime.utcnow().isoformat()
    }, room=PRESENCE_ROOM)

    logger.info(f"{role} {user_id} authenticated on socket {sid}")

@sio.event
async def send_message(sid, data):
    """Deprecated: chat writes go through POST /chat/ so messages are persisted.
    The REST endpoint emits 'receive_message' to both participants."""
    await sio.emit('error', {
        'message': 'send_message is deprecated — use POST /chat/ (it persists and emits for you)'
    }, room=sid)


@sio.event
async def booking_request(sid, data):
    """Deprecated: booking creation goes through POST /bookings/, which
    persists the booking and emits 'new_booking_request' to the worker."""
    await sio.emit('error', {
        'message': 'booking_request is deprecated — use POST /bookings/'
    }, room=sid)


@sio.event
async def booking_status_update(sid, data):
    """Deprecated: status changes go through PUT /bookings/{id}, which
    validates the status and emits 'booking_status_changed' to the other
    participant."""
    await sio.emit('error', {
        'message': 'booking_status_update is deprecated — use PUT /bookings/{id}'
    }, room=sid)

@sio.event
async def join_room(sid, data):
    """Authenticated sockets may only join their OWN private room.

    Private rooms carry chat messages and booking events, so letting any
    socket join any room (the old behaviour) leaked other users' data."""
    identity = _auth(sid)
    if not identity:
        await sio.emit('error', {'message': 'authenticate before joining rooms'}, room=sid)
        return
    user_id, role = identity
    room_id = data.get('room_id')
    if room_id != room_for(user_id, role):
        logger.warning(f"Socket {sid} tried to join unauthorized room {room_id}")
        await sio.emit('error', {'message': 'You can only join your own room'}, room=sid)
        return
    await sio.enter_room(sid, room_id)
    logger.info(f"Socket {sid} joined room {room_id}")

@sio.event
async def leave_room(sid, data):
    identity = _auth(sid)
    if not identity:
        return
    user_id, role = identity
    room_id = data.get('room_id')
    if room_id != room_for(user_id, role):
        return
    await sio.leave_room(sid, room_id)
    logger.info(f"Socket {sid} left room {room_id}")

@sio.event
async def ping(sid):
    await sio.emit('pong', {'timestamp': datetime.utcnow().isoformat()}, room=sid)

@sio.event
async def get_stats(sid):
    if not _auth(sid):
        await sio.emit('error', {'message': 'authentication required'}, room=sid)
        return
    stats = socket_manager.get_stats()
    stats['timestamp'] = datetime.utcnow().isoformat()
    await sio.emit('stats', stats, room=sid)

@sio.event
async def typing_indicator(sid, data):
    identity = _auth(sid)
    if not identity:
        return
    user_id, role = identity

    receiver_id = data.get('receiver_id')
    is_typing = data.get('is_typing', False)
    if not receiver_id:
        return
    try:
        receiver_id = int(receiver_id)
    except (ValueError, TypeError):
        return

    # The receiver is normally on the opposite side of the marketplace.
    receiver_role = "worker" if role == "user" else "user"
    # _resolve_role can hit the DB on a cache miss — keep that off the loop.
    receiver_room = room_for(
        receiver_id,
        await asyncio.to_thread(_resolve_role, receiver_id, receiver_role),
    )
    await sio.emit('typing', {
        'user_id': user_id,
        'role': role,
        'is_typing': is_typing,
        'timestamp': datetime.utcnow().isoformat()
    }, room=receiver_room)

@sio.event
async def set_status(sid, data):
    identity = _auth(sid)
    if not identity:
        return
    user_id, role = identity

    status = str(data.get('status', 'online')).strip().lower()
    if status not in _ALLOWED_STATUSES:
        await sio.emit('error', {'message': f'status must be one of {sorted(_ALLOWED_STATUSES)}'}, room=sid)
        return
    socket_manager.set_user_status(user_id, status, role)

    # Workers: persist the status too — booking validation reads
    # workers.current_status from the DB, so an in-memory-only status let
    # "offline" workers keep accepting bookings (and vice versa).
    if role == "worker":
        await asyncio.to_thread(_persist_worker_status, user_id, status)

    await sio.emit('user_status_changed', {
        'user_id': user_id,
        'role': role,
        'status': status,
        'timestamp': datetime.utcnow().isoformat()
    }, room=PRESENCE_ROOM)

    logger.info(f"{role} {user_id} status changed to {status}")

@sio.event
async def get_online_users(sid):
    if not _auth(sid):
        await sio.emit('error', {'message': 'authentication required'}, room=sid)
        return
    online = socket_manager.get_online_users()
    user_statuses = {
        f"{role}:{uid}": socket_manager.get_user_status(uid, role)
        for uid, role in online
    }

    await sio.emit('online_users', {
        'users': user_statuses,
        'count': len(online),
        'timestamp': datetime.utcnow().isoformat()
    }, room=sid)

@sio.event
async def get_user_status(sid, data):
    if not _auth(sid):
        await sio.emit('error', {'message': 'authentication required'}, room=sid)
        return
    target_user_id = data.get('user_id')
    if not target_user_id:
        return

    try:
        target_user_id = int(target_user_id)
    except (ValueError, TypeError):
        return

    target_role = str(data.get('role') or '').strip()
    if target_role not in ("user", "worker"):
        target_role = await asyncio.to_thread(_resolve_role, target_user_id)

    status = socket_manager.get_user_status(target_user_id, target_role)
    is_online = socket_manager.is_user_online(target_user_id, target_role)

    await sio.emit('user_status', {
        'user_id': target_user_id,
        'role': target_role,
        'status': status,
        'is_online': is_online,
        'timestamp': datetime.utcnow().isoformat()
    }, room=sid)
