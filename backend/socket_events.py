import socketio
import logging
from datetime import datetime
from socket_manager import socket_manager

logger = logging.getLogger(__name__)

# Initialize Socket.IO AsyncServer
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')

@sio.event
async def connect(sid, environ):
    logger.info(f"Socket connected: {sid}")
    await sio.emit('connected', {'sid': sid}, room=sid)

@sio.event
async def disconnect(sid):
    user_id = socket_manager.remove_connection(sid)
    if user_id:
        logger.info(f"User {user_id} (socket {sid}) disconnected")
        # Notify others if necessary
        await sio.emit('user_offline', {
            'user_id': user_id,
            'timestamp': datetime.utcnow().isoformat()
        })
    else:
        logger.info(f"Socket disconnected: {sid}")

@sio.event
async def authenticate(sid, data):
    user_id = data.get('user_id')
    if not user_id:
        await sio.emit('auth_error', {'error': 'User ID required'}, room=sid)
        return

    try:
        user_id = int(user_id)
        socket_manager.add_connection(user_id, sid)
        
        # Join user's private room for direct notifications
        await sio.enter_room(sid, f"user_{user_id}")
        
        await sio.emit('authenticated', {
            'user_id': user_id,
            'status': 'online',
            'timestamp': datetime.utcnow().isoformat()
        }, room=sid)
        
        # Notify others this user is online
        await sio.emit('user_online', {
            'user_id': user_id,
            'timestamp': datetime.utcnow().isoformat()
        })
        
        logger.info(f"User {user_id} authenticated on socket {sid}")
    except (ValueError, TypeError):
        await sio.emit('auth_error', {'error': 'Invalid User ID'}, room=sid)

@sio.event
async def send_message(sid, data):
    user_id = socket_manager.get_user_for_socket(sid)
    if not user_id:
        await sio.emit('error', {'message': 'Not authenticated'}, room=sid)
        return

    receiver_id = data.get('receiver_id')
    message = data.get('message')
    booking_id = data.get('booking_id')

    if not receiver_id or not message:
        return

    # Prepare message payload
    payload = {
        'id': int(datetime.utcnow().timestamp() * 1000), # Temporary ID
        'sender_id': user_id,
        'receiver_id': receiver_id,
        'message': message,
        'booking_id': booking_id,
        'sent_at': datetime.utcnow().isoformat(),
        'timestamp': datetime.utcnow().isoformat()
    }

    # Send to receiver if online
    receiver_room = f"user_{receiver_id}"
    await sio.emit('receive_message', payload, room=receiver_room)
    
    # Also send back to sender (for multi-device sync if applicable)
    await sio.emit('receive_message', payload, room=f"user_{user_id}")
    
    logger.info(f"Message sent from {user_id} to {receiver_id}")

@sio.event
async def booking_request(sid, data):
    user_id = socket_manager.get_user_for_socket(sid)
    if not user_id: return

    worker_id = data.get('worker_id')
    if not worker_id: return

    # Notify worker
    worker_room = f"user_{worker_id}"
    await sio.emit('new_booking_request', {
        **data,
        'status': 'pending',
        'timestamp': datetime.utcnow().isoformat()
    }, room=worker_room)
    
    logger.info(f"Booking request sent from {user_id} to worker {worker_id}")

@sio.event
async def booking_status_update(sid, data):
    user_id = socket_manager.get_user_for_socket(sid)
    if not user_id: return

    booking_id = data.get('booking_id')
    status = data.get('status')
    
    # In a real app, you'd fetch the other participant (client or worker)
    # For now, we'll broadcast or assume we can find them via some logic
    # or just emit to a booking-specific room
    booking_room = f"booking_{booking_id}"
    
    await sio.emit('booking_status_changed', {
        'booking_id': booking_id,
        'status': status,
        'updated_by': user_id,
        'message': data.get('message', ''),
        'timestamp': datetime.utcnow().isoformat()
    }, room=booking_room)
    
    logger.info(f"Booking {booking_id} status updated to {status} by {user_id}")

@sio.event
async def join_room(sid, data):
    room_id = data.get('room_id')
    if room_id:
        await sio.enter_room(sid, room_id)
        logger.info(f"Socket {sid} joined room {room_id}")

@sio.event
async def leave_room(sid, data):
    room_id = data.get('room_id')
    if room_id:
        await sio.leave_room(sid, room_id)
        logger.info(f"Socket {sid} left room {room_id}")

@sio.event
async def ping(sid):
    await sio.emit('pong', {'timestamp': datetime.utcnow().isoformat()}, room=sid)

@sio.event
async def get_stats(sid):
    stats = socket_manager.get_stats()
    stats['timestamp'] = datetime.utcnow().isoformat()
    await sio.emit('stats', stats, room=sid)

@sio.event
async def typing_indicator(sid, data):
    user_id = socket_manager.get_user_for_socket(sid)
    if not user_id:
        return

    receiver_id = data.get('receiver_id')
    is_typing = data.get('is_typing', False)

    if receiver_id:
        receiver_room = f"user_{receiver_id}"
        await sio.emit('typing', {
            'user_id': user_id,
            'is_typing': is_typing,
            'timestamp': datetime.utcnow().isoformat()
        }, room=receiver_room)

@sio.event
async def set_status(sid, data):
    user_id = socket_manager.get_user_for_socket(sid)
    if not user_id:
        return

    status = data.get('status', 'online')
    socket_manager.set_user_status(user_id, status)

    await sio.emit('user_status_changed', {
        'user_id': user_id,
        'status': status,
        'timestamp': datetime.utcnow().isoformat()
    })

    logger.info(f"User {user_id} status changed to {status}")

@sio.event
async def get_online_users(sid):
    online_users = socket_manager.get_online_users()
    user_statuses = {uid: socket_manager.get_user_status(uid) for uid in online_users}

    await sio.emit('online_users', {
        'users': user_statuses,
        'count': len(online_users),
        'timestamp': datetime.utcnow().isoformat()
    }, room=sid)

@sio.event
async def get_user_status(sid, data):
    target_user_id = data.get('user_id')
    if not target_user_id:
        return

    try:
        target_user_id = int(target_user_id)
    except (ValueError, TypeError):
        return

    status = socket_manager.get_user_status(target_user_id)
    is_online = socket_manager.is_user_online(target_user_id)

    await sio.emit('user_status', {
        'user_id': target_user_id,
        'status': status,
        'is_online': is_online,
        'timestamp': datetime.utcnow().isoformat()
    }, room=sid)

