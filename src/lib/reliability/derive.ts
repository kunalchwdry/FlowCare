import type { Appointment, AppointmentEvent } from '@/lib/types';
import {
  clampReliabilityScore,
  reliabilityStatus,
  RELIABILITY_RULES,
  type PatientReliability,
  type ReliabilityEvent,
} from './types';

/**
 * Demo-only derivation using the same authoritative appointment statuses and
 * append-only event trail as the live adapter. There is intentionally no
 * random seed, synthetic visit, or automatic timeout-based no-show.
 */
export function deriveReliability(
  appointments: Appointment[],
  events: AppointmentEvent[],
): PatientReliability {
  const byAppointment = new Map<string, AppointmentEvent[]>();
  for (const event of events) {
    const list = byAppointment.get(event.appointmentId) ?? [];
    list.push(event);
    byAppointment.set(event.appointmentId, list);
  }

  const rows: ReliabilityEvent[] = [];
  const cancelledAppointments = new Set<string>();
  for (const appointment of appointments) {
    const appointmentEvents = byAppointment.get(appointment.id) ?? [];
    if (appointment.status === 'cancelled' || appointmentEvents.some((event) => event.action === 'cancel')) {
      cancelledAppointments.add(appointment.id);
    }
    const terminal = new Set<string>();
    for (const event of appointmentEvents) {
      const type = event.action === 'complete' ? 'attended'
        : event.action === 'no_show' ? 'no_show'
        : event.action === 'cancel' && isLateCancellation(appointment, event.createdAt)
          ? 'late_cancellation'
          : null;
      if (!type || terminal.has(type)) continue;
      terminal.add(type);
      rows.push({
        id: event.id,
        appointmentId: appointment.id,
        type,
        pointsDelta: RELIABILITY_RULES[type === 'attended' ? 'attended' : type === 'no_show' ? 'noShow' : 'lateCancellation'],
        occurredAt: event.createdAt,
      });
    }

    // Seed/demo history predates the in-memory event log. The status is still
    // an official appointment outcome, so use it once when no matching event
    // exists. A cancelled row without a verified cancellation timestamp earns
    // no deduction rather than an invented one.
    if (appointment.status === 'completed' && !terminal.has('attended')) {
      rows.push({
        id: `status-${appointment.id}-completed`, appointmentId: appointment.id,
        type: 'attended', pointsDelta: RELIABILITY_RULES.attended,
        occurredAt: appointment.completedAt ?? appointment.scheduledFor,
      });
    } else if (appointment.status === 'no_show' && !terminal.has('no_show')) {
      rows.push({
        id: `status-${appointment.id}-no-show`, appointmentId: appointment.id,
        type: 'no_show', pointsDelta: RELIABILITY_RULES.noShow,
        occurredAt: appointment.scheduledFor,
      });
    }
  }

  rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const score = clampReliabilityScore(
    RELIABILITY_RULES.startingScore + rows.reduce((sum, row) => sum + row.pointsDelta, 0),
  );
  return {
    score,
    updatedAt: rows[0]?.occurredAt ?? null,
    status: reliabilityStatus(score),
    completedCount: rows.filter((r) => r.type === 'attended').length,
    cancelledCount: cancelledAppointments.size,
    lateCancellationCount: rows.filter((r) => r.type === 'late_cancellation').length,
    noShowCount: rows.filter((r) => r.type === 'no_show').length,
    pointHistory: rows,
  };
}

function isLateCancellation(appointment: Appointment, occurredAt: string): boolean {
  const starts = Date.parse(appointment.scheduledFor);
  const cancelled = Date.parse(occurredAt);
  if (!Number.isFinite(starts) || !Number.isFinite(cancelled)) return false;
  const hours = (starts - cancelled) / 3_600_000;
  return hours >= 0 && hours <= RELIABILITY_RULES.lateCancellationWindowHours;
}
