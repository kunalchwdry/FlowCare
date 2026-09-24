/**
 * Availability is derived ONLY from authoritative FlowCare clinic sessions.
 * It is never inferred from opening hours, never from Google data, and always
 * carries the timestamp at which it was computed.
 */
import type { AvailabilityState, ClinicSession, HospitalAvailability } from '@/lib/types';

export const AVAILABILITY_WINDOW_DAYS = 14;
/** ≥ this many open slots in the window => "available". */
export const AVAILABLE_THRESHOLD = 10;

export function computeAvailability(
  hospitalId: string,
  sessions: ClinicSession[],
  now: Date = new Date(),
  windowDays: number = AVAILABILITY_WINDOW_DAYS,
): HospitalAvailability {
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + windowDays * 86_400_000).toISOString().slice(0, 10);

  const relevant = sessions.filter(
    (s) => s.hospitalId === hospitalId && s.date >= today && s.date <= horizon && s.status !== 'cancelled',
  );

  if (relevant.length === 0) {
    return {
      hospitalId,
      state: 'unknown',
      openSlots: null,
      nextAvailableDate: null,
      bySpecialty: {},
      computedAt: now.toISOString(),
      windowDays,
    };
  }

  let openSlots = 0;
  let nextAvailableDate: string | null = null;
  const bySpecialty: Record<string, number> = {};

  for (const s of relevant.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    const free = Math.max(0, s.capacity - s.booked);
    if (s.status !== 'open' || free === 0) continue;
    openSlots += free;
    if (nextAvailableDate === null) nextAvailableDate = s.date;
    // departmentId format: "<hospital>:dept:<specialty>"
    const specialty = s.departmentId.split(':dept:')[1] ?? 'unknown';
    bySpecialty[specialty] = (bySpecialty[specialty] ?? 0) + free;
  }

  const state: AvailabilityState =
    openSlots >= AVAILABLE_THRESHOLD ? 'available' : openSlots > 0 ? 'limited' : 'none';

  return {
    hospitalId, state, openSlots, nextAvailableDate, bySpecialty,
    computedAt: now.toISOString(), windowDays,
  };
}

/** Availability restricted to a specific specialty, used by specialty filters. */
export function specialtyAvailable(a: HospitalAvailability, specialty: string): boolean {
  return (a.bySpecialty[specialty] ?? 0) > 0;
}

/** Freshness guard — never show a stale snapshot as if it were live. */
export function isFresh(a: HospitalAvailability, maxAgeMs = 5 * 60_000, now: Date = new Date()): boolean {
  return now.getTime() - new Date(a.computedAt).getTime() <= maxAgeMs;
}
