import { describe, expect, it } from 'vitest';
import {
  buildFunnel, demandByDepartment, demandByHour,
  summariseReviews, summarisePatients, todaysQueue, QUEUE_STATES,
} from '@/lib/hospital/portalData';
import type { Appointment, AppointmentEvent, HospitalReview } from '@/lib/types';

/**
 * The portal pages compute everything from stored rows. These pin the two
 * properties that matter most for a product people use to choose care:
 *
 *   1. nothing is invented when there is no data — the functions return
 *      null or an empty list so the page can say "not enough data yet";
 *   2. no figure is derived that would amount to a quality score.
 */

const apt = (over: Partial<Appointment> = {}): Appointment => ({
  id: `apt-${Math.random().toString(36).slice(2, 8)}`,
  hospitalId: 'h1',
  patientId: 'p1',
  departmentId: 'h1:dept:cardiology',
  sessionId: 's1',
  scheduledFor: new Date().toISOString(),
  status: 'requested',
  completedAt: null,
  version: 1,
  ...over,
});

const ev = (appointmentId: string, action: string): AppointmentEvent => ({
  id: `e-${Math.random().toString(36).slice(2, 8)}`,
  appointmentId, action, fromStatus: null, toStatus: 'booked',
  actorSide: 'hospital', actorRole: 'admin', actorId: 'u1',
  reason: null, createdAt: new Date().toISOString(),
});

describe('empty data never becomes a fabricated number', () => {
  it('review stats are null, not zero, with no reviews', () => {
    const s = summariseReviews([]);
    expect(s.count).toBe(0);
    // 0/5 would read as "rated terribly". null means "nobody has rated this".
    expect(s.overall).toBeNull();
    expect(s.waiting).toBeNull();
    expect(s.facility).toBeNull();
  });

  it('demand and funnel are empty rather than guessed', () => {
    expect(demandByDepartment([])).toEqual([]);
    expect(demandByHour([])).toEqual([]);
    expect(buildFunnel([], [])).toEqual({ requested: 0, confirmed: 0, checkedIn: 0, completed: 0 });
  });

  it('an empty queue is empty', () => {
    expect(todaysQueue([])).toEqual([]);
    expect(summarisePatients([])).toEqual([]);
  });
});

describe('the funnel counts stages that were reached, not current status', () => {
  it('a completed appointment still counts as confirmed and checked in', () => {
    const a = apt({ status: 'completed' });
    const f = buildFunnel([a], [ev(a.id, 'accept'), ev(a.id, 'check_in'), ev(a.id, 'complete')]);
    // Counting only the present status would show a drop-off that never
    // happened and make the hospital look worse than it is.
    expect(f).toEqual({ requested: 1, confirmed: 1, checkedIn: 1, completed: 1 });
  });

  it('does not double-count one appointment confirmed twice', () => {
    const a = apt();
    const f = buildFunnel([a], [ev(a.id, 'accept'), ev(a.id, 'accept')]);
    expect(f.confirmed).toBe(1);
  });

  it('counts a reschedule the patient accepted as a confirmation', () => {
    const a = apt();
    expect(buildFunnel([a], [ev(a.id, 'accept_reschedule')]).confirmed).toBe(1);
  });
});

describe('the queue is today only, and operational states only', () => {
  it('excludes other days and finished appointments', () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 864e5).toISOString();
    const rows = [
      apt({ status: 'booked', scheduledFor: today }),
      apt({ status: 'checked_in', scheduledFor: today }),
      apt({ status: 'in_progress', scheduledFor: today }),
      apt({ status: 'completed', scheduledFor: today }),   // finished
      apt({ status: 'requested', scheduledFor: today }),   // not confirmed
      apt({ status: 'booked', scheduledFor: yesterday }),  // not today
    ];
    const q = todaysQueue(rows);
    expect(q).toHaveLength(3);
    for (const a of q) expect(QUEUE_STATES).toContain(a.status as never);
  });

  it('orders by appointment time and nothing else', () => {
    const base = new Date(); base.setHours(9, 0, 0, 0);
    const later = new Date(base.getTime() + 2 * 36e5);
    const q = todaysQueue([
      apt({ status: 'booked', scheduledFor: later.toISOString() }),
      apt({ status: 'booked', scheduledFor: base.toISOString() }),
    ]);
    // No urgency score: who is seen first is a clinical judgement.
    expect(q[0].scheduledFor).toBe(base.toISOString());
  });
});

describe('patient summaries stay inside this hospital', () => {
  it('groups a patient by their appointments and counts outcomes', () => {
    const rows = [
      apt({ patientId: 'pa', status: 'completed', scheduledFor: '2026-01-01T09:00:00.000Z' }),
      apt({ patientId: 'pa', status: 'booked', scheduledFor: '2026-02-01T09:00:00.000Z' }),
      apt({ patientId: 'pb', status: 'requested', scheduledFor: '2026-03-01T09:00:00.000Z' }),
    ];
    const s = summarisePatients(rows);
    expect(s).toHaveLength(2);
    const pa = s.find((x) => x.patientId === 'pa')!;
    expect(pa.appointments).toHaveLength(2);
    expect(pa.completed).toBe(1);
    expect(pa.upcoming).toBe(1);
    expect(pa.first < pa.last).toBe(true);
  });

  it('carries only appointment fields — no record from elsewhere', () => {
    const s = summarisePatients([apt({ patientId: 'pa' })])[0];
    expect(Object.keys(s).sort()).toEqual(
      ['appointments', 'completed', 'first', 'last', 'patientId', 'upcoming'].sort(),
    );
  });
});

describe('review stats average only what is published', () => {
  const review = (over: Partial<HospitalReview> = {}): HospitalReview => ({
    id: `r-${Math.random().toString(36).slice(2, 8)}`,
    hospitalId: 'h1', authorHandle: 'Verified patient', authorId: 'u1',
    appointmentId: 'a1',
    ratings: { overall: 4, waiting: 3, staff: 5, appointment: 4, facility: 4 },
    comment: null, createdAt: new Date().toISOString(),
    status: 'published', verifiedVisit: true, helpfulCount: 0,
    ...over,
  } as HospitalReview);

  it('ignores unpublished reviews', () => {
    const s = summariseReviews([review(), review({ status: 'removed' as never })]);
    expect(s.count).toBe(1);
  });

  it('reports each dimension separately and never a combined score', () => {
    const s = summariseReviews([review(), review()]);
    expect(s.overall).toBe(4);
    expect(s.waiting).toBe(3);
    // There must be no single composite: waiting time and staff manner are
    // experience measures, and fusing them reads as a verdict on care.
    expect(Object.keys(s).sort()).toEqual(
      ['appointment', 'count', 'facility', 'overall', 'staff', 'waiting'].sort(),
    );
  });
});
