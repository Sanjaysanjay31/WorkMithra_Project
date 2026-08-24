// Date/time formatting helpers.
//
// CONVENTION: the backend sends booking dates as ISO calendar strings
// ("YYYY-MM-DD") and times as "HH:MM" or "HH:MM:SS" (see backend/schemas.py:
// BookingBase.booking_date is a `date`, booking_time is a `time`). These are
// wall-clock values with no timezone, so we parse them manually instead of
// going through `new Date(isoString)` — that would apply a timezone shift and
// can move the date by a day. All screens must format booking dates/times
// through these helpers rather than ad-hoc string slicing.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sameYMD(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Format an ISO date (YYYY-MM-DD) as e.g. "Today", "Tomorrow", or "14 May 2026". */
export function formatBookingDate(iso: string | null | undefined): string {
  if (!iso) return '';
  // Accept "2026-05-14" or "2026-05-14T..."
  const ymd = String(iso).slice(0, 10);
  const parts = ymd.split('-');
  if (parts.length !== 3) return String(iso);
  const y = Number(parts[0]); const m = Number(parts[1]); const d = Number(parts[2]);
  // Reject out-of-range components instead of letting Date silently roll over
  // (e.g. month 13 becoming January of the next year).
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return String(iso);
  const dt = new Date(y, m - 1, d);
  // Guard against invalid day-of-month (e.g. 2026-02-31 rolls to March).
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return String(iso);
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  if (sameYMD(dt, today)) return 'Today';
  if (sameYMD(dt, tomorrow)) return 'Tomorrow';
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Format a time string ("HH:MM" or "HH:MM:SS") as "2:30 PM". */
export function formatBookingTime(t: string | null | undefined): string {
  if (!t) return '';
  const parts = String(t).split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] || 0);
  if (Number.isNaN(h) || Number.isNaN(m)) return String(t);
  if (h < 0 || h > 23 || m < 0 || m > 59) return String(t);
  const hr12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'AM' : 'PM';
  const mm = m < 10 ? `0${m}` : String(m);
  return `${hr12}:${mm} ${ampm}`;
}

/** Combined: "Today · 2:30 PM" or "14 May 2026 · 9:00 AM". */
export function formatBookingDateTime(date: string | null | undefined, time: string | null | undefined): string {
  const d = formatBookingDate(date);
  const t = formatBookingTime(time);
  if (d && t) return `${d} · ${t}`;
  return d || t || '';
}

/**
 * True when a booking's scheduled wall-clock date/time is already in the past.
 *
 * Used to move bookings from "Present" to "Past" based on WHEN they were
 * scheduled, not just their status — a pending booking whose slot has passed
 * belongs in Past even though it was never accepted.
 *
 * If only a date is given (no time) the whole day counts as not-yet-past until
 * it ends. Returns false when the date can't be parsed so we never accidentally
 * hide a booking we can't place in time.
 */
export function isBookingDateTimePast(date: string | null | undefined, time: string | null | undefined): boolean {
  if (!date) return false;
  const parts = String(date).slice(0, 10).split('-');
  if (parts.length !== 3) return false;
  const y = Number(parts[0]); const mo = Number(parts[1]); const d = Number(parts[2]);
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return false;

  // Default to end of day when no time is provided.
  let h = 23; let mi = 59; let s = 59;
  if (time) {
    const tp = String(time).split(':');
    const th = Number(tp[0]); const tm = Number(tp[1] ?? 0); const ts = Number(tp[2] ?? 0);
    if (!Number.isNaN(th) && !Number.isNaN(tm) && th >= 0 && th <= 23 && tm >= 0 && tm <= 59) {
      h = th; mi = tm; s = Number.isNaN(ts) ? 0 : ts;
    }
  }

  const dt = new Date(y, mo - 1, d, h, mi, s);
  // Guard against day-of-month rollover (e.g. 2026-02-31 -> March).
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return false;
  return dt.getTime() < Date.now();
}
