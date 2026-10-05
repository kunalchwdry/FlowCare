import type { QueueEntry } from '@/lib/careAccess/types';
import type { Appointment, AppointmentEvent } from '@/lib/types';
import { todayKey, zonedDateKey } from '@/lib/time';

/**
 * Patient traffic is appointment traffic, not road traffic. These thresholds
 * are deliberately kept in one place so the patient and hospital portals
 * cannot disagree about the meaning of LOW, MODERATE, or HIGH.
 *
 * Change these values here when operations agrees on a new policy. They are
 * not a substitute for real queue data: a missing or stale source remains
 * unavailable rather than being filled with a default number.
 */
export const TRAFFIC_THRESHOLDS = Object.freeze({
  lowMaxWaiting: 5,
  moderateMaxWaiting: 15,
  staleAfterMinutes: 15,
  maxReliableWaitMinutes: 240,
});

export type TrafficLevel = 'LOW' | 'MODERATE' | 'HIGH';
export type TrafficFreshness = 'fresh' | 'stale' | 'unavailable';
export type TrafficBucket = 'waiting' | 'in_consultation' | 'inactive' | 'not_active';

export interface TrafficDepartmentBreakdown {
  departmentId: string;
  departmentName: string | null;
  waitingCount: number;
  inConsultationCount: number;
  completedToday: number;
}

export interface TrafficProviderBreakdown {
  providerId: string;
  providerName: string | null;
  waitingCount: number;
  inConsultationCount: number;
  completedToday: number;
}

/** The privacy-safe shape returned to patient-facing surfaces. */
export interface PatientTrafficSnapshot {
  hospitalId: string;
  available: boolean;
  trafficLevel: TrafficLevel | null;
  waitingCount: number | null;
  inConsultationCount: number | null;
  completedToday: number | null;
  estimatedWaitMinutes: number | null;
  /** Aggregate read time, never a patient or appointment timestamp. */
  updatedAt: string | null;
  freshness: TrafficFreshness;
  /** Populated only for an authorised hospital queue reader. */
  byDepartment: TrafficDepartmentBreakdown[];
  byProvider: TrafficProviderBreakdown[];
}

export interface TrafficCounts {
  hospitalId: string;
  waitingCount: number;
  inConsultationCount: number;
  completedToday: number;
  estimatedWaitMinutes: number | null;
  updatedAt: string | null;
  available: boolean;
  freshness?: TrafficFreshness;
  byDepartment?: TrafficDepartmentBreakdown[];
  byProvider?: TrafficProviderBreakdown[];
}

const WAITING_STATUSES = new Set<Appointment['status']>(['booked', 'checked_in']);
const IN_CONSULTATION_STATUSES = new Set<Appointment['status']>(['in_progress']);
const INACTIVE_STATUSES = new Set<Appointment['status']>([
  'completed', 'cancelled', 'rejected', 'no_show',
]);

/**
 * Converts the persisted event trail into the app-level state used by the
 * existing portal. The live database keeps check-in and consultation as
 * events while its appointment status remains `confirmed`; this function is
 * the one crossing point for that difference.
 */
export function operationalTrafficStatus(
  appointment: Pick<Appointment, 'status'>,
  events: readonly Pick<AppointmentEvent, 'action' | 'createdAt'>[] = [],
): Appointment['status'] {
  if (appointment.status !== 'booked') return appointment.status;

  const latest = events
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  switch (latest?.action) {
    case 'check_in': return 'checked_in';
    case 'start': return 'in_progress';
    case 'complete': return 'completed';
    case 'cancel': return 'cancelled';
    case 'no_show': return 'no_show';
    default: return appointment.status;
  }
}

export function trafficBucket(status: Appointment['status']): TrafficBucket {
  if (WAITING_STATUSES.has(status)) return 'waiting';
  if (IN_CONSULTATION_STATUSES.has(status)) return 'in_consultation';
  if (INACTIVE_STATUSES.has(status)) return 'inactive';
  return 'not_active';
}

export function classifyTraffic(
  waitingCount: number,
  thresholds: typeof TRAFFIC_THRESHOLDS = TRAFFIC_THRESHOLDS,
): TrafficLevel {
  if (waitingCount <= thresholds.lowMaxWaiting) return 'LOW';
  if (waitingCount <= thresholds.moderateMaxWaiting) return 'MODERATE';
  return 'HIGH';
}

function isFresh(timestamp: string | null | undefined, now: Date, maxAgeMinutes: number): boolean {
  if (!timestamp) return false;
  const then = new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return false;
  const age = now.getTime() - then;
  return age >= 0 && age <= maxAgeMinutes * 60_000;
}

/**
 * Uses only explicit queue estimates already stored by FlowCare. It refuses
 * to calculate an ETA from a patient count, appointment spacing, or a made-up
 * service rate. Every active queue row must carry a recent estimate.
 */
