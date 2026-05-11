/**
 * Socket.IO Booking Integration Example
 * 
 * This file demonstrates how to integrate Socket.IO real-time booking notifications
 * into your booking flows. Use these patterns in your booking screens.
 */

import {
    initializeSocket,
    isConnected,
    onBookingRequest,
    onBookingStatusChanged,
    sendBookingRequest,
    updateBookingStatus
} from '@/lib/socket';
import { storage } from '@/lib/storage';
import { useEffect, useState } from 'react';

// ============================================
// HOOK: useBookingNotifications
// ============================================
/**
 * Hook to manage booking notifications and real-time updates
 * Use this in your booking screens
 */
export function useBookingNotifications() {
  const [userId, setUserId] = useState<number | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [incomingBookings, setIncomingBookings] = useState<any[]>([]);
  const [bookingUpdates, setBookingUpdates] = useState<Record<number, string>>({});

  // Initialize socket and user ID
  useEffect(() => {
    const initialize = async () => {
      try {
        const storedUserId = await storage.get('workmithra:userId');
        if (storedUserId) {
          const uid = parseInt(storedUserId, 10);
          setUserId(uid);
          
          try {
            initializeSocket(uid);
            setTimeout(() => setSocketConnected(isConnected()), 500);
          } catch (error) {
            console.error('Socket initialization failed:', error);
          }
        }
      } catch (error) {
        console.error('Failed to get user ID:', error);
      }
    };

    initialize();
  }, []);

  // Set up listeners for booking events
  useEffect(() => {
    if (!userId || !socketConnected) return;

    const unsubscribers: (() => void)[] = [];

    // Listen for incoming booking requests (for workers)
    const unsubBookingRequest = onBookingRequest((data) => {
      console.log('New booking request received:', data);
      setIncomingBookings((prev) => [...prev, data]);
      
      // Optional: Show notification
      // notificationService.show({
      //   title: 'New Booking Request!',
      //   body: `New booking from client for ${data.service_id}`,
      // });
    });
    unsubscribers.push(unsubBookingRequest);

    // Listen for booking status updates
    const unsubStatusChange = onBookingStatusChanged((data) => {
      console.log('Booking status changed:', data);
      setBookingUpdates((prev) => ({
        ...prev,
        [data.booking_id]: data.status,
      }));
    });
    unsubscribers.push(unsubStatusChange);

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [userId, socketConnected]);

  return {
    userId,
    socketConnected,
    incomingBookings,
    bookingUpdates,
  };
}

// ============================================
// FUNCTION: Create and Send Booking
// ============================================
/**
 * Send a booking request via Socket.IO
 * Call this when a client wants to book a worker
 */
export function sendBookingViaSocket(
  bookingId: number,
  workerId: number,
  clientId: number,
  serviceId: number,
  bookingDate: string,
  bookingTime: string,
  problemDescription: string,
  estimatedPrice: number
) {
  if (!isConnected()) {
    console.error('Socket not connected');
    return false;
  }

  try {
    sendBookingRequest({
      booking_id: bookingId,
      worker_id: workerId,
      client_id: clientId,
      service_id: serviceId,
      booking_date: bookingDate,
      booking_time: bookingTime,
      problem_description: problemDescription,
      estimated_price: estimatedPrice,
    });
    
    console.log('Booking request sent');
    return true;
  } catch (error) {
    console.error('Failed to send booking:', error);
    return false;
  }
}

// ============================================
// FUNCTION: Accept/Reject Booking (Worker)
// ============================================
/**
 * Worker accepts a booking
 */
export function acceptBooking(bookingId: number, workerMessage?: string) {
  if (!isConnected()) {
    console.error('Socket not connected');
    return false;
  }

  try {
    updateBookingStatus(bookingId, 'accepted', workerMessage || 'I accept this booking');
    console.log('Booking accepted');
    return true;
  } catch (error) {
    console.error('Failed to accept booking:', error);
    return false;
  }
}

/**
 * Worker rejects a booking
 */
export function rejectBooking(bookingId: number, reason?: string) {
  if (!isConnected()) {
    console.error('Socket not connected');
    return false;
  }

  try {
    updateBookingStatus(bookingId, 'rejected', reason || 'I cannot accept this booking');
    console.log('Booking rejected');
    return true;
  } catch (error) {
    console.error('Failed to reject booking:', error);
    return false;
  }
}

// ============================================
// FUNCTION: Update Job Status
// ============================================
/**
 * Update booking status during job execution
 */
export function updateJobStatus(
  bookingId: number,
  status: 'in_progress' | 'completed' | 'cancelled',
  message?: string
) {
  if (!isConnected()) {
    console.error('Socket not connected');
    return false;
  }

  try {
    updateBookingStatus(bookingId, status, message);
    console.log(`Booking status updated to: ${status}`);
    return true;
  } catch (error) {
    console.error('Failed to update job status:', error);
    return false;
  }
}

// ============================================
// USAGE EXAMPLES
// ============================================

/**
 * Example: Using in a component to receive booking notifications
 * 
 * const { incomingBookings, socketConnected } = useBookingNotifications();
 * 
 * const handleAcceptBooking = (bookingData) => {
 *   acceptBooking(bookingData.booking_id, 'Ready to start');
 * };
 * 
 * return (
 *   <View>
 *     {incomingBookings.map((booking) => (
 *       <BookingNotificationCard
 *         key={booking.booking_id}
 *         booking={booking}
 *         onAccept={() => handleAcceptBooking(booking)}
 *       />
 *     ))}
 *   </View>
 * );
 */

/**
 * Example: Sending a booking request from booking creation screen
 * 
 * const handleCreateBooking = async (formData) => {
 *   // First create booking in database
 *   const bookingResponse = await fetch('/bookings', {
 *     method: 'POST',
 *     body: JSON.stringify(formData),
 *   });
 *   const bookingData = await bookingResponse.json();
 *   
 *   // Then send real-time notification via Socket.IO
 *   sendBookingViaSocket(
 *     bookingData.id,
 *     formData.worker_id,
 *     formData.client_id,
 *     formData.service_id,
 *     formData.booking_date,
 *     formData.booking_time,
 *     formData.problem_description,
 *     formData.estimated_price
 *   );
 * };
 */
