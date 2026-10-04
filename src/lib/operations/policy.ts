import type { QueueEntry } from '@/lib/careAccess/types';
import type { OperationalSlot } from './types';

export type QueueOrderRule = 'arrival_order' | 'scheduled_time' | 'manual';

/** Queue IDs identify a journey; they never encode urgency or clinical rank. */
export function formatQueueId(year: number, departmentCode: string, sequence: number): string {
  const code = departmentCode.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase() || 'CARE';
  return `FC-${year}-${code}-${String(Math.max(0, sequence)).padStart(6, '0')}`;
}

export function openCapacity(slot: Pick<OperationalSlot, 'capacity' | 'booked' | 'bookingOpen' | 'startsAt' | 'endsAt'>, now = new Date()): number {
  if (!slot.bookingOpen || new Date(slot.endsAt).getTime() <= now.getTime()) return 0;
  return Math.max(0, slot.capacity - slot.booked);
}

/** Explicit operational ordering only; there is intentionally no urgency field. */
export function orderQueue(entries: QueueEntry[], rule: QueueOrderRule): QueueEntry[] {
  const rows = entries.slice();
  if (rule === 'manual') return rows.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.createdAt.localeCompare(b.createdAt));
  if (rule === 'scheduled_time') return rows.sort((a, b) => (a.estimatedSlotAt ?? '9999').localeCompare(b.estimatedSlotAt ?? '9999') || a.createdAt.localeCompare(b.createdAt));
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
