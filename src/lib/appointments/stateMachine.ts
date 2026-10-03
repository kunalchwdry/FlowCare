/**
 * The appointment lifecycle, in one place.
 *
 * Every transition — patient, hospital staff, or assistant — has to come
 * through `plan()`. Nothing else is allowed to write `status`. That is the
 * whole point: the UI cannot claim a state the domain layer did not grant,
 * and a new caller cannot invent a shortcut by setting a field directly.
 *
 * `booked` is the stored name for what hospital staff and patients both call
 * **confirmed**. It predates this portal and is load-bearing across the demo
 * seed, the existing patient pages and the tests, so it is kept rather than
 * renamed; `STATUS_LABEL` is the single place the display wording lives.
 */
import type { Appointment } from '@/lib/types';

export type AppointmentStatus = Appointment['status'];

/** Who is attempting the move. Not a role name — a side of the relationship. */
export type Actor = 'patient' | 'hospital';

export const ACTIONS = [
  'accept',            // hospital: requested -> booked
  'reject',            // hospital: requested -> rejected
  'propose_reschedule',// hospital: requested|booked -> reschedule_proposed
  'accept_reschedule', // patient:  reschedule_proposed -> booked
  'decline_reschedule',// patient:  reschedule_proposed -> booked (keep original time)
  'cancel',            // either:   requested|booked|reschedule_proposed -> cancelled
  'check_in',          // hospital: booked -> checked_in
  'start',             // hospital: checked_in -> in_progress
  'complete',          // hospital: in_progress -> completed
  'no_show',           // hospital: booked|checked_in -> no_show
] as const;
export type Action = (typeof ACTIONS)[number];

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  requested: 'Requested',
  booked: 'Confirmed',
  reschedule_proposed: 'New time proposed',
  checked_in: 'Checked in',
  in_progress: 'In consultation',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Declined',
  no_show: 'Not attended',
};

/** Terminal states cannot be moved out of, by anyone. */
export const TERMINAL: AppointmentStatus[] = ['completed', 'cancelled', 'rejected', 'no_show'];

interface Rule {
  from: AppointmentStatus[];
  to: AppointmentStatus;
  by: Actor[];
  /** Permission the hospital actor must hold. Patients are scoped by ownership. */
  permission?: string;
  /** A reason is mandatory — these are the moves someone will later query. */
  requiresReason?: boolean;
  /** The move names a different slot, so capacity has to be re-checked. */
  requiresSlot?: boolean;
}

const RULES: Record<Action, Rule> = {
  accept:             { from: ['requested'], to: 'booked', by: ['hospital'], permission: 'appointments:manage' },
  reject:             { from: ['requested'], to: 'rejected', by: ['hospital'], permission: 'appointments:manage', requiresReason: true },
  /* The hospital's suggested time remains pending until the patient answers. */
  propose_reschedule: { from: ['requested', 'booked'], to: 'reschedule_proposed', by: ['hospital'], permission: 'appointments:manage', requiresSlot: true, requiresReason: true },
  accept_reschedule:  { from: ['reschedule_proposed'], to: 'booked', by: ['patient'] },
  decline_reschedule: { from: ['reschedule_proposed'], to: 'booked', by: ['patient'] },
  cancel:             { from: ['requested', 'booked', 'reschedule_proposed'], to: 'cancelled', by: ['patient', 'hospital'], permission: 'appointments:manage', requiresReason: true },
  check_in:           { from: ['booked'], to: 'checked_in', by: ['hospital'], permission: 'queue:manage' },
  start:              { from: ['checked_in'], to: 'in_progress', by: ['hospital'], permission: 'queue:manage' },
  complete:           { from: ['in_progress'], to: 'completed', by: ['hospital'], permission: 'queue:manage' },
  no_show:            { from: ['booked', 'checked_in'], to: 'no_show', by: ['hospital'], permission: 'queue:manage', requiresReason: true },
};

export function actionLabel(a: Action): string {
  return {
    accept: 'Accept request',
    reject: 'Decline request',
    propose_reschedule: 'Move to another time',
    accept_reschedule: 'Accept new time',
    decline_reschedule: 'Decline new time',
    cancel: 'Cancel appointment',
    check_in: 'Check in',
    start: 'Start consultation',
    complete: 'Mark completed',
    no_show: 'Mark not attended',
  }[a];
}

