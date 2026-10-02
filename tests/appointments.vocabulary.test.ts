import { describe, expect, it } from 'vitest';
import {
  fromDbStatus, toDbStatus, toDbAction, isPersistable, idempotencyKey,
  type DbStatus,
} from '@/lib/appointments/dbVocabulary';
import { ACTIONS } from '@/lib/appointments/stateMachine';

/**
 * The application and the database disagree about what things are called,
 * and that disagreement is why every live transition failed: writing
 * `booked` into a column whose CHECK permits only `confirmed` is a
 * constraint violation, not a near miss.
 *
 * The real constraint, read from the live schema:
 *   requested | confirmed | denied | cancelled | no_show | completed
 */
const DB_STATUSES: DbStatus[] = [
  'requested', 'confirmed', 'denied', 'cancelled', 'no_show', 'completed',
];

describe('status mapping matches the live CHECK constraint', () => {
  it('maps the app words onto the database words', () => {
    expect(toDbStatus('booked')).toBe('confirmed');
    expect(toDbStatus('rejected')).toBe('denied');
    expect(toDbStatus('requested')).toBe('requested');
    expect(toDbStatus('completed')).toBe('completed');
  });

  it('never produces a value the CHECK would reject', () => {
    const appStatuses = [
      'requested', 'booked', 'reschedule_proposed', 'checked_in',
      'in_progress', 'completed', 'cancelled', 'rejected', 'no_show',
    ] as const;
    for (const s of appStatuses) {
      const db = toDbStatus(s);
      if (db !== null) expect(DB_STATUSES).toContain(db);
    }
  });

  it('returns null for states this schema cannot store', () => {
    // in_progress and reschedule_proposed have no column value. Returning a
    // near-miss would silently record the wrong thing; null forces a caller
    // to decide, and the caller must then not write.
    expect(toDbStatus('in_progress')).toBeNull();
    expect(toDbStatus('reschedule_proposed')).toBeNull();
  });

  it('round-trips every database status back to an app status', () => {
    for (const db of DB_STATUSES) {
      const app = fromDbStatus(db);
      // confirmed→booked→confirmed must be stable, or a read followed by a
      // write would quietly change the stored state.
      const back = toDbStatus(app);
      expect(back).toBe(db);
    }
  });

  it('reads an unknown status as not-yet-confirmed rather than crashing', () => {
    // A patient's page must render. The safe reading of a state we do not
    // recognise is "the hospital has not confirmed this".
    expect(fromDbStatus('something_new')).toBe('requested');
  });
});

describe('action mapping', () => {
  it('maps the hospital decisions onto database actions', () => {
    expect(toDbAction('accept')).toBe('confirm');
    expect(toDbAction('reject')).toBe('deny');
    expect(toDbAction('propose_reschedule')).toBe('reschedule');
    expect(toDbAction('check_in')).toBe('check_in');
  });

  it('refuses the two actions the schema has no state for', () => {
    // There is no "proposed" status, so a patient answering a proposal
    // cannot be persisted and must not be sent to the RPC.
    expect(toDbAction('accept_reschedule')).toBeNull();
    expect(toDbAction('decline_reschedule')).toBeNull();
    expect(isPersistable('accept_reschedule')).toBe(false);
    expect(isPersistable('accept')).toBe(true);
  });

  it('only ever emits actions mutate_appointment accepts', () => {
    const allowed = ['book','confirm','deny','check_in','start','complete',
                     'cancel','no_show','reschedule'];
    for (const a of ACTIONS) {
      const db = toDbAction(a);
      if (db !== null) expect(allowed).toContain(db);
    }
  });
});

describe('idempotency keys satisfy the RPC contract', () => {
  // mutate_appointment: length 8..128 and ^[a-zA-Z0-9_-]+$ or INVALID_INPUT.
  const ok = (k: string) => /^[a-zA-Z0-9_-]{8,128}$/.test(k);

  it('produces a valid key from ordinary parts', () => {
    expect(ok(idempotencyKey(['confirm', 'abc123', 2]))).toBe(true);
  });

  it('strips characters the RPC rejects', () => {
    const k = idempotencyKey(['confirm', 'apt:with/colons and spaces', 1]);
    expect(ok(k)).toBe(true);
    expect(k).not.toMatch(/[:/ ]/);
  });

  it('pads a short key to the minimum length', () => {
    expect(ok(idempotencyKey(['a']))).toBe(true);
  });

  it('stays within the maximum length', () => {
    expect(ok(idempotencyKey([ 'x'.repeat(500) ]))).toBe(true);
  });

  it('is stable for the same intent and different across intents', () => {
    expect(idempotencyKey(['confirm', 'apt1', 1])).toBe(idempotencyKey(['confirm', 'apt1', 1]));
    expect(idempotencyKey(['confirm', 'apt1', 1])).not.toBe(idempotencyKey(['deny', 'apt1', 1]));
    // Version is part of the key, so retrying after a real change is a new
    // request rather than a replay of the old response.
    expect(idempotencyKey(['confirm', 'apt1', 1])).not.toBe(idempotencyKey(['confirm', 'apt1', 2]));
  });
});
