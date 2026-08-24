import { isActiveStatus, isCompletedStatus, normalizeBookingStatus } from '../lib/booking-status';

describe('booking-status', () => {
  it('passes canonical statuses through unchanged', () => {
    expect(normalizeBookingStatus('pending')).toBe('pending');
    expect(normalizeBookingStatus('upcoming')).toBe('upcoming');
    expect(normalizeBookingStatus('completed')).toBe('completed');
    expect(normalizeBookingStatus('rejected')).toBe('rejected');
  });

  it('maps legacy statuses to canonical ones', () => {
    expect(normalizeBookingStatus('accepted')).toBe('upcoming');
    expect(normalizeBookingStatus('in_progress')).toBe('upcoming');
    expect(normalizeBookingStatus('success')).toBe('completed');
    expect(normalizeBookingStatus('declined')).toBe('rejected');
    expect(normalizeBookingStatus('cancelled')).toBe('rejected');
  });

  it('falls back to pending for unknown or missing statuses', () => {
    expect(normalizeBookingStatus('garbage')).toBe('pending');
    expect(normalizeBookingStatus(null)).toBe('pending');
    expect(normalizeBookingStatus(undefined)).toBe('pending');
  });

  it('treats pending and upcoming as active', () => {
    expect(isActiveStatus('pending')).toBe(true);
    expect(isActiveStatus('upcoming')).toBe(true);
    expect(isActiveStatus('completed')).toBe(false);
    expect(isActiveStatus('rejected')).toBe(false);
  });

  it('treats only completed as completed', () => {
    expect(isCompletedStatus('completed')).toBe(true);
    expect(isCompletedStatus('pending')).toBe(false);
    expect(isCompletedStatus('upcoming')).toBe(false);
    expect(isCompletedStatus('rejected')).toBe(false);
  });
});
