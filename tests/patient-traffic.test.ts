import { describe, expect, it } from 'vitest';
import type { Appointment, AppointmentEvent } from '@/lib/types';
import type { QueueEntry } from '@/lib/careAccess/types';
import {
  TRAFFIC_THRESHOLDS,
  aggregateAppointmentTraffic,
  classifyTraffic,
  operationalTrafficStatus,
  reliableEstimatedWaitMinutes,
  snapshotFromCounts,
  trafficBucket,
} from '@/lib/traffic/traffic';

const NOW = new Date('2026-10-05T10:00:00+05:30');

function appointment(id: string, status: Appointment['status'], hospitalId = 'h1', departmentId = 'd1'): Appointment {
  return {
    id, hospitalId, departmentId, patientId: `patient-${id}`, sessionId: `slot-${id}`,
    scheduledFor: '2026-10-05T09:30:00+05:30', status, completedAt: null,
  };
}

function event(appointmentId: string, action: string, createdAt = '2026-10-05T09:45:00+05:30'): AppointmentEvent {
  return {
    id: `${appointmentId}-${action}`, appointmentId, action, fromStatus: null, toStatus: action,
    actorSide: 'hospital', actorRole: 'staff', actorId: 'staff-1', reason: null, createdAt,
  };
}

function queue(status: QueueEntry['status'], estimatedSlotAt: string | null, lastUpdatedAt: string): QueueEntry {
  return {
    id: `q-${status}`, queueId: 'queue-1', careRequestId: null, appointmentId: 'a1',
    patientId: 'private-patient-id', hospitalId: 'h1', departmentId: 'd1', slotId: 's1',
    queueType: 'appointment', status, position: null, estimatedSlotAt, lastUpdatedAt, createdAt: lastUpdatedAt,
  };
}

describe('patient traffic domain', () => {
  it('keeps status mapping aligned with the existing appointment state machine', () => {
    expect(trafficBucket('booked')).toBe('waiting');
    expect(trafficBucket('checked_in')).toBe('waiting');
    expect(trafficBucket('in_progress')).toBe('in_consultation');
    for (const status of ['completed', 'cancelled', 'rejected', 'no_show'] as const) {
      expect(trafficBucket(status)).toBe('inactive');
    }
    expect(trafficBucket('requested')).toBe('not_active');
    expect(trafficBucket('reschedule_proposed')).toBe('not_active');
  });

  it('derives live operational states from the latest event without adding a new state', () => {
    expect(operationalTrafficStatus(appointment('a1', 'booked'), [event('a1', 'check_in')])).toBe('checked_in');
    expect(operationalTrafficStatus(appointment('a1', 'booked'), [event('a1', 'start')])).toBe('in_progress');
    expect(operationalTrafficStatus(appointment('a1', 'booked'), [event('a1', 'complete')])).toBe('completed');
    expect(operationalTrafficStatus(appointment('a1', 'requested'), [event('a1', 'check_in')])).toBe('requested');
  });

  it('uses centralized, documented thresholds', () => {
    expect(classifyTraffic(TRAFFIC_THRESHOLDS.lowMaxWaiting)).toBe('LOW');
    expect(classifyTraffic(TRAFFIC_THRESHOLDS.lowMaxWaiting + 1)).toBe('MODERATE');
    expect(classifyTraffic(TRAFFIC_THRESHOLDS.moderateMaxWaiting)).toBe('MODERATE');
    expect(classifyTraffic(TRAFFIC_THRESHOLDS.moderateMaxWaiting + 1)).toBe('HIGH');
  });

  it('accepts ETA only from complete, recent explicit queue estimates', () => {
    const recent = '2026-10-05T09:55:00+05:30';
    expect(reliableEstimatedWaitMinutes([
      queue('waiting', '2026-10-05T10:20:00+05:30', recent),
      queue('booked', '2026-10-05T10:40:00+05:30', recent),
    ], NOW)).toBe(30);
    expect(reliableEstimatedWaitMinutes([
      queue('waiting', '2026-10-05T10:20:00+05:30', '2026-10-05T09:00:00+05:30'),
    ], NOW)).toBeNull();
    expect(reliableEstimatedWaitMinutes([
      queue('waiting', null, recent),
    ], NOW)).toBeNull();
  });

  it('counts only today active appointments and keeps hospitals independent', () => {
    const a1 = appointment('a1', 'booked');
    const a2 = appointment('a2', 'checked_in');
    const a3 = appointment('a3', 'in_progress');
    const a4 = appointment('a4', 'completed');
    const a5 = appointment('a5', 'requested');
    const other = appointment('other', 'booked', 'h2');
    const snapshot = aggregateAppointmentTraffic(
      'h1', [a1, a2, a3, a4, a5, other],
      new Map([['a1', [event('a1', 'check_in')]]]),
      [], NOW,
    );
    expect(snapshot.available).toBe(true);
    expect(snapshot.waitingCount).toBe(2);
    expect(snapshot.inConsultationCount).toBe(1);
    expect(snapshot.completedToday).toBe(1);
    expect(snapshot.trafficLevel).toBe('LOW');
    expect(snapshot.hospitalId).toBe('h1');
    expect(snapshot).not.toHaveProperty('patientId');
    expect(snapshot).not.toHaveProperty('patientName');

    const otherSnapshot = aggregateAppointmentTraffic('h2', [other], new Map(), [], NOW);
    expect(otherSnapshot.waitingCount).toBe(1);
    expect(otherSnapshot.hospitalId).toBe('h2');
  });

  it('returns unavailable rather than a fabricated low value when there is no data', () => {
    const snapshot = aggregateAppointmentTraffic('h1', [], new Map(), [], NOW);
    expect(snapshot.available).toBe(false);
    expect(snapshot.trafficLevel).toBeNull();
    expect(snapshot.waitingCount).toBeNull();
    expect(snapshot.estimatedWaitMinutes).toBeNull();

    const stale = snapshotFromCounts({
      hospitalId: 'h1', waitingCount: 1, inConsultationCount: 0, completedToday: 0,
      estimatedWaitMinutes: 10, updatedAt: '2026-10-05T08:00:00+05:30', available: true,
    }, NOW);
    expect(stale.freshness).toBe('stale');
    expect(stale.available).toBe(false);
    expect(stale.waitingCount).toBeNull();
  });
});
