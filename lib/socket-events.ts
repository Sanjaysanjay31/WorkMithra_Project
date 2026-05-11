/**
 * Socket.IO Event Types and Constants
 * Defines type-safe structures for all socket events
 */

// ============================================
// BOOKING STATUS TYPES
// ============================================

export type BookingStatus = 'pending' | 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'cancelled';

export type UserStatus = 'online' | 'available' | 'busy' | 'offline';

// ============================================
// CHAT MESSAGE
// ============================================

export interface ChatMessage {
  id: number;
  sender_id: number;
  receiver_id: number;
  message: string;
  booking_id?: number;
  sent_at: string;
  timestamp: string;
}

// ============================================
// BOOKING
// ============================================

export interface BookingRequest {
  booking_id: number;
  client_id: number;
  worker_id: number;
  service_id: number;
  booking_date: string;
  booking_time: string;
  problem_description: string;
  estimated_price: number;
  status: BookingStatus;
  timestamp: string;
}

export interface BookingStatusUpdate {
  booking_id: number;
  status: BookingStatus;
  updated_by: number;
  message?: string;
  timestamp: string;
}

// ============================================
// USER EVENTS
// ============================================

export interface UserOnlineEvent {
  user_id: number;
  online_users: number[];
  timestamp: string;
}

export interface UserOfflineEvent {
  user_id: number;
  timestamp: string;
}

export interface UserStatusChangeEvent {
  user_id: number;
  status: UserStatus;
  timestamp: string;
}

export interface UserStatusResponse {
  user_id: number;
  status: UserStatus;
  is_online: boolean;
  timestamp: string;
}

// ============================================
// TYPING INDICATOR
// ============================================

export interface TypingIndicator {
  user_id: number;
  is_typing: boolean;
  timestamp: string;
}

// ============================================
// ROOM EVENTS
// ============================================

export interface RoomJoinEvent {
  room_id: string;
  user_id: number;
  timestamp: string;
}

export interface UserJoinedRoomEvent {
  user_id: number;
  room_id: string;
  timestamp: string;
}

export interface UserLeftRoomEvent {
  user_id: number;
  room_id: string;
  timestamp: string;
}

// ============================================
// AUTHENTICATION
// ============================================

export interface AuthenticatedEvent {
  user_id: number;
  status: string;
  timestamp: string;
}

export interface AuthError {
  message: string;
}

// ============================================
// GENERAL EVENTS
// ============================================

export interface ErrorEvent {
  message: string;
}

export interface StatsResponse {
  total_online_users: number;
  total_connections: number;
  online_users: number;
  conversation_rooms: number;
  booking_rooms: number;
  timestamp: string;
}

export interface OnlineUsers {
  users: Record<number, UserStatus>;
  count: number;
  timestamp: string;
}

// ============================================
// EVENT NAMES (for reference)
// ============================================

export const SOCKET_EVENTS = {
  // Connection
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECT_ERROR: 'connect_error',
  
  // Authentication
  AUTHENTICATE: 'authenticate',
  AUTHENTICATED: 'authenticated',
  AUTH_ERROR: 'auth_error',
  
  // Room Management
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  JOINED_ROOM: 'joined_room',
  USER_JOINED_ROOM: 'user_joined_room',
  USER_LEFT_ROOM: 'user_left_room',
  
  // Chat
  SEND_MESSAGE: 'send_message',
  RECEIVE_MESSAGE: 'receive_message',
  TYPING_INDICATOR: 'typing_indicator',
  TYPING: 'typing',
  
  // Booking
  BOOKING_REQUEST: 'booking_request',
  NEW_BOOKING_REQUEST: 'new_booking_request',
  BOOKING_STATUS_UPDATE: 'booking_status_update',
  BOOKING_STATUS_CHANGED: 'booking_status_changed',
  
  // User Status
  SET_STATUS: 'set_status',
  USER_STATUS_CHANGED: 'user_status_changed',
  USER_ONLINE: 'user_online',
  USER_OFFLINE: 'user_offline',
  GET_ONLINE_USERS: 'get_online_users',
  ONLINE_USERS: 'online_users',
  GET_USER_STATUS: 'get_user_status',
  USER_STATUS: 'user_status',
  
  // Utility
  PING: 'ping',
  PONG: 'pong',
  GET_STATS: 'get_stats',
  STATS: 'stats',
  ERROR: 'error',
} as const;

// ============================================
// BOOKING ROOM NAME GENERATORS
// ============================================

/**
 * Generate a booking room ID
 */
export function getBookingRoomId(bookingId: number): string {
  return `booking_${bookingId}`;
}

/**
 * Generate a conversation room ID
 */
export function getConversationRoomId(userId1: number, userId2: number): string {
  const minId = Math.min(userId1, userId2);
  const maxId = Math.max(userId1, userId2);
  return `conv_${minId}_${maxId}`;
}