export function reliableEstimatedWaitMinutes(
  entries: readonly Pick<QueueEntry, 'status' | 'estimatedSlotAt' | 'lastUpdatedAt'>[],
  now = new Date(),
  thresholds: typeof TRAFFIC_THRESHOLDS = TRAFFIC_THRESHOLDS,
): number | null {
  const active = entries.filter((e) => e.status === 'waiting' || e.status === 'booked');
  if (active.length === 0) return null;
  if (active.some((e) => !e.estimatedSlotAt || !isFresh(e.lastUpdatedAt, now, thresholds.staleAfterMinutes))) {
    return null;
  }

  const waits = active.map((e) => Math.max(
    0,
    Math.round((new Date(e.estimatedSlotAt!).getTime() - now.getTime()) / 60_000),
  ));
  if (waits.some((n) => !Number.isFinite(n) || n > thresholds.maxReliableWaitMinutes)) return null;
  return Math.round(waits.reduce((total, wait) => total + wait, 0) / waits.length);
}

export function snapshotFromCounts(
  counts: TrafficCounts,
  now = new Date(),
  thresholds: typeof TRAFFIC_THRESHOLDS = TRAFFIC_THRESHOLDS,
): PatientTrafficSnapshot {
  const proposedFreshness = counts.freshness
    ?? (counts.available && counts.updatedAt && isFresh(counts.updatedAt, now, thresholds.staleAfterMinutes)
      ? 'fresh'
      : counts.available ? 'stale' : 'unavailable');
  const freshness: TrafficFreshness = proposedFreshness === 'fresh' && !counts.updatedAt
    ? 'unavailable'
    : proposedFreshness;
  // A stale source is not safe to re-label as LOW or zero. Keep its
  // freshness reason, but make the public traffic values unavailable.
  const available = counts.available && freshness === 'fresh';
  const numbersAvailable = Number.isFinite(counts.waitingCount)
    && Number.isFinite(counts.inConsultationCount)
    && Number.isFinite(counts.completedToday);
  const usable = available && numbersAvailable;
  return {
    hospitalId: counts.hospitalId,
    available: usable,
    trafficLevel: usable ? classifyTraffic(counts.waitingCount, thresholds) : null,
    waitingCount: usable ? counts.waitingCount : null,
    inConsultationCount: usable ? counts.inConsultationCount : null,
    completedToday: usable ? counts.completedToday : null,
    // A stale aggregate may still show counts, but never a wait estimate.
    estimatedWaitMinutes: usable && freshness === 'fresh' ? counts.estimatedWaitMinutes : null,
    updatedAt: usable ? counts.updatedAt : null,
    freshness: usable ? freshness : freshness === 'stale' ? 'stale' : 'unavailable',
    byDepartment: counts.byDepartment ?? [],
    byProvider: counts.byProvider ?? [],
  };
}

/** Pure demo/test aggregation over existing appointment and queue rows. */
export function aggregateAppointmentTraffic(
  hospitalId: string,
  appointments: readonly Appointment[],
  eventsByAppointment: ReadonlyMap<string, readonly AppointmentEvent[]> = new Map(),
  queueEntries: readonly QueueEntry[] = [],
  now = new Date(),
  departmentNames: ReadonlyMap<string, string> = new Map(),
  includeDetails = false,
): PatientTrafficSnapshot {
  const today = todayKey('Asia/Kolkata', now);
  const todayAppointments = appointments.filter((a) => a.hospitalId === hospitalId
    && zonedDateKey(a.scheduledFor, 'Asia/Kolkata') === today);
  const buckets = todayAppointments.map((appointment) => ({
    appointment,
    status: operationalTrafficStatus(appointment, eventsByAppointment.get(appointment.id) ?? []),
  }));
  const waiting = buckets.filter((x) => trafficBucket(x.status) === 'waiting');
  const inConsultation = buckets.filter((x) => trafficBucket(x.status) === 'in_consultation');
  const completedToday = buckets.filter((x) => x.status === 'completed').length;
  const available = todayAppointments.length > 0;
  const updatedAt = available ? now.toISOString() : null;
  const eta = reliableEstimatedWaitMinutes(
    queueEntries.filter((entry) => entry.hospitalId === hospitalId
      && entry.appointmentId && waiting.some((x) => x.appointment.id === entry.appointmentId)), 
    now,
  );

  const byDepartment = includeDetails
    ? Array.from(new Set(buckets.map((x) => x.appointment.departmentId))).map((departmentId) => {
        const rows = buckets.filter((x) => x.appointment.departmentId === departmentId);
        return {
          departmentId,
          departmentName: departmentNames.get(departmentId) ?? null,
          waitingCount: rows.filter((x) => trafficBucket(x.status) === 'waiting').length,
          inConsultationCount: rows.filter((x) => trafficBucket(x.status) === 'in_consultation').length,
          completedToday: rows.filter((x) => x.status === 'completed').length,
        };
      })
    : [];

  return snapshotFromCounts({
    hospitalId,
    waitingCount: waiting.length,
    inConsultationCount: inConsultation.length,
    completedToday,
    estimatedWaitMinutes: eta,
    updatedAt,
    available,
    freshness: available ? 'fresh' : 'unavailable',
    byDepartment,
  }, now);
}

export function trafficFreshnessLabel(snapshot: PatientTrafficSnapshot): string {
  if (!snapshot.available || snapshot.freshness === 'unavailable') return 'Traffic unavailable';
  if (snapshot.freshness === 'stale') return 'Traffic data is stale';
  return snapshot.updatedAt ? `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'Updated just now';
}
