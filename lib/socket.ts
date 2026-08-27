/**
 * Socket.IO Client for WorkMithra
 * Manages real-time communication with the backend
 */

import { io, Socket } from 'socket.io-client';
import { AppState } from 'react-native';
import { BASE_URL, getAuth, getToken } from '@/lib/api';

// Socket.IO connects to the same backend as the REST API.
const API_URL = BASE_URL;

let socket: Socket | null = null;

// Reconnect automatically when the app returns to the foreground. Registered
// once at module load; ensureSocket() no-ops when logged out or already
// connected, so this is safe to leave installed for the app's lifetime.
let appStateRegistered = false;
function registerAppStateResume(): void {
  if (appStateRegistered) return;
  appStateRegistered = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void ensureSocket();
    }
  });
}

/**
 * Connect + authenticate the socket for the currently logged-in user, if any.
 * Safe to call repeatedly (e.g. on app mount): it no-ops when logged out or
 * when a socket already exists.
 */
export async function ensureSocket(): Promise<Socket | null> {
  registerAppStateResume();
  if (socket) return socket;
  try {
    const auth = await getAuth();
    if (!auth?.id) return null;
    return initializeSocket(Number(auth.id));
  } catch (e) {
    console.warn('ensureSocket failed:', e);
    return null;
  }
}

/**
 * Initialize and connect to Socket.IO server
 * @param userId - The authenticated user ID
 * @returns Socket instance
 */
export function initializeSocket(userId: number): Socket {
  if (socket && socket.connected) {
    return socket;
  }
  // A socket already exists but is disconnected/reconnecting — reuse it rather
  // than stacking a second connection with duplicate event handlers.
  if (socket) {
    return socket;
  }

  try {
    socket = io(API_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // Keep trying indefinitely — mobile connections drop constantly, and a
      // hard cap of 5 left the realtime channel dead until the app restarted.
      reconnectionAttempts: Infinity,
      transports: ['websocket', 'polling'], // Support both WebSocket and polling
      autoConnect: true,
      forceNew: false,
    });

    // Handle connection
    socket.on('connect', async () => {
      // Authenticate after connection — the backend verifies the JWT and
      // rejects the socket if the token doesn't match the claimed user id.
      if (userId) {
        const token = await getToken();
        socket?.emit('authenticate', { user_id: userId, token });
      }
    });

    // Handle authentication errors
    socket.on('auth_error', (data) => {
      console.error('Socket authentication error:', data);
    });

    // Handle connection errors. These are EXPECTED transiently (server cold
    // start, network switch, airplane mode) — reconnection is automatic and
    // unlimited, so log at warn level instead of spamming ERROR.
    socket.on('connect_error', (error) => {
      console.warn('[workmithra] socket connect_error (will retry):', error?.message || error);
    });

    // Handle general errors
    socket.on('error', (data) => {
      console.error('Socket error:', data);
    });

    return socket;
  } catch (error) {
    console.error('Failed to initialize socket:', error);
    throw error;
  }
}

/**
 * Get the current socket instance
 */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Disconnect from Socket.IO server.
 *
 * Removes all event handlers before disconnecting so a later ensureSocket()
 * starts from a clean slate — otherwise stale listeners from unmounted screens
 * would accumulate on the reused manager and fire against dead state.
 */
export function disconnectSocket(): void {
  if (socket) {
    try {
      socket.removeAllListeners();
      socket.disconnect();
      socket.close();
    } catch {
      // already closed — nothing to clean up
    }
    socket = null;
  }
}

/**
 * Check if socket is connected
 */
export function isConnected(): boolean {
  return socket?.connected ?? false;
}

/**
 * Get socket ID
 */
export function getSocketId(): string | null {
  return socket?.id ?? null;
}

// ============================================
// ROOM MANAGEMENT
// ============================================

/**
 * Join a room (conversation or booking)
 */
export function joinRoom(roomId: string): void {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }
  socket.emit('join_room', { room_id: roomId });
}

/**
 * Leave a room
 */
export function leaveRoom(roomId: string): void {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }
  socket.emit('leave_room', { room_id: roomId });
}

// ============================================
// CHAT FUNCTIONS
// ============================================
//
// NOTE: Chat messages are written via POST /chat/ (authFetch), which persists
// them and emits 'receive_message' to both participants server-side. The
// socket is the receive channel only — there is no client-side send.

/**
 * Listen for incoming messages
 */
export function onMessageReceived(
  callback: (data: {
    id: number;
    sender_id: number;
    sender_role?: 'user' | 'worker';
    receiver_id: number;
    receiver_role?: 'user' | 'worker';
    message: string;
    booking_id?: number;
    sent_at: string;
    timestamp: string;
  }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('receive_message', callback);

  // Return unsubscribe function
  return () => {
    socket?.off('receive_message', callback);
  };
}

/**
 * Send typing indicator
 */
export function setTypingIndicator(receiverId: number, isTyping: boolean): void {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }

  socket.emit('typing_indicator', {
    receiver_id: receiverId,
    is_typing: isTyping,
  });
}

/**
 * Listen for typing indicators
 */
