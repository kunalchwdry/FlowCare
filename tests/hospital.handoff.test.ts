import { beforeEach, describe, expect, it } from 'vitest';
import { demoRepo } from '@/lib/data/demoRepo';
import { SEED } from '@/lib/data/seed';

/**
 * The patient → hospital → patient handoff, at the layer that persists it.
 *
 * The milestone in §20: a request is made, the hospital decides, and the
 * patient sees that decision. These assert the decision actually survives a
 * re-read rather than living in a component's state.
 *
 * Each case takes its own session so the suites do not collide —
 * requestAppointment is idempotent per (session, patient), so sharing one
 * hands two tests the same row.
 */
const HOSPITAL = 'baner-ridge-multispecialty';
const open = SEED.sessions.filter((s) => s.hospitalId === HOSPITAL && s.status === 'open');

const staff = (hospitalId = HOSPITAL, permissions = ['appointments:manage', 'queue:manage']) => ({
  actor: 'hospital' as const,
  actorId: 'staff-handoff',
  actorRole: 'admin',
  permissions,
  hospitalId,
});

let seq = 0;
/**
 * A genuinely unique (session, patient) pair per call.
 *
 * requestAppointment is idempotent on that pair, so a counter alone is not
 * enough once the demo store persists between runs — a repeat hands back
 * the row a previous run already transitioned, and the test then fails on
 * an illegal transition that has nothing to do with the behaviour it
 * meant to exercise.
 */
function pair() {
  const session = open[seq % open.length];
  if (!session) throw new Error('fixture: no open sessions');
  const patientId = `handoff-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
  seq += 1;
  return { sessionId: session.id, patientId };
}

async function request() {
  const { sessionId, patientId } = pair();
  const apt = await demoRepo.requestAppointment({ sessionId, patientId, reason: 'handoff test' });
  return { apt, patientId };
}

beforeEach(() => { /* ids are unique per call, so no reset is needed */ });

describe('a request is not a booking', () => {
  it('starts as requested, never confirmed', async () => {
    const { apt } = await request();
    expect(apt.status).toBe('requested');
    expect(apt.confirmedAt ?? null).toBeNull();
  });
});

describe('the hospital confirms and the patient sees it', () => {
  it('moves requested -> booked and the patient re-read shows it', async () => {
    const { apt, patientId } = await request();

    await demoRepo.transitionAppointment({
      appointmentId: apt.id, action: 'accept', ...staff(),
    });

    // The patient's own query, not the hospital's response object.
    const mine = await demoRepo.listAppointments({ patientId });
    const seen = mine.find((a) => a.id === apt.id);
    expect(seen?.status).toBe('booked');
    expect(seen?.confirmedAt).toBeTruthy();
  });

  it('records who decided, as hospital staff', async () => {
    const { apt } = await request();
    await demoRepo.transitionAppointment({ appointmentId: apt.id, action: 'accept', ...staff() });

    const events = await demoRepo.listAppointmentEvents(apt.id);
    const accept = events.find((e) => e.action === 'accept');
    expect(accept?.actorSide).toBe('hospital');
    expect(accept?.fromStatus).toBe('requested');
    expect(accept?.toStatus).toBe('booked');
  });
});

describe('the hospital declines and the patient sees why', () => {
  it('moves requested -> rejected and keeps the reason for the patient', async () => {
    const { apt, patientId } = await request();

    await demoRepo.transitionAppointment({
      appointmentId: apt.id, action: 'reject', reason: 'Consultant on leave', ...staff(),
    });

    const mine = await demoRepo.listAppointments({ patientId });
    const seen = mine.find((a) => a.id === apt.id);
    expect(seen?.status).toBe('rejected');
    expect(seen?.decisionReason).toBe('Consultant on leave');
  });

  it('refuses to decline without a reason', async () => {
    const { apt } = await request();
    await expect(
      demoRepo.transitionAppointment({ appointmentId: apt.id, action: 'reject', reason: '  ', ...staff() }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'REASON_REQUIRED' }));

    const still = await demoRepo.getAppointment(apt.id);
    expect(still?.status).toBe('requested');
  });
});

describe('the decision cannot be faked or forced', () => {
  it('rejects a second decision on a stale version', async () => {
    const { apt } = await request();
    await demoRepo.transitionAppointment({
      appointmentId: apt.id, action: 'accept', expectedVersion: apt.version ?? 1, ...staff(),
    });
    await expect(
      demoRepo.transitionAppointment({
        appointmentId: apt.id, action: 'accept', expectedVersion: apt.version ?? 1, ...staff(),
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'VERSION_CONFLICT' }));
  });

  it('refuses staff who only hold read permissions', async () => {
    const { apt } = await request();
    await expect(
      demoRepo.transitionAppointment({
        appointmentId: apt.id, action: 'accept',
        ...staff(HOSPITAL, ['appointments:read', 'queue:read']),
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('refuses a patient attempting the hospital action on their own request', async () => {
    const { apt, patientId } = await request();
    await expect(
      demoRepo.transitionAppointment({
        appointmentId: apt.id, action: 'accept',
        actor: 'patient', actorId: patientId, actorRole: 'patient',
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'WRONG_ACTOR' }));
  });
});

describe('the operational path continues after confirmation', () => {
  it('walks booked -> checked_in -> in_progress -> completed', async () => {
    const { apt, patientId } = await request();
    await demoRepo.transitionAppointment({ appointmentId: apt.id, action: 'accept', ...staff() });
    for (const action of ['check_in', 'start', 'complete']) {
      await demoRepo.transitionAppointment({ appointmentId: apt.id, action, ...staff() });
    }
    const mine = await demoRepo.listAppointments({ patientId });
    const done = mine.find((a) => a.id === apt.id);
    expect(done?.status).toBe('completed');
    expect(done?.completedAt).toBeTruthy();

    // Four hospital decisions, each one its own audit row.
    const events = await demoRepo.listAppointmentEvents(apt.id);
    expect(events.map((e) => e.action)).toEqual(['accept', 'check_in', 'start', 'complete']);
  });
});
