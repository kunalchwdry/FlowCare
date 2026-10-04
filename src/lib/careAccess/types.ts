export const CARE_ACCESS_STATES = [
  'REQUESTED', 'SCREENED', 'OPTIONS_OFFERED', 'PATIENT_SELECTED',
  'REFERRAL_SUBMITTED', 'APPROVAL_PENDING', 'APPROVAL_EXPIRED', 'APPROVED',
  'REJECTED', 'ACKNOWLEDGED', 'INFO_REQUESTED', 'ACCEPTED', 'REDIRECTED',
  'SLOT_OFFERED', 'WAITLISTED', 'BOOKED', 'REMINDER', 'RESCHEDULED',
  'RESCHEDULE_REQUESTED', 'CANCELLED', 'RECOVERY_REQUIRED',
  'RECOVERY_OPTIONS_AVAILABLE', 'REBOOKED', 'ARRIVED', 'NO_SHOW',
  'SERVICE_COMPLETED', 'FOLLOW_UP_OPEN', 'CLOSED',
] as const;

export type CareAccessState = (typeof CARE_ACCESS_STATES)[number];
export type CareAccessActor = 'patient' | 'hospital' | 'system';

export type SlotType = 'instant' | 'approval_required' | 'waitlist';
export type RecoveryPolicy = 'offer_alternatives' | 'continue_waiting' | 'manual_review' | 'stay_with_hospital';

export type CareAccessAction =
  | 'screen' | 'offer_options' | 'select_option' | 'submit_referral'
  | 'request_approval' | 'approve' | 'expire_approval' | 'reject'
  | 'acknowledge' | 'request_info' | 'provide_info' | 'accept' | 'redirect'
  | 'offer_slot' | 'join_waitlist' | 'book' | 'remind' | 'reschedule'
  | 'request_reschedule' | 'cancel' | 'arrive' | 'no_show' | 'complete'
  | 'open_follow_up' | 'request_recovery' | 'offer_recovery'
  | 'select_recovery' | 'rebook' | 'close';

