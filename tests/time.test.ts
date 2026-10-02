import { describe, expect, it } from 'vitest';
import {
  clockTime, formatDate, formatDateTime, formatTime,
  todayKey, zonedDateKey, zonedHour, DEFAULT_TIMEZONE,
} from '@/lib/time';

/**
 * The server runs in UTC. Every assertion here would have passed by
 * accident on a machine set to IST, which is exactly how the original bug
 * survived: a 09:30 clinic in Pune rendered as 04:00 in production and
 * looked fine locally.
 *
 * 2026-10-03T04:00:00Z is 09:30 on 3 October in Asia/Kolkata (UTC+5:30).
 */
const MORNING_CLINIC = '2026-10-03T04:00:00+00:00';

describe('times are shown in the clinic timezone, not the server one', () => {
  it('renders an 04:00 UTC slot as 09:30', () => {
    expect(clockTime(MORNING_CLINIC)).toBe('09:30');
    expect(formatTime(MORNING_CLINIC)).toMatch(/9:30\s*am/i);
  });

  it('never renders it as the stored UTC hour', () => {
    // The precise regression: toISOString().slice(11,16) gave '04:00'.
    expect(clockTime(MORNING_CLINIC)).not.toBe('04:00');
  });

  it('formats a full date and time together', () => {
    const s = formatDateTime(MORNING_CLINIC);
    expect(s).toMatch(/3 Oct 2026/);
    expect(s).toMatch(/9:30\s*am/i);
  });

  it('honours a different timezone when one is supplied', () => {
    // Timezone is a parameter, so a hospital outside India is a data
    // change rather than a code change.
    expect(clockTime(MORNING_CLINIC, 'UTC')).toBe('04:00');
    expect(clockTime(MORNING_CLINIC, 'Asia/Dubai')).toBe('08:00');
  });
});

describe('date keys follow the clinic day, not the UTC day', () => {
  it('keeps an early-morning IST appointment on its own day', () => {
    // 2026-10-02T19:00Z is 00:30 on 3 October in Kolkata. Grouping by the
    // UTC date would file it under the 2nd and it would vanish from
    // "today" on the day it actually happens.
    const lateNightUtc = '2026-10-02T19:00:00+00:00';
    expect(zonedDateKey(lateNightUtc)).toBe('2026-10-03');
    expect(lateNightUtc.slice(0, 10)).toBe('2026-10-02'); // the old, wrong way
  });

  it('agrees with the date shown to the user', () => {
    expect(zonedDateKey(MORNING_CLINIC)).toBe('2026-10-03');
    expect(formatDate(MORNING_CLINIC)).toMatch(/3 Oct 2026/);
  });

  it('todayKey returns a zoned key in the same shape', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayKey('UTC', new Date('2026-10-02T19:00:00Z'))).toBe('2026-10-02');
    expect(todayKey(DEFAULT_TIMEZONE, new Date('2026-10-02T19:00:00Z'))).toBe('2026-10-03');
  });
});

describe('demand charts bucket by the clinic hour', () => {
  it('reports the local hour', () => {
    expect(zonedHour(MORNING_CLINIC)).toBe(9);
    expect(zonedHour(MORNING_CLINIC, 'UTC')).toBe(4);
  });

  it('wraps midnight to 0 rather than 24', () => {
    expect(zonedHour('2026-10-02T18:30:00+00:00')).toBe(0); // 00:00 IST
  });
});

describe('bad input never crashes a page', () => {
  it.each([null, undefined, '', 'not a date'])('renders %p as an em dash', (v) => {
    expect(formatDate(v as never)).toBe('—');
    expect(formatTime(v as never)).toBe('—');
    expect(formatDateTime(v as never)).toBe('—');
    expect(clockTime(v as never)).toBe('—');
  });

  it('returns an empty key rather than a bogus date', () => {
    expect(zonedDateKey(null)).toBe('');
    expect(zonedHour('nonsense')).toBeNull();
  });
});
