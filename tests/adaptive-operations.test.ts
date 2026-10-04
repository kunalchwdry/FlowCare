import { describe, expect, it } from 'vitest';
import { formatQueueId, openCapacity, orderQueue } from '@/lib/operations/policy';
import type { QueueEntry } from '@/lib/careAccess/types';

describe('adaptive slot and queue policy', () => {
  it('formats a human-readable queue id without clinical meaning', () => {
    expect(formatQueueId(2026, 'Orthopaedics & Spine', 42)).toBe('FC-2026-ORTHOPAE-000042');
    expect(formatQueueId(2026, '', 7)).toBe('FC-2026-CARE-000007');
  });

  it('reports only observed future capacity', () => {
    const now = new Date('2026-10-03T10:00:00Z');
    expect(openCapacity({ capacity: 4, booked: 3, bookingOpen: true, startsAt: '2026-10-03T11:00:00Z', endsAt: '2026-10-03T12:00:00Z' }, now)).toBe(1);
    expect(openCapacity({ capacity: 4, booked: 0, bookingOpen: false, startsAt: '2026-10-03T11:00:00Z', endsAt: '2026-10-03T12:00:00Z' }, now)).toBe(0);
    expect(openCapacity({ capacity: 4, booked: 0, bookingOpen: true, startsAt: '2026-10-03T08:00:00Z', endsAt: '2026-10-03T09:00:00Z' }, now)).toBe(0);
  });

  it('applies explicit queue rules and never reads a clinical urgency field', () => {
    const rows = [
      { id: '2', createdAt: '2026-10-03T10:02:00Z', estimatedSlotAt: '2026-10-03T10:30:00Z', position: 2 },
      { id: '1', createdAt: '2026-10-03T10:01:00Z', estimatedSlotAt: '2026-10-03T11:00:00Z', position: 1 },
    ].map((x) => ({ ...x, queueId: `FC-${x.id}`, careRequestId: null, appointmentId: null, patientId: `p-${x.id}`, hospitalId: 'h', departmentId: 'd', providerId: null, slotId: null, queueType: 'waitlist', status: 'waiting', lastUpdatedAt: x.createdAt } as QueueEntry));
    expect(orderQueue(rows, 'arrival_order').map((x) => x.id)).toEqual(['1', '2']);
    expect(orderQueue(rows, 'scheduled_time').map((x) => x.id)).toEqual(['2', '1']);
    expect(orderQueue(rows, 'manual').map((x) => x.id)).toEqual(['1', '2']);
  });
});
