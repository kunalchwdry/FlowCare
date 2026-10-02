/**
 * Dates and times, always in the clinic's own timezone.
 *
 * The bug this exists to kill: the server runs in UTC. `toLocaleString()`
 * with no timezone therefore formats in UTC wherever it executes, so a
 * 09:30 clinic in Pune rendered as 04:00 — on the hospital's own dashboard,
 * on the patient's appointment list, and in the slot picker. Every one of
 * those is a time somebody could turn up on, which makes it about the worst
 * class of display bug this product can have.
 *
 * Client and server also disagreed: the browser used the visitor's local
 * zone, the server used UTC, so the same appointment showed two different
 * times depending on whether a page was server-rendered or re-rendered
 * after hydration.
 *
 * Everything here pins an explicit zone. The default is Asia/Kolkata
 * because every hospital in the database carries that timezone, but it is
 * a parameter rather than a constant so a hospital elsewhere is a data
 * change and not a code change.
 *
 * One rule: an appointment time is shown in the TIMEZONE OF THE HOSPITAL,
 * never the viewer's. A patient travelling abroad must still read the time
 * they are expected to arrive, not that time converted to where they are
 * standing.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Reusable formatters are noticeably cheaper than constructing per call. */
const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-IN', { timeZone, ...opts });
    cache.set(key, f);
  }
  return f;
}

function parse(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2 Oct 2026" */
export function formatDate(value: string | number | Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  const d = parse(value);
  if (!d) return '—';
  return fmt(timeZone, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** "9:30 am" */
export function formatTime(value: string | number | Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  const d = parse(value);
  if (!d) return '—';
  return fmt(timeZone, { hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}

/** "2 Oct 2026, 9:30 am" */
export function formatDateTime(value: string | number | Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  const d = parse(value);
  if (!d) return '—';
  return fmt(timeZone, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

/** "Fri, 2 Oct" — for day headings. */
export function formatDayLabel(value: string | number | Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  const d = parse(value);
  if (!d) return '—';
  return fmt(timeZone, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

/**
 * "HH:mm" in the given zone, 24-hour.
 *
 * Used where a slot's start and end are stored separately from its date.
 * This replaced `toISOString().slice(11,16)`, which is UTC by definition
 * and was the origin of the 04:00 problem.
 */
export function clockTime(value: string | number | Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  const d = parse(value);
  if (!d) return '—';
  return fmt(timeZone, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/**
 * "YYYY-MM-DD" as it falls in the given zone.
 *
 * Not `toISOString().slice(0,10)`: a 00:30 IST appointment is still the
 * previous day in UTC, so grouping "today's" appointments by the UTC date
 * silently moved early-morning clinics to the wrong day.
 */
export function zonedDateKey(value: string | number | Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  const d = parse(value);
  if (!d) return '';
  const parts = fmt(timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's date key in the clinic's zone. */
export function todayKey(timeZone = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return zonedDateKey(now, timeZone);
}

/** Hour of day (0–23) in the clinic's zone, for demand charts. */
export function zonedHour(value: string | number | Date | null | undefined, timeZone = DEFAULT_TIMEZONE): number | null {
  const d = parse(value);
  if (!d) return null;
  const h = fmt(timeZone, { hour: '2-digit', hour12: false }).format(d);
  const n = Number(h);
  return Number.isFinite(n) ? n % 24 : null;
}
