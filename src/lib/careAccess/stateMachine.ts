import type {
  CareAccessAction,
  CareAccessActor,
  CareAccessState,
  CareAccessTransitionInput,
} from './types';

interface Rule {
  from: CareAccessState[];
  to: CareAccessState;
  by: CareAccessActor[];
  requiresReason?: boolean;
  requiresOption?: boolean;
  instantOnly?: boolean;
}

const RULES: Record<CareAccessAction, Rule> = {
  screen: { from: ['REQUESTED'], to: 'SCREENED', by: ['system'] },
  offer_options: { from: ['SCREENED'], to: 'OPTIONS_OFFERED', by: ['system'] },
  select_option: { from: ['OPTIONS_OFFERED', 'RECOVERY_OPTIONS_AVAILABLE'], to: 'PATIENT_SELECTED', by: ['patient'], requiresOption: true },
  submit_referral: { from: ['PATIENT_SELECTED'], to: 'REFERRAL_SUBMITTED', by: ['patient', 'system'] },
  request_approval: { from: ['PATIENT_SELECTED', 'REFERRAL_SUBMITTED'], to: 'APPROVAL_PENDING', by: ['patient', 'system'], requiresOption: true },
  approve: { from: ['APPROVAL_PENDING'], to: 'APPROVED', by: ['hospital'] },
  expire_approval: { from: ['APPROVAL_PENDING'], to: 'APPROVAL_EXPIRED', by: ['system'], requiresReason: true },
  reject: { from: ['APPROVAL_PENDING', 'ACKNOWLEDGED', 'ACCEPTED'], to: 'REJECTED', by: ['hospital'], requiresReason: true },
  acknowledge: { from: ['REFERRAL_SUBMITTED', 'APPROVAL_PENDING', 'INFO_REQUESTED'], to: 'ACKNOWLEDGED', by: ['hospital'] },
  request_info: { from: ['REFERRAL_SUBMITTED', 'ACKNOWLEDGED', 'ACCEPTED', 'APPROVAL_PENDING'], to: 'INFO_REQUESTED', by: ['hospital'], requiresReason: true },
  provide_info: { from: ['INFO_REQUESTED'], to: 'REFERRAL_SUBMITTED', by: ['patient'], requiresReason: true },
  accept: { from: ['ACKNOWLEDGED', 'REFERRAL_SUBMITTED'], to: 'ACCEPTED', by: ['hospital'] },
  redirect: { from: ['ACKNOWLEDGED', 'ACCEPTED', 'REFERRAL_SUBMITTED', 'REJECTED'], to: 'REDIRECTED', by: ['hospital'], requiresReason: true },
  offer_slot: { from: ['ACCEPTED', 'REDIRECTED', 'APPROVED', 'WAITLISTED'], to: 'SLOT_OFFERED', by: ['hospital'], requiresOption: true },
  join_waitlist: { from: ['PATIENT_SELECTED', 'RECOVERY_REQUIRED'], to: 'WAITLISTED', by: ['patient', 'system'], requiresOption: true },
  book: { from: ['PATIENT_SELECTED', 'SLOT_OFFERED', 'RESCHEDULED', 'REBOOKED'], to: 'BOOKED', by: ['patient', 'system'] },
  remind: { from: ['BOOKED'], to: 'REMINDER', by: ['system'] },
  request_reschedule: { from: ['BOOKED', 'REMINDER'], to: 'RESCHEDULE_REQUESTED', by: ['patient'], requiresReason: true },
  reschedule: { from: ['RESCHEDULE_REQUESTED', 'BOOKED', 'REMINDER'], to: 'RESCHEDULED', by: ['hospital', 'patient'], requiresReason: true },
  cancel: {
    from: ['REQUESTED', 'SCREENED', 'OPTIONS_OFFERED', 'PATIENT_SELECTED', 'REFERRAL_SUBMITTED', 'APPROVAL_PENDING', 'APPROVAL_EXPIRED', 'APPROVED', 'REJECTED', 'ACKNOWLEDGED', 'INFO_REQUESTED', 'ACCEPTED', 'SLOT_OFFERED', 'WAITLISTED', 'BOOKED', 'REMINDER', 'RESCHEDULED', 'RESCHEDULE_REQUESTED', 'RECOVERY_REQUIRED', 'RECOVERY_OPTIONS_AVAILABLE', 'REBOOKED'],
    to: 'CANCELLED', by: ['patient', 'hospital'], requiresReason: true,
  },
  request_recovery: { from: ['APPROVAL_EXPIRED', 'REJECTED', 'BOOKED', 'REMINDER', 'RESCHEDULED', 'NO_SHOW', 'CANCELLED'], to: 'RECOVERY_REQUIRED', by: ['hospital', 'system'], requiresReason: true },
  offer_recovery: { from: ['RECOVERY_REQUIRED'], to: 'RECOVERY_OPTIONS_AVAILABLE', by: ['hospital', 'system'] },
  select_recovery: { from: ['RECOVERY_OPTIONS_AVAILABLE'], to: 'PATIENT_SELECTED', by: ['patient'], requiresOption: true },
  rebook: { from: ['PATIENT_SELECTED'], to: 'REBOOKED', by: ['patient', 'system'], requiresOption: true },
  arrive: { from: ['BOOKED', 'REMINDER', 'RESCHEDULED'], to: 'ARRIVED', by: ['hospital'] },
  no_show: { from: ['BOOKED', 'REMINDER', 'RESCHEDULED'], to: 'NO_SHOW', by: ['hospital'], requiresReason: true },
  complete: { from: ['ARRIVED'], to: 'SERVICE_COMPLETED', by: ['hospital'] },
  open_follow_up: { from: ['SERVICE_COMPLETED'], to: 'FOLLOW_UP_OPEN', by: ['hospital', 'system'] },
  close: { from: ['SERVICE_COMPLETED', 'FOLLOW_UP_OPEN'], to: 'CLOSED', by: ['patient', 'hospital', 'system'] },
};

