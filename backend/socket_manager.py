"""
Socket.IO Manager for WorkMithra
Manages connections, rooms, and user tracking for realtime communication.

Identity model: users and workers live in SEPARATE tables with overlapping
numeric ids, so a bare user_id is ambiguous. Every connection is therefore
keyed by (role, user_id) — "user:5" and "worker:5" are different people.
Private Socket.IO rooms follow the same scheme: "user_5" / "worker_5".
"""

from typing import Dict, List, Set, Optional, Tuple
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

VALID_ROLES = ("user", "worker")


def _key(role: str, user_id: int) -> str:
    return f"{role}:{int(user_id)}"


class SocketManager:
    """Manages Socket.IO connections, rooms, and user tracking"""

    def __init__(self):
        # Map of identity key ("role:user_id") -> set of socket_ids connected
        self.user_connections: Dict[str, Set[str]] = {}

        # Map of socket_id -> identity key
        self.socket_to_user: Dict[str, str] = {}

        # Map of identity key -> online status
        self.user_status: Dict[str, str] = {}

        # Track last activity timestamp per identity
        self.last_activity: Dict[str, datetime] = {}

    def add_connection(self, user_id: int, socket_id: str, role: str = "user") -> None:
        """Register a new socket connection for a user"""
        if role not in VALID_ROLES:
            role = "user"
        key = _key(role, user_id)
        if key not in self.user_connections:
            self.user_connections[key] = set()

        self.user_connections[key].add(socket_id)
        self.socket_to_user[socket_id] = key
        self.user_status[key] = "online"
        self.last_activity[key] = datetime.utcnow()

        logger.info(f"{key} connected with socket {socket_id}")

    def remove_connection(self, socket_id: str) -> Optional[Tuple[int, str]]:
        """Remove a socket connection.

        Returns (user_id, role) ONLY when this was the user's last socket —
        i.e. the user actually went offline. Returns None when the user still
        has other live sockets, so callers don't broadcast a false
        'user_offline'."""
        key = self.socket_to_user.pop(socket_id, None)
        if key is None:
            return None

        sockets = self.user_connections.get(key)
        if sockets is not None:
            sockets.discard(socket_id)
            if sockets:
                logger.info(f"{key} socket {socket_id} disconnected but has other connections")
                return None
            # Last socket gone — user is offline. Clean up all state so the
            # dicts don't grow without bound.
            del self.user_connections[key]
            self.user_status.pop(key, None)
            self.last_activity.pop(key, None)
            logger.info(f"{key} disconnected - now offline")

        role, _, uid = key.partition(":")
        try:
            return int(uid), role
        except ValueError:
            return None

    def get_user_sockets(self, user_id: int, role: str = "user") -> List[str]:
        """Get all socket IDs connected to a user"""
        return list(self.user_connections.get(_key(role, user_id), set()))

    def is_user_online(self, user_id: int, role: str = "user") -> bool:
        """Check if a user is online"""
        return bool(self.user_connections.get(_key(role, user_id)))

    def get_user_status(self, user_id: int, role: str = "user") -> str:
        """Get user's current status (offline when not connected)"""
        return self.user_status.get(_key(role, user_id), "offline")

    def set_user_status(self, user_id: int, status: str, role: str = "user") -> None:
        """Set user's status"""
        key = _key(role, user_id)
        if key in self.user_connections:
            self.user_status[key] = status
            self.last_activity[key] = datetime.utcnow()

    def get_online_users(self) -> List[Tuple[int, str]]:
        """Get list of all online identities as (user_id, role) tuples"""
        out: List[Tuple[int, str]] = []
        for key in self.user_connections.keys():
            role, _, uid = key.partition(":")
            try:
                out.append((int(uid), role))
            except ValueError:
                continue
        return out

    def get_user_for_socket(self, socket_id: str) -> Optional[Tuple[int, str]]:
        """Get (user_id, role) for a socket, or None if unauthenticated"""
        key = self.socket_to_user.get(socket_id)
        if key is None:
            return None
        role, _, uid = key.partition(":")
        try:
            return int(uid), role
        except ValueError:
            return None

    def get_stats(self) -> dict:
        """Get connection statistics"""
        total_connections = sum(len(sockets) for sockets in self.user_connections.values())
        return {
            "total_online_users": len(self.user_connections),
            "total_connections": total_connections,
            "online_users": total_connections,
        }


# Global instance
socket_manager = SocketManager()
