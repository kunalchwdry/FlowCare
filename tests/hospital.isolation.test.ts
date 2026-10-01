import { beforeAll, describe, expect, it } from 'vitest';
import { demoRepo } from '@/lib/data/demoRepo';
import { SEED } from '@/lib/data/seed';

/**
 * Cross-hospital and cross-patient isolation at the repository boundary.
 *
 * These exercise the layer that actually performs the write, not the HTTP
 * route, so they still hold if a new caller is added later. The rule under
 * test is that a scoped write refuses with NOT_FOUND — never FORBIDDEN —
 * because confirming a row exists is enough to enumerate another hospital's
 * appointments one id at a time.
 */

const HOSPITAL_A = SEED.hospitals[0].id;
const HOSPITAL_B = SEED.hospitals.find((h) => h.id !== HOSPITAL_A)!.id;

let aptId: string;
let patientId: string;

beforeAll(async () => {
  const session = SEED.sessions.find((s) => s.hospitalId === HOSPITAL_A && s.status === 'open');
  if (!session) throw new Error('fixture: no open session at hospital A');
  patientId = 'demo-patient-0001';
  const apt = await demoRepo.requestAppointment({
    sessionId: session.id,
    patientId,
    reason: 'isolation fixture',
  });
  aptId = apt.id;
});

const staffOf = (hospitalId: string) => ({
  actor: 'hospital' as const,
  actorId: `staff-of-${hospitalId}`,
  actorRole: 'staff',
  permissions: ['appointments:manage', 'queue:manage'],
  hospitalId,
});

describe('a hospital cannot reach another hospital’s appointments', () => {
  it('refuses a transition scoped to the wrong hospital', async () => {
    await expect(
      demoRepo.transitionAppointment({ appointmentId: aptId, action: 'accept', ...staffOf(HOSPITAL_B) }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('reports it as NOT_FOUND, never FORBIDDEN', async () => {
    // A 403 here would confirm the id is real. That difference is the whole
    // attack: iterate ids, keep the ones that come back 403.
    let message = '';
    try {
      await demoRepo.transitionAppointment({ appointmentId: aptId, action: 'reject', reason: 'x', ...staffOf(HOSPITAL_B) });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe('NOT_FOUND');
    expect(message).not.toBe('FORBIDDEN');
  });

  it('leaves the appointment untouched after a refused attempt', async () => {
    const after = await demoRepo.getAppointment(aptId);
    expect(after?.status).toBe('requested');
    expect(after?.hospitalId).toBe(HOSPITAL_A);
  });

  it('allows the owning hospital through', async () => {
    const moved = await demoRepo.transitionAppointment({
      appointmentId: aptId, action: 'accept', ...staffOf(HOSPITAL_A),
    });
    expect(moved.status).toBe('booked');
    expect(moved.version).toBeGreaterThan(1);
  });
});

describe('a patient cannot reach another patient’s appointment', () => {
  it('refuses a cancel by somebody else', async () => {
    await expect(
      demoRepo.transitionAppointment({
        appointmentId: aptId,
        action: 'cancel',
        actor: 'patient',
        actorId: 'demo-patient-0002',
        actorRole: 'patient',
        reason: 'not mine',
      }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('allows the owner to cancel their own', async () => {
    const cancelled = await demoRepo.transitionAppointment({
      appointmentId: aptId,
      action: 'cancel',
      actor: 'patient',
      actorId: patientId,
      actorRole: 'patient',
      reason: 'Cannot make it',
    });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.decisionReason).toBe('Cannot make it');
  });
});

describe('every transition leaves an audit trail', () => {
  it('records each move with its actor side and reason', async () => {
    const events = await demoRepo.listAppointmentEvents(aptId);
    expect(events.length).toBeGreaterThanOrEqual(2);

    const accept = events.find((e) => e.action === 'accept');
    expect(accept?.fromStatus).toBe('requested');
    expect(accept?.toStatus).toBe('booked');
    expect(accept?.actorSide).toBe('hospital');

    const cancel = events.find((e) => e.action === 'cancel');
    expect(cancel?.actorSide).toBe('patient');
    expect(cancel?.reason).toBe('Cannot make it');

    // Ordered oldest-first so it can be rendered as a timeline directly.
    const times = events.map((e) => e.createdAt);
    expect([...times].sort()).toEqual(times);
  });

  it('notifies the patient when the hospital decides', async () => {
    const notes = await demoRepo.listNotifications('patient', patientId);
    expect(notes.some((n) => n.kind === 'accept')).toBe(true);
    // In-app only: nothing here may claim an email or SMS was sent.
    expect(JSON.stringify(notes)).not.toMatch(/emailed|SMS|text message/i);
  });
});