export function onTypingIndicator(
  callback: (data: { user_id: number; is_typing: boolean; timestamp: string }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('typing', callback);

  return () => {
    socket?.off('typing', callback);
  };
}

// ============================================
// BOOKING FUNCTIONS
// ============================================
//
// NOTE: Bookings are created via POST /bookings/ and updated via PUT
// /bookings/{id} (authFetch). The backend persists the change and emits
// 'new_booking_request' / 'booking_status_changed' server-side. The socket
// is the receive channel only.

/**
 * Listen for booking requests (workers)
 */
export function onBookingRequest(
  callback: (data: {
    booking_id: number;
    client_id: number;
    worker_id: number;
    service_id: number;
    booking_date: string;
    booking_time: string;
    problem_description: string;
    estimated_price: number;
    status: string;
    timestamp: string;
  }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('new_booking_request', callback);

  return () => {
    socket?.off('new_booking_request', callback);
  };
}

/**
 * Listen for booking status updates
 */
export function onBookingStatusChanged(
  callback: (data: {
    booking_id: number;
    status?: string;
    updated_by: number;
    message?: string;
    /** Price fields ride along when the change was a quote/acceptance. */
    estimated_price?: number | null;
    final_price?: number | null;
    price_proposed_by?: 'user' | 'worker' | null;
    timestamp: string;
  }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('booking_status_changed', callback);

  return () => {
    socket?.off('booking_status_changed', callback);
  };
}

// ============================================
// NOTIFICATION FUNCTIONS
// ============================================
//
// Notifications are persisted server-side (POST /notifications/ and the
// booking price flow), and the backend emits 'notification_created' to the
// recipient's private room with the fresh unread count — badge screens
// listen for it instead of polling /notifications/unread-count.

/**
 * Listen for newly created notifications
 */
export function onNotificationCreated(
  callback: (data: {
    id: string;
    title: string;
    body: string;
    audience: 'user' | 'worker';
    recipient_id: string;
    kind: string;
    created_at: string;
    read: boolean;
    unread_count: number;
  }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('notification_created', callback);

  return () => {
    socket?.off('notification_created', callback);
  };
}

// ============================================
// USER STATUS FUNCTIONS
// ============================================

/**
 * Set user's status
 */
export function setUserStatus(status: 'online' | 'available' | 'busy' | 'offline'): void {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }

  socket.emit('set_status', { status });
}

/**
 * Listen for user status changes
 */
export function onUserStatusChanged(
  callback: (data: { user_id: number; status: string; timestamp: string }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('user_status_changed', callback);

  return () => {
    socket?.off('user_status_changed', callback);
  };
}

/**
 * Listen for user coming online
 */
export function onUserOnline(
  callback: (data: { user_id: number; online_users: number[]; timestamp: string }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('user_online', callback);

  return () => {
    socket?.off('user_online', callback);
  };
}

/**
 * Listen for user going offline
 */
export function onUserOffline(
  callback: (data: { user_id: number; timestamp: string }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('user_offline', callback);

  return () => {
    socket?.off('user_offline', callback);
  };
}

/**
 * Get online users list
 */
export function requestOnlineUsers(): void {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }

  socket.emit('get_online_users');
}

/**
 * Listen for online users list
 */
export function onOnlineUsers(
  callback: (data: { users: Record<number, string>; count: number; timestamp: string }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('online_users', callback);

  return () => {
    socket?.off('online_users', callback);
  };
}

/**
 * Get specific user's status
 */
export function requestUserStatus(userId: number): void {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }

  socket.emit('get_user_status', { user_id: userId });
}

/**
 * Listen for user status response
 */
export function onUserStatusResponse(
  callback: (data: { user_id: number; status: string; is_online: boolean; timestamp: string }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('user_status', callback);

  return () => {
    socket?.off('user_status', callback);
  };
}

// ============================================
// ROOM EVENTS
// ============================================

/**
 * Listen for when user joins a room
 */
export function onUserJoinedRoom(
  callback: (data: { user_id: number; room_id: string; timestamp: string }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('user_joined_room', callback);

  return () => {
    socket?.off('user_joined_room', callback);
  };
}

/**
 * Listen for when user leaves a room
 */
export function onUserLeftRoom(
  callback: (data: { user_id: number; room_id: string; timestamp: string }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('user_left_room', callback);

  return () => {
    socket?.off('user_left_room', callback);
  };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Ping to keep connection alive
 */
export function ping(): void {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }

  socket.emit('ping');
}

/**
 * Listen for pong response
 */
export function onPong(callback: (data: { timestamp: string }) => void): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('pong', callback);

  return () => {
    socket?.off('pong', callback);
  };
}

/**
 * Get connection statistics
 */
export function requestStats(): void {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }

  socket.emit('get_stats');
}

/**
 * Listen for stats response
 */
export function onStats(
  callback: (data: {
    total_online_users: number;
    total_connections: number;
    online_users: number;
    conversation_rooms: number;
    booking_rooms: number;
    timestamp: string;
  }) => void
): () => void {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  socket.on('stats', callback);

  return () => {
    socket?.off('stats', callback);
  };
}