export class CareAccessTransitionError extends Error {
  constructor(
    public readonly code: 'UNKNOWN_ACTION' | 'WRONG_ACTOR' | 'INVALID_TRANSITION' | 'REASON_REQUIRED' | 'OPTION_REQUIRED' | 'VERSION_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'CareAccessTransitionError';
  }
}

export interface CareAccessTransitionPlan {
  action: CareAccessAction;
  from: CareAccessState;
  to: CareAccessState;
  reason: string | null;
  optionId: string | null;
  metadata: Record<string, unknown>;
}

const LABELS: Record<CareAccessState, string> = {
  REQUESTED: 'requested', SCREENED: 'screened', OPTIONS_OFFERED: 'options offered',
  PATIENT_SELECTED: 'patient selected', REFERRAL_SUBMITTED: 'referral submitted',
  APPROVAL_PENDING: 'approval pending', APPROVAL_EXPIRED: 'approval expired', APPROVED: 'approved',
  REJECTED: 'rejected', ACKNOWLEDGED: 'acknowledged', INFO_REQUESTED: 'information requested', ACCEPTED: 'accepted',
  REDIRECTED: 'redirected', SLOT_OFFERED: 'slot offered', WAITLISTED: 'waitlisted', BOOKED: 'booked',
  REMINDER: 'reminder sent', RESCHEDULED: 'rescheduled', RESCHEDULE_REQUESTED: 'reschedule requested',
  CANCELLED: 'cancelled', RECOVERY_REQUIRED: 'recovery required', RECOVERY_OPTIONS_AVAILABLE: 'recovery options available',
  REBOOKED: 'rebooked', ARRIVED: 'arrived', NO_SHOW: 'not attended', SERVICE_COMPLETED: 'service completed',
  FOLLOW_UP_OPEN: 'follow-up open', CLOSED: 'closed',
};

export function stateLabel(state: CareAccessState): string { return LABELS[state]; }

export function planCareAccessTransition(
  current: CareAccessState,
  input: CareAccessTransitionInput,
  actualVersion = 1,
): CareAccessTransitionPlan {
  const rule = RULES[input.action];
  if (!rule) throw new CareAccessTransitionError('UNKNOWN_ACTION', 'That care-journey action does not exist.');
  if (!rule.by.includes(input.actor)) throw new CareAccessTransitionError('WRONG_ACTOR', 'That action is not available to this actor.');
  if (input.expectedVersion !== undefined && input.expectedVersion !== actualVersion) throw new CareAccessTransitionError('VERSION_CONFLICT', 'This care request changed. Reload before trying again.');
  if (!rule.from.includes(current)) throw new CareAccessTransitionError('INVALID_TRANSITION', `This care request is ${stateLabel(current)}, so it cannot move to ${stateLabel(rule.to)}.`);
  const reason = input.reason?.trim() || null;
  if (rule.requiresReason && !reason) throw new CareAccessTransitionError('REASON_REQUIRED', 'A reason is required for this care-journey action.');
  const optionId = input.optionId ?? null;
  if (rule.requiresOption && !optionId) throw new CareAccessTransitionError('OPTION_REQUIRED', 'Choose a care option before continuing.');
  return { action: input.action, from: current, to: rule.to, reason, optionId, metadata: input.metadata ?? {} };
}

export function availableCareAccessActions(current: CareAccessState, actor: CareAccessActor): CareAccessAction[] {
  return (Object.keys(RULES) as CareAccessAction[]).filter((action) => RULES[action].from.includes(current) && RULES[action].by.includes(actor));
}
