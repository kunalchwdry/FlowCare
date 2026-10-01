import { describe, expect, it } from 'vitest';
import {
  availableActions,
  plan,
  TransitionError,
  type AppointmentStatus,
} from '@/lib/appointments/stateMachine';

const MANAGE = ['appointments:manage', 'queue:manage'] as const;

function attempt(over: Partial<Parameters<typeof plan>[0]> = {}) {
  return plan({
    action: 'accept',
    actor: 'hospital',
    permissions: MANAGE,
    current: 'requested',
    actualVersion: 1,
    ...over,
  });
}

describe('appointment state machine', () => {
  it('confirms a pending request', () => {
    const p = attempt();
    expect(p.from).toBe('requested');
    expect(p.to).toBe('booked');
  });

  it('refuses to confirm something that is already confirmed', () => {
    expect(() => attempt({ current: 'booked' })).toThrowError(
      expect.objectContaining({ code: 'ILLEGAL_TRANSITION' }),
    );
  });

  it('never lets a patient confirm their own request', () => {
    // The entire request/confirm split exists for this. If a patient could
    // accept, the UI would be claiming a confirmation the hospital never gave.
    expect(() => attempt({ actor: 'patient', permissions: [] })).toThrowError(
      expect.objectContaining({ code: 'WRONG_ACTOR' }),
    );
  });

  it('requires appointments:manage, not merely being staff', () => {
    expect(() => attempt({ permissions: ['appointments:read', 'queue:read'] })).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('demands a reason for a decline', () => {
    expect(() => attempt({ action: 'reject', reason: '   ' })).toThrowError(
      expect.objectContaining({ code: 'REASON_REQUIRED' }),
    );
    expect(attempt({ action: 'reject', reason: 'Consultant on leave' }).to).toBe('rejected');
  });

  it('demands a target slot when proposing a new time', () => {
    expect(() =>
      attempt({ action: 'propose_reschedule', reason: 'Clinic overbooked' }),
    ).toThrowError(expect.objectContaining({ code: 'SLOT_REQUIRED' }));
  });

  it('rejects a stale write rather than silently clobbering', () => {
    // Two staff open the same request; the second one to click must lose.
    expect(() => attempt({ expectedVersion: 1, actualVersion: 4 })).toThrowError(
      expect.objectContaining({ code: 'VERSION_CONFLICT' }),
    );
  });

  it('checks the version before anything else', () => {
    // A stale caller reasoning about the wrong row should be told that, not
    // given a misleading complaint about the transition being illegal.
    let code = '';
    try {
      attempt({ current: 'completed', expectedVersion: 1, actualVersion: 9 });
    } catch (e) {
      code = (e as TransitionError).code;
    }
    expect(code).toBe('VERSION_CONFLICT');
  });

  const terminals: AppointmentStatus[] = ['completed', 'cancelled', 'rejected', 'no_show'];
  it.each(terminals)('allows nothing out of %s', (status) => {
    expect(availableActions(status, 'hospital', [...MANAGE])).toEqual([]);
    expect(availableActions(status, 'patient')).toEqual([]);
  });

  it('walks the full operational path', () => {
    const chain: [AppointmentStatus, string, AppointmentStatus][] = [
      ['requested', 'accept', 'booked'],
      ['booked', 'check_in', 'checked_in'],
      ['checked_in', 'start', 'in_progress'],
      ['in_progress', 'complete', 'completed'],
    ];
    for (const [from, action, to] of chain) {
      expect(attempt({ current: from, action }).to).toBe(to);
    }
  });

  it('lets the patient answer a proposal, but only a proposal', () => {
    expect(
      plan({ action: 'accept_reschedule', actor: 'patient', current: 'reschedule_proposed', actualVersion: 1 }).to,
    ).toBe('booked');
    expect(() =>
      plan({ action: 'accept_reschedule', actor: 'patient', current: 'requested', actualVersion: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'ILLEGAL_TRANSITION' }));
  });

  it('only moves the booking onto a new slot when a proposal is accepted', () => {
    expect(
      plan({ action: 'accept_reschedule', actor: 'patient', current: 'reschedule_proposed', actualVersion: 1 })
        .consumesCapacity,
    ).toBe(true);
    expect(attempt().consumesCapacity).toBe(false);
  });

  it('does not invent actions', () => {
    expect(() => attempt({ action: 'delete' })).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_ACTION' }),
    );
  });

  it('offers reception no queue actions without queue:manage', () => {
    expect(availableActions('booked', 'hospital', ['appointments:manage'])).not.toContain('check_in');
    expect(availableActions('booked', 'hospital', ['queue:manage'])).toContain('check_in');
  });
});
