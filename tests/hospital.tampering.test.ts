import { beforeAll, describe, expect, it } from 'vitest';
import { demoRepo } from '@/lib/data/demoRepo';
import { SEED } from '@/lib/data/seed';
import { plan, TransitionError } from '@/lib/appointments/stateMachine';

/**
 * The browser is not trusted to say which hospital it belongs to.
 *
 * The hospital id used for every scoped write comes from the caller's own
 * membership, server-side. These tests attack that from the three places a
 * client can actually reach: the URL, the request body, and the permission
 * list. None of them is an input to the decision.
 */

const A = SEED.hospitals[0].id;
const B = SEED.hospitals.find((h) => h.id !== A)!.id;

let aptAtA: string;
/*
 * A different patient from hospital.isolation.test.ts on purpose.
 * requestAppointment is idempotent per (session, patient), so sharing one
 * would hand both suites the SAME appointment row through the shared
 * .data store — and whichever ran first would transition it out from under
 * the other.
 */
const PATIENT = 'demo-patient-0002';

beforeAll(async () => {
  const open = SEED.sessions.filter((x) => x.hospitalId === A && x.status === 'open');
  const s = open[1] ?? open[0];
  if (!s) throw new Error('fixture: no open session at hospital A');
  aptAtA = (await demoRepo.requestAppointment({
    sessionId: s.id, patientId: PATIENT, reason: 'tampering fixture',
  })).id;
});

const staff = (hospitalId: string, permissions = ['appointments:manage', 'queue:manage']) => ({
  actor: 'hospital' as const,
  actorId: `staff-${hospitalId}`,
  actorRole: 'staff',
  permissions,
  hospitalId,
});

describe('hospital id cannot be supplied by the client', () => {
  it('ignores a forged hospital in the write scope (the "body tampering" case)', async () => {
    // The route always passes actor.hospitalId. Simulating a caller that
    // managed to inject hospital B instead: the repository still refuses,
    // so even a routing mistake upstream cannot leak across hospitals.
    await expect(
      demoRepo.transitionAppointment({ appointmentId: aptAtA, action: 'accept', ...staff(B) }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('refuses a cross-hospital id regardless of permissions held', async () => {
    // Holding every permission at your own hospital grants nothing at
    // another one. Permission and scope are independent checks.
    await expect(
      demoRepo.transitionAppointment({
        appointmentId: aptAtA,
        action: 'accept',
        ...staff(B, [
          'appointments:read', 'appointments:manage', 'queue:read', 'queue:manage',
          'memberships:manage', 'reviews:moderate', 'facts:manage', 'corrections:review',
        ]),
      }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('answers NOT_FOUND for a hospital that does not exist either', async () => {
    // A real-but-foreign id and a nonsense id must be indistinguishable,
    // otherwise the difference enumerates which hospitals exist.
    await expect(
      demoRepo.transitionAppointment({ appointmentId: aptAtA, action: 'accept', ...staff('no-such-hospital') }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('leaves the appointment untouched after every refused attempt', async () => {
    const after = await demoRepo.getAppointment(aptAtA);
    expect(after?.status).toBe('requested');
    expect(after?.version ?? 1).toBe(1);
  });
});

describe('staff standing has to be current', () => {
  it('grants nothing to a member of staff holding no permissions', () => {
    // A revoked membership resolves to an empty permission array, which
    // must fail the same way as never having had access.
    expect(() =>
      plan({
        action: 'accept', actor: 'hospital', permissions: [],
        current: 'requested', actualVersion: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('refuses read-only staff a management action', () => {
    expect(() =>
      plan({
        action: 'reject', actor: 'hospital', permissions: ['appointments:read', 'queue:read'],
        current: 'requested', actualVersion: 1, reason: 'no',
      }),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('refuses a patient the hospital actions whatever they claim to hold', () => {
    // Permissions are ignored entirely for a patient actor — there is no
    // array a client could send that turns them into staff.
    let code = '';
    try {
      plan({
        action: 'accept', actor: 'patient',
        permissions: ['appointments:manage', 'memberships:manage'],
        current: 'requested', actualVersion: 1,
      });
    } catch (e) { code = (e as TransitionError).code; }
    expect(code).toBe('WRONG_ACTOR');
  });
});

describe('the owning hospital still works', () => {
  it('accepts, and only then is the patient shown a confirmation', async () => {
    const before = await demoRepo.getAppointment(aptAtA);
    expect(before?.status).toBe('requested');

    const moved = await demoRepo.transitionAppointment({
      appointmentId: aptAtA, action: 'accept', ...staff(A),
    });
    expect(moved.status).toBe('booked');
    expect(moved.confirmedAt).toBeTruthy();

    const events = await demoRepo.listAppointmentEvents(aptAtA);
    expect(events.at(-1)?.actorSide).toBe('hospital');
  });
});
