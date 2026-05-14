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
  if (!y || !m || !d) return String(iso);
  const dt = new Date(y, m - 1, d);
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