export class TransitionError extends Error {
  constructor(public code: TransitionCode, message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

export type TransitionCode =
  | 'UNKNOWN_ACTION'
  | 'WRONG_ACTOR'
  | 'FORBIDDEN'
  | 'ILLEGAL_TRANSITION'
  | 'REASON_REQUIRED'
  | 'SLOT_REQUIRED'
  | 'VERSION_CONFLICT';

export interface TransitionRequest {
  action: Action | string;
  actor: Actor;
  /** Permissions the hospital actor holds. Ignored for patients. */
  permissions?: readonly string[];
  current: AppointmentStatus;
  /** Client's view of the row, for optimistic concurrency. */
  expectedVersion?: number;
  actualVersion: number;
  reason?: string | null;
  proposedSlotId?: string | null;
}

export interface TransitionPlan {
  action: Action;
  from: AppointmentStatus;
  to: AppointmentStatus;
  reason: string | null;
  proposedSlotId: string | null;
  /** True when the move needs a seat in a (possibly different) slot. */
  consumesCapacity: boolean;
}

/**
 * Validate a requested move and return what should happen.
 *
 * Pure: no IO, no clock, no database. That makes the rules testable on their
 * own and means the same function can guard an HTTP route, a repo method and
 * a future RPC without any of them re-deriving the policy.
 */
export function plan(req: TransitionRequest): TransitionPlan {
  const rule = RULES[req.action as Action];
  if (!rule) throw new TransitionError('UNKNOWN_ACTION', 'That action does not exist.');

  if (!rule.by.includes(req.actor)) {
    throw new TransitionError('WRONG_ACTOR', 'That action is not available to you.');
  }

  // Optimistic concurrency before anything else: if the caller is acting on a
  // stale view of the row, every other check below is reasoning about the
  // wrong state. Two staff confirming the same request is the case this stops.
  if (req.expectedVersion !== undefined && req.expectedVersion !== req.actualVersion) {
    throw new TransitionError(
      'VERSION_CONFLICT',
      'Somebody else updated this appointment. Reload and try again.',
    );
  }

  if (req.actor === 'hospital' && rule.permission) {
    const held = req.permissions ?? [];
    if (!held.includes(rule.permission)) {
      throw new TransitionError('FORBIDDEN', 'You do not have permission to do that.');
    }
  }

  if (!rule.from.includes(req.current)) {
    // Phrased for whoever is reading it, not assembled from the action name:
    // naive concatenation produced "cannot be accept rescheduleed".
    throw new TransitionError(
      'ILLEGAL_TRANSITION',
      `This appointment is ${STATUS_LABEL[req.current].toLowerCase()}, so “${actionLabel(req.action as Action).toLowerCase()}” is not available.`,
    );
  }

  const reason = (req.reason ?? '').trim();
  if (rule.requiresReason && !reason) {
    throw new TransitionError('REASON_REQUIRED', 'A reason is required for this action.');
  }
  if (rule.requiresSlot && !req.proposedSlotId) {
    throw new TransitionError('SLOT_REQUIRED', 'Choose the time you are proposing.');
  }

  return {
    action: req.action as Action,
    from: req.current,
    to: rule.to,
    reason: reason || null,
    proposedSlotId: req.proposedSlotId ?? null,
    // Accepting a proposal moves the patient onto the proposed slot; accepting
    // a request keeps the one they already hold.
    consumesCapacity: req.action === 'accept_reschedule',
  };
}

/** Actions this actor could take right now, for rendering buttons. */
export function availableActions(
  current: AppointmentStatus,
  actor: Actor,
  permissions: readonly string[] = [],
): Action[] {
  return ACTIONS.filter((a) => {
    const r = RULES[a];
    if (!r.by.includes(actor) || !r.from.includes(current)) return false;
    if (actor === 'hospital' && r.permission && !permissions.includes(r.permission)) return false;
    return true;
  });
}


/** Does this action need a reason from the person taking it? */
export function actionNeedsReason(a: Action): boolean {
  return Boolean(RULES[a].requiresReason);
}

export function actionNeedsSlot(a: Action): boolean {
  return Boolean(RULES[a].requiresSlot);
}
