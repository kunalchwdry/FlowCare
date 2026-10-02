/**
 * Translation between the application's words and the database's.
 *
 * These drifted apart before either was written down. The live schema has
 * been in place since before this repository existed:
 *
 *   appointments.status CHECK
 *     requested | confirmed | denied | cancelled | no_show | completed
 *
 *   private.mutate_appointment action
 *     book | confirm | deny | check_in | start | complete | cancel
 *     | no_show | reschedule
 *
 * The TypeScript layer says `booked` where the database says `confirmed`,
 * and `rejected` where it says `denied`. Writing the app's words straight
 * into the column fails the CHECK constraint, which is why every live
 * transition would have errored.
 *
 * Renaming the app side would touch the seed, the patient pages, the state
 * machine and ~350 tests. Renaming the database side would mean a migration
 * against a schema other things already depend on. So the mapping lives
 * here, in one place, and every crossing of that boundary goes through it.
 *
 * Two app states have NO database equivalent: `in_progress` and
 * `reschedule_proposed`. The CHECK does not permit them, so they cannot be
 * persisted and `toDbStatus` returns null rather than guessing a near-miss.
 * A caller that gets null must not write.
 */
import type { Appointment } from '@/lib/types';
import type { Action } from '@/lib/appointments/stateMachine';

export type DbStatus =
  | 'requested' | 'confirmed' | 'denied' | 'cancelled' | 'no_show' | 'completed';

export type DbAction =
  | 'book' | 'confirm' | 'deny' | 'check_in' | 'start' | 'complete'
  | 'cancel' | 'no_show' | 'reschedule';

type AppStatus = Appointment['status'];

const APP_TO_DB: Partial<Record<AppStatus, DbStatus>> = {
  requested: 'requested',
  booked: 'confirmed',
  rejected: 'denied',
  cancelled: 'cancelled',
  no_show: 'no_show',
  completed: 'completed',
  // checked_in has no column value of its own in this schema — the row
  // stays 'confirmed' and the check-in is recorded as an event.
  checked_in: 'confirmed',
};

const DB_TO_APP: Record<DbStatus, AppStatus> = {
  requested: 'requested',
  confirmed: 'booked',
  denied: 'rejected',
  cancelled: 'cancelled',
  no_show: 'no_show',
  completed: 'completed',
};

const ACTION_TO_DB: Partial<Record<Action, DbAction>> = {
  accept: 'confirm',
  reject: 'deny',
  cancel: 'cancel',
  check_in: 'check_in',
  start: 'start',
  complete: 'complete',
  no_show: 'no_show',
  propose_reschedule: 'reschedule',
  // accept_reschedule / decline_reschedule have no database action: the
  // schema has no "proposed" state for a patient to answer. They are
  // app-level only and must not be sent.
};

/** null when the state cannot be represented in this schema. */
export function toDbStatus(status: AppStatus): DbStatus | null {
  return APP_TO_DB[status] ?? null;
}

export function fromDbStatus(status: string): AppStatus {
  // An unrecognised value is surfaced as 'requested' rather than crashing a
  // patient's appointments page, because the safe reading of an unknown
  // state is "not yet confirmed".
  return DB_TO_APP[status as DbStatus] ?? 'requested';
}

/** null when the action has no database equivalent and must stay app-side. */
export function toDbAction(action: Action): DbAction | null {
  return ACTION_TO_DB[action] ?? null;
}

/** Does this action change state the database can actually store? */
export function isPersistable(action: Action): boolean {
  return toDbAction(action) !== null;
}

/**
 * Idempotency key for mutate_appointment.
 *
 * The RPC requires 8–128 characters of [A-Za-z0-9_-] and rejects a replay
 * whose payload differs, so the key has to be stable for a given intent and
 * distinct across different ones.
 */
export function idempotencyKey(parts: (string | number | null | undefined)[]): string {
  const raw = parts.filter((p) => p !== null && p !== undefined).join('-');
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  return safe.length >= 8 ? safe : `${safe}${'0'.repeat(8 - safe.length)}`;
}
