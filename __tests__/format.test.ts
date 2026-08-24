import { formatBookingDate, formatBookingDateTime, formatBookingTime, isBookingDateTimePast } from '../lib/format';

describe('formatBookingTime', () => {
  it('formats 24h time as 12h with AM/PM', () => {
    expect(formatBookingTime('14:30')).toBe('2:30 PM');
    expect(formatBookingTime('09:05')).toBe('9:05 AM');
    expect(formatBookingTime('00:00')).toBe('12:00 AM');
    expect(formatBookingTime('12:00')).toBe('12:00 PM');
  });

  it('accepts HH:MM:SS', () => {
    expect(formatBookingTime('14:30:00')).toBe('2:30 PM');
  });

  it('returns input unchanged for invalid values', () => {
    expect(formatBookingTime('25:00')).toBe('25:00');
    expect(formatBookingTime('10:99')).toBe('10:99');
    expect(formatBookingTime('abc')).toBe('abc');
    expect(formatBookingTime('')).toBe('');
    expect(formatBookingTime(null)).toBe('');
  });
});

describe('formatBookingDate', () => {
  it('formats a plain date', () => {
    expect(formatBookingDate('2026-05-14')).toBe('14 May 2026');
  });

  it('accepts datetime strings by taking the date part', () => {
    expect(formatBookingDate('2026-05-14T10:30:00')).toBe('14 May 2026');
  });

  it('labels today and tomorrow', () => {
    const today = new Date();
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(formatBookingDate(iso(today))).toBe('Today');
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    expect(formatBookingDate(iso(tomorrow))).toBe('Tomorrow');
  });

  it('returns input unchanged for invalid dates instead of rolling over', () => {
    expect(formatBookingDate('2026-13-01')).toBe('2026-13-01'); // month 13
    expect(formatBookingDate('2026-02-31')).toBe('2026-02-31'); // Feb 31
    expect(formatBookingDate('not-a-date')).toBe('not-a-date');
    expect(formatBookingDate('')).toBe('');
    expect(formatBookingDate(null)).toBe('');
  });
});

describe('formatBookingDateTime', () => {
  it('joins date and time with a separator', () => {
    expect(formatBookingDateTime('2026-05-14', '09:00')).toBe('14 May 2026 · 9:00 AM');
  });

  it('returns whichever part is present', () => {
    expect(formatBookingDateTime('2026-05-14', null)).toBe('14 May 2026');
    expect(formatBookingDateTime(null, '09:00')).toBe('9:00 AM');
    expect(formatBookingDateTime(null, null)).toBe('');
  });
});

describe('isBookingDateTimePast', () => {
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const daysFromNow = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return ymd(d);
  };

  it('flags past dates and keeps future dates active', () => {
    expect(isBookingDateTimePast(daysFromNow(-1), '10:00')).toBe(true); // yesterday
    expect(isBookingDateTimePast(daysFromNow(1), '10:00')).toBe(false); // tomorrow
    expect(isBookingDateTimePast('2000-01-01', '10:00')).toBe(true);
    expect(isBookingDateTimePast('2100-01-01', '10:00')).toBe(false);
  });

  it('treats a date with no time as not past until the day ends', () => {
    expect(isBookingDateTimePast(daysFromNow(0), null)).toBe(false); // today, no time
    expect(isBookingDateTimePast(daysFromNow(-1), null)).toBe(true); // yesterday, no time
  });

  it('returns false for missing or invalid dates so bookings are never hidden', () => {
    expect(isBookingDateTimePast(null, '10:00')).toBe(false);
    expect(isBookingDateTimePast('', '10:00')).toBe(false);
    expect(isBookingDateTimePast('not-a-date', '10:00')).toBe(false);
    expect(isBookingDateTimePast('2026-13-01', '10:00')).toBe(false); // month 13
    expect(isBookingDateTimePast('2026-02-31', '10:00')).toBe(false); // Feb 31
  });
});