export interface CareAccessRequest {
  id: string;
  patientId: string;
  /** Copied only from the authenticated user's contact record; never public. */
  patientPhone?: string | null;
  specialty: string | null;
  serviceType: string;
  location: string | null;
  preferredStartDate: string | null;
  preferredEndDate: string | null;
  preferredTimeRange: string | null;
  budgetConstraint: string | null;
  accessibilityRequirements: string[];
  languagePreference: string[];
  coverage: string | null;
  referralRequired: boolean | null;
  state: CareAccessState;
  slotType?: SlotType | null;
  queueId?: string | null;
  queuePosition?: number | null;
  approvalDeadline?: string | null;
  approvalResponseWindowMinutes?: number | null;
  recoveryPolicy?: RecoveryPolicy | null;
  selectedHospitalId: string | null;
  selectedOptionId: string | null;
  appointmentId: string | null;
  episodeId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export type CareOptionStatus = 'offered' | 'selected' | 'expired' | 'declined';

export interface CareAccessOption {
  id: string;
  careRequestId: string;
  hospitalId: string;
  hospitalName: string;
  departmentId: string | null;
  departmentName: string | null;
  providerId?: string | null;
  providerName?: string | null;
  serviceSlug?: string | null;
  sessionId: string | null;
  slotType?: SlotType | null;
  approvalRequired?: boolean;
  waitlistEnabled?: boolean;
  approvalDeadline?: string | null;
  slotLabel: string | null;
  distanceKm: number | null;
  queueWaitMinutes: number | null;
  queueObservedAt: string | null;
  costBand: string | null;
  costVerifiedAt: string | null;
  accessibility: string[];
  languages: string[];
  capabilityMatched: boolean;
  eligible: boolean;
  freshness: 'fresh' | 'ageing' | 'stale' | 'unavailable' | 'simulated';
  freshnessLabel: string;
  reasons: string[];
  status: CareOptionStatus;
  offeredAt: string;
  expiresAt: string | null;
  selectedAt: string | null;
}

export type CareAccessHistoryAction = CareAccessAction | 'create';

export interface CareStateTransition {
  id: string;
  careRequestId: string;
  previousState: CareAccessState | null;
  newState: CareAccessState;
  action: CareAccessHistoryAction;
  actorId: string | null;
  actorRole: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CareEpisode {
  id: string;
  careRequestId: string;
  patientId: string;
  hospitalId: string | null;
  appointmentId: string | null;
  followUpRequired: boolean;
  followUpCompleted: boolean;
  createdAt: string;
  closedAt: string | null;
}

export type CareTaskOwner = 'patient' | 'hospital' | 'system';
export type CareTaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';

export interface CareTask {
  id: string;
  careRequestId: string;
  episodeId: string | null;
  patientId: string;
  hospitalId: string | null;
  ownerType: CareTaskOwner;
  ownerId: string | null;
  taskType: 'missing_document' | 'transport' | 'language' | 'accessibility' | 'referral_information' | 'coverage' | 'appointment' | 'follow_up' | 'other';
  title: string;
  description: string | null;
  status: CareTaskStatus;
  deadline: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CapacitySignal {
  id: string;
  hospitalId: string;
  serviceSlug: string | null;
  available: boolean | null;
  queueWaitMinutes: number | null;
  waitingCount: number | null;
  note: string | null;
  source: 'hospital_published' | 'flowcare_verified' | 'demo_simulated';
  updatedAt: string;
  expiresAt: string | null;
}

export interface CareAccessMetrics {
  total: number;
  closed: number;
  closureRate: number | null;
  averageAcknowledgementMinutes: number | null;
  averageBookingMinutes: number | null;
  unresolved: number;
  staleCapacitySignals: number;
  cancellations: number;
  noShows: number;
  followUpsOpen: number;
  pendingApprovals?: number;
  approvalExpired?: number;
  waitlisted?: number;
  recoveryRequired?: number;
}

export interface QueueEntry {
  id: string;
  queueId: string;
  careRequestId: string | null;
  appointmentId: string | null;
  patientId: string;
  hospitalId: string;
  departmentId: string;
  providerId?: string | null;
  slotId: string | null;
  queueType: 'approval' | 'waitlist' | 'appointment' | 'recovery';
  status: 'waiting' | 'approval_pending' | 'approved' | 'booked' | 'expired' | 'cancelled' | 'rebooked' | 'completed';
  position: number | null;
  estimatedSlotAt: string | null;
  lastUpdatedAt: string;
  createdAt: string;
}

export interface RecoveryEvent {
  id: string;
  careRequestId: string;
  appointmentId: string | null;
  reason: 'hospital_no_response' | 'slot_expired' | 'appointment_cancelled' | 'capacity_changed' | 'provider_unavailable' | 'appointment_rejected' | 'patient_reschedule';
  previousState: CareAccessState;
  detectedAt: string;
  selectedOptionId: string | null;
  resolvedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface NewCareAccessRequest {
  patientId: string;
  specialty?: string | null;
  serviceType: string;
  location?: string | null;
  preferredStartDate?: string | null;
  preferredEndDate?: string | null;
  preferredTimeRange?: string | null;
  budgetConstraint?: string | null;
  accessibilityRequirements?: string[];
  languagePreference?: string[];
  coverage?: string | null;
  referralRequired?: boolean | null;
}

export interface CareAccessTransitionInput {
  careRequestId: string;
  action: CareAccessAction;
  actorId: string;
  actorRole: string;
  actor: CareAccessActor;
  expectedVersion?: number;
  reason?: string | null;
  optionId?: string | null;
  appointmentId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NewCareTask {
  careRequestId: string;
  episodeId?: string | null;
  patientId: string;
  hospitalId?: string | null;
  ownerType: CareTaskOwner;
  ownerId?: string | null;
  taskType: CareTask['taskType'];
  title: string;
  description?: string | null;
  deadline?: string | null;
}
