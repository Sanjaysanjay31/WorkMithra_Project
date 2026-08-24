/**
 * Canonical booking status lifecycle.
 *
 *   pending -> upcoming -> completed
 *       \--------> rejected
 *
 * The statuses, legacy aliases, and active set are defined ONCE in
 * shared/booking-status.json and consumed by both this module and
 * backend/booking_status.py — change the JSON, both sides follow.
 */
import spec from '@/shared/booking-status.json';

export type BookingStatus = (typeof spec.statuses)[number];

export const BOOKING_STATUSES: BookingStatus[] = [...spec.statuses];

const LEGACY_MAP: Record<string, BookingStatus> = spec.legacy_map;
const ACTIVE_SET = new Set<string>(spec.active);

/** Map any raw status string (including legacy values) to the canonical enum. */
export function normalizeBookingStatus(raw: unknown): BookingStatus {
  const s = String(raw ?? '').trim().toLowerCase();
  return (LEGACY_MAP[s] ?? (BOOKING_STATUSES.includes(s as BookingStatus) ? (s as BookingStatus) : 'pending'));
}

/** True when the booking is still active (not completed/rejected). */
export function isActiveStatus(status: BookingStatus): boolean {
  return ACTIVE_SET.has(status);
}

/** True when the job is done successfully. */
export function isCompletedStatus(status: BookingStatus): boolean {
  return status === 'completed';
}
