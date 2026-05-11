"""
Socket.IO Manager for WorkMithra
Manages connections, rooms, and user tracking for realtime communication
"""

from typing import Dict, List, Set, Optional, Tuple
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class SocketManager:
    """Manages Socket.IO connections, rooms, and user tracking"""
    
    def __init__(self):
        # Map of user_id -> set of socket_ids connected
        self.user_connections: Dict[int, Set[str]] = {}
        
        # Map of socket_id -> user_id
        self.socket_to_user: Dict[str, int] = {}
        
        # Map of conversation_room -> {user_id1, user_id2}
        self.conversation_rooms: Dict[str, Set[int]] = {}
        
        # Map of user_id -> online status
        self.user_status: Dict[int, str] = {}
        
        # Map of booking_id -> {client_id, worker_id}
        self.booking_rooms: Dict[int, Set[int]] = {}
        
        # Track last activity timestamp for users
        self.last_activity: Dict[int, datetime] = {}

    def add_connection(self, user_id: int, socket_id: str) -> None:
        """Register a new socket connection for a user"""
        if user_id not in self.user_connections:
            self.user_connections[user_id] = set()
        
        self.user_connections[user_id].add(socket_id)
        self.socket_to_user[socket_id] = user_id
        self.user_status[user_id] = "online"
        self.last_activity[user_id] = datetime.utcnow()
        
        logger.info(f"User {user_id} connected with socket {socket_id}")

    def remove_connection(self, socket_id: str) -> Optional[int]:
        """Remove a socket connection and return the user_id"""
        user_id = self.socket_to_user.pop(socket_id, None)
        
        if user_id is not None:
            if user_id in self.user_connections:
                self.user_connections[user_id].discard(socket_id)
                
                # If no more connections for this user, mark as offline
                if not self.user_connections[user_id]:
                    del self.user_connections[user_id]
                    self.user_status[user_id] = "offline"
                    logger.info(f"User {user_id} disconnected - now offline")
                else:
                    logger.info(f"User {user_id} socket {socket_id} disconnected but has other connections")
            
            return user_id
        
        return None

    def get_user_sockets(self, user_id: int) -> List[str]:
        """Get all socket IDs connected to a user"""
        return list(self.user_connections.get(user_id, set()))

    def is_user_online(self, user_id: int) -> bool:
        """Check if a user is online"""
        return user_id in self.user_connections and len(self.user_connections[user_id]) > 0

    def get_user_status(self, user_id: int) -> str:
        """Get user's current status (online/offline)"""
        return self.user_status.get(user_id, "offline")

    def set_user_status(self, user_id: int, status: str) -> None:
        """Set user's status"""
        self.user_status[user_id] = status
        self.last_activity[user_id] = datetime.utcnow()

    def create_conversation_room(self, user_id_1: int, user_id_2: int) -> str:
        """Create or get a conversation room between two users"""
        # Sort IDs to ensure consistent room naming
        room_id = f"conv_{min(user_id_1, user_id_2)}_{max(user_id_1, user_id_2)}"
        
        if room_id not in self.conversation_rooms:
            self.conversation_rooms[room_id] = {user_id_1, user_id_2}
        
        return room_id

    def create_booking_room(self, booking_id: int, client_id: int, worker_id: int) -> str:
        """Create or get a booking room"""
        room_id = f"booking_{booking_id}"
        
        if room_id not in self.booking_rooms:
            self.booking_rooms[room_id] = {client_id, worker_id}
        
        return room_id

    def get_booking_room(self, booking_id: int) -> str:
        """Get the room ID for a booking"""
        return f"booking_{booking_id}"

    def get_booking_participants(self, booking_id: int) -> Optional[Set[int]]:
        """Get the participant IDs for a booking"""
        room_id = f"booking_{booking_id}"
        return self.booking_rooms.get(room_id)

    def get_conversation_participants(self, user_id_1: int, user_id_2: int) -> Optional[Set[int]]:
        """Get participants in a conversation"""
        room_id = f"conv_{min(user_id_1, user_id_2)}_{max(user_id_1, user_id_2)}"
        return self.conversation_rooms.get(room_id)

    def get_online_users(self) -> List[int]:
        """Get list of all online users"""
        return list(self.user_connections.keys())

    def get_user_for_socket(self, socket_id: str) -> Optional[int]:
        """Get user ID for a socket"""
        return self.socket_to_user.get(socket_id)

    def get_stats(self) -> dict:
        """Get connection statistics"""
        total_connections = sum(len(sockets) for sockets in self.user_connections.values())
        online_users = len([u for u in self.user_status.values() if u == "online"])
        
        return {
            "total_online_users": len(self.user_connections),
            "total_connections": total_connections,
            "online_users": online_users,
            "conversation_rooms": len(self.conversation_rooms),
            "booking_rooms": len(self.booking_rooms),
        }


# Global instance
socket_manager = SocketManager()
