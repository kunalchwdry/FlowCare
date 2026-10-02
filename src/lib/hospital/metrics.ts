/**
 * Dashboard figures, derived only from stored appointments and events.
 *
 * Nothing here estimates, extrapolates or back-fills. Where the events to
 * answer a question do not exist, the caller gets `null` and renders "not
 * enough data yet" — a fabricated denominator is worse than a blank.
 */
import type { Appointment, AppointmentEvent } from '@/lib/types';
import { todayKey, zonedDateKey } from '@/lib/time';

export interface HospitalMetrics {
  todayTotal: number;
  pending: number;
  confirmed: number;
  awaitingPatient: number;
  cancelled: number;
  rejected: number;
  completed: number;
  noShow: number;
  inQueue: number;
  upcoming: number;
  patientsServed: number;
  /** null when nothing has ever been confirmed, so there is nothing to average. */
  avgConfirmationMinutes: number | null;
  /** null until at least one appointment has reached a terminal state. */
  cancellationRate: number | null;
  noShowRate: number | null;
  topDepartments: { departmentId: string; count: number }[];
}

// Compared in the clinic's timezone; a UTC slice puts early-morning
// appointments on the wrong day.
const isToday = (iso: string | null | undefined, today: string) =>
  Boolean(iso && zonedDateKey(iso) === today);

export function computeMetrics(
  appointments: Appointment[],
  events: AppointmentEvent[],
  now = new Date(),
): HospitalMetrics {
  const today = todayKey(undefined, now);
  const byStatus = (s: Appointment['status']) => appointments.filter((a) => a.status === s).length;

  /*
   * Average request -> confirmation, computed only from appointments where
   * both ends were actually recorded. Rows confirmed before the event log
   * existed are skipped rather than guessed at, which is why this can return
   * null even when confirmed appointments exist.
   */
  const deltas: number[] = [];
  for (const e of events) {
    if (e.action !== 'accept') continue;
    const apt = appointments.find((a) => a.id === e.appointmentId);
    const requestedAt = apt?.requestedAt;
    if (!requestedAt) continue;
    const mins = (Date.parse(e.createdAt) - Date.parse(requestedAt)) / 60000;
    if (Number.isFinite(mins) && mins >= 0) deltas.push(mins);
  }

  const terminal = appointments.filter((a) =>
    ['completed', 'cancelled', 'rejected', 'no_show'].includes(a.status),
  ).length;

  const counts = new Map<string, number>();
  for (const a of appointments) counts.set(a.departmentId, (counts.get(a.departmentId) ?? 0) + 1);

  return {
    todayTotal: appointments.filter((a) => isToday(a.scheduledFor, today)).length,
    pending: byStatus('requested'),
    confirmed: byStatus('booked'),
    awaitingPatient: byStatus('reschedule_proposed'),
    cancelled: byStatus('cancelled'),
    rejected: byStatus('rejected'),
    completed: byStatus('completed'),
    noShow: byStatus('no_show'),
    inQueue: appointments.filter((a) => ['checked_in', 'in_progress'].includes(a.status)).length,
    upcoming: appointments.filter(
      (a) => ['booked', 'requested'].includes(a.status) && a.scheduledFor >= now.toISOString(),
    ).length,
    patientsServed: new Set(
      appointments.filter((a) => a.status === 'completed').map((a) => a.patientId),
    ).size,
    avgConfirmationMinutes: deltas.length
      ? Math.round(deltas.reduce((x, y) => x + y, 0) / deltas.length)
      : null,
    cancellationRate: terminal
      ? Math.round(((byStatus('cancelled') + byStatus('rejected')) / terminal) * 100)
      : null,
    noShowRate: terminal ? Math.round((byStatus('no_show') / terminal) * 100) : null,
    topDepartments: [...counts.entries()]
      .map(([departmentId, count]) => ({ departmentId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}
