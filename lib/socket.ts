/**
 * Socket.IO Client for WorkMithra
 * Manages real-time communication with the backend
 */

import { Platform } from 'react-native';
import { io, Socket } from 'socket.io-client';

// API configuration
const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const API_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

let socket: Socket | null = null;

/**
 * Initialize and connect to Socket.IO server
 * @param userId - The authenticated user ID
 * @returns Socket instance
 */
export function initializeSocket(userId: number): Socket {
  if (socket && socket.connected) {
    console.log('Socket already connected');
    return socket;
  }

  try {
    socket = io(API_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling'], // Support both WebSocket and polling
      autoConnect: true,
      forceNew: false,
    });

    // Handle connection
    socket.on('connect', () => {
      console.log('Socket connected:', socket?.id);
      // Authenticate after connection
      if (userId) {
        socket?.emit('authenticate', { user_id: userId });
      }
    });

    // Handle authentication response
    socket.on('authenticated', (data) => {
      console.log('Socket authenticated:', data);
    });

    // Handle authentication errors
    socket.on('auth_error', (data) => {
      console.error('Socket authentication error:', data);
    });

    // Handle connection errors
    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
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
 * Disconnect from Socket.IO server
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    console.log('Socket disconnected');
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

/**
 * Send a chat message
 */
export function sendMessage(
  receiverId: number,
  message: string,
  bookingId?: number
): void {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }

  socket.emit('send_message', {
    receiver_id: receiverId,
    message: message,
    booking_id: bookingId || null,
  });
}

/**
 * Listen for incoming messages
 */
export function onMessageReceived(
  callback: (data: {
    id: number;
    sender_id: number;
    receiver_id: number;
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

/**
 * Send a booking request
 */
export function sendBookingRequest(bookingData: {
  booking_id: number;
  worker_id: number;
  client_id: number;
  service_id: number;
  booking_date: string;
  booking_time: string;
  problem_description: string;
  estimated_price: number;
}): void {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }

  socket.emit('booking_request', bookingData);
}

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
 * Update booking status
 */
export function updateBookingStatus(
  bookingId: number,
  status: 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'cancelled',
  message?: string
): void {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }

  socket.emit('booking_status_update', {
    booking_id: bookingId,
    status: status,
    message: message || '',
  });
}

/**
 * Listen for booking status updates
 */
export function onBookingStatusChanged(
  callback: (data: {
    booking_id: number;
    status: string;
    updated_by: number;
    message?: string;
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
