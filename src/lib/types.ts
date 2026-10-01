/** Shared domain types for the FlowCare discovery layer. */

export type HospitalType =
  | 'multispecialty'
  | 'specialty'
  | 'clinic'
  | 'government'
  | 'trust'
  | 'teaching';

export type AvailabilityState =
  | 'available'
  | 'limited'
  | 'none'
  | 'unknown';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface HospitalDepartment {
  id: string;
  hospitalId: string;
  /** Canonical specialty slug, e.g. "cardiology". */
  specialty: string;
  name: string;
  active: boolean;
}

export interface HospitalService {
  id: string;
  hospitalId: string;
  slug: string;
  name: string;
}

/**
 * Availability derived ONLY from authoritative FlowCare session/appointment
 * data. Never inferred from opening hours or from Google data.
 */
export interface HospitalAvailability {
  hospitalId: string;
  state: AvailabilityState;
  /** Open slots in the lookahead window, null when state === 'unknown'. */
  openSlots: number | null;
  /** ISO date of the earliest bookable session, null if none. */
  nextAvailableDate: string | null;
  /** Per-specialty open slot counts within the lookahead window. */
  bySpecialty: Record<string, number>;
  /** When this snapshot was computed. Displayed to the user. */
  computedAt: string;
  /** Lookahead horizon used, in days. */
  windowDays: number;
}

/** Queue info, only where the hospital legitimately publishes it. */
export interface QueueSnapshot {
  hospitalId: string;
  published: boolean;
  waitingCount: number | null;
  medianWaitMinutes: number | null;
  observedAt: string | null;
}

export interface FlowCareRatingBreakdown {
  overall: number;
  waiting: number;
  staff: number;
  appointment: number;
  facility: number;
}

export type ReviewModerationStatus =
  | 'published'
  | 'pending'
  | 'flagged'
  | 'hidden'
  | 'removed';

export interface HospitalReview {
  id: string;
  hospitalId: string;
  /** Opaque public handle, e.g. "Verified patient · A.S." — never a full identity. */
  authorHandle: string;
  authorId: string;
  appointmentId: string;
  ratings: FlowCareRatingBreakdown;
  comment: string | null;
  createdAt: string;
  status: ReviewModerationStatus;
  verifiedVisit: true;
  helpfulCount: number;
}

/** Output of the documented aggregation in lib/discovery/rating.ts. */
export interface FlowCareRatingSummary {
  hospitalId: string;
  /** null when below the publication threshold. */
  score: number | null;
  reviewCount: number;
  /** Simple arithmetic mean, exposed for transparency next to `score`. */
  rawMean: number | null;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  dimensionMeans: FlowCareRatingBreakdown | null;
  /** 95% credible-interval-style bounds from the shrinkage model. */
  confidenceLow: number | null;
  confidenceHigh: number | null;
  /** Human-readable reason shown when score is null. */
  insufficientReason: string | null;
  methodVersion: string;
}

/** External (Google) data. Held in memory only, never persisted. See docs/security.md. */
export interface ExternalPlaceData {
  placeId: string;
  displayName?: string;
  formattedAddress?: string;
  location?: GeoPoint;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[]; openNow?: boolean };
  accessibilityOptions?: Record<string, boolean>;
  photos?: Array<{ name: string; widthPx?: number; heightPx?: number; authorAttributions?: Array<{ displayName?: string; uri?: string; photoUri?: string }> }>;
  reviews?: Array<{
    name?: string;
    rating?: number;
    text?: { text?: string };
    relativePublishTimeDescription?: string;
    authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
    flagContentUri?: string;
  }>;
  reviewSummary?: {
    text?: { text?: string };
    disclosureText?: { text?: string };
    reviewsUri?: string;
    flagContentUri?: string;
  };
  /** Timestamp of retrieval; surfaced in the UI as "fetched from Google at". */
  fetchedAt: string;
}

export interface PlaceLink {
  hospitalId: string;
  placeId: string;
  /** How the link was established - never silent name matching. */
  matchMethod: 'manual_admin' | 'verified_candidate' | 'unlinked';
  matchConfidence: number | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  /** Cached ≤30 days per Google Maps Platform Service Specific Terms §14.3. */
  cachedLat: number | null;
  cachedLng: number | null;
  cachedCoordsAt: string | null;
}

export interface Hospital {
  id: string;
  slug: string;
  name: string;
  type: HospitalType;
  /** FlowCare-verified address (our own record, not Google's). */
  addressLine: string;
  city: string;
  state: string;
  postalCode: string | null;
  location: GeoPoint;
  phone: string | null;
  website: string | null;
  /** FlowCare-operated onboarding status. */
  flowcareVerified: boolean;
  onboardedAt: string | null;
  departments: HospitalDepartment[];
  services: HospitalService[];
  accessibility: string[];
  languages: string[];
  operatingHours: Record<string, string>;
  emergencyServices: boolean;
  bedCount: number | null;
  description: string | null;
  placeLink: PlaceLink | null;
  /** Synthetic demo record flag. Rendered as a visible badge. */
  isDemoRecord: boolean;
}

/** A hospital enriched for a discovery result list. */
export interface DiscoveryResult {
  hospital: Hospital;
  distanceKm: number | null;
  availability: HospitalAvailability;
  queue: QueueSnapshot | null;
  flowcareRating: FlowCareRatingSummary;
  external: {
    linked: boolean;
    placeId: string | null;
    /** Only present when Google Places is configured AND the call succeeded. */
    data: ExternalPlaceData | null;
    status: 'not_linked' | 'not_configured' | 'ok' | 'error';
  };
  match: MatchExplanation | null;
}

export interface MatchCriterionContribution {
  criterion: string;
  label: string;
  weight: number;
  /** 0..1 score for this criterion. */
  score: number;
  /** weight * score, normalised later. */
  contribution: number;
  evidence: string;
}

export interface MatchExplanation {
  /** 0..100, only shown when `displayable` is true. */
  percent: number;
  displayable: boolean;
  criteria: MatchCriterionContribution[];
  summary: string;
  methodVersion: string;
}

export interface Favorite {
  hospitalId: string;
  userId: string;
  createdAt: string;
  note: string | null;
}

export interface RecentlyViewed {
  hospitalId: string;
  viewedAt: string;
}

export interface Appointment {
  id: string;
  hospitalId: string;
  patientId: string;
  departmentId: string;
  sessionId: string;
  scheduledFor: string;
  /**
   * 'requested' is deliberately distinct from 'booked': the patient has asked
   * for a slot, and the hospital has not accepted it yet. Nothing in the UI
   * may present a request as a confirmed appointment.
   */
  status:
    | 'requested'
    | 'booked'
    | 'reschedule_proposed'
    | 'checked_in'
    | 'in_progress'
    | 'completed'
    | 'cancelled'
    | 'rejected'
    | 'no_show';
  completedAt: string | null;
  /** Patient's own words. Administrative only — never a clinical field. */
  reason?: string | null;
  requestedAt?: string | null;

  /** Bumped on every transition. The basis of optimistic concurrency. */
  version?: number;
  /** When the hospital accepted. Null while the request is still pending. */
  confirmedAt?: string | null;
  /**
   * Why the hospital declined, cancelled, or proposed a different time.
   * Shown to the patient verbatim, so it is written for them, not for staff.
   */
  decisionReason?: string | null;
  /** Session the hospital is proposing instead, while reschedule is pending. */
  proposedSessionId?: string | null;
  proposedFor?: string | null;
}

/**
 * One entry in an appointment's audit trail.
 *
 * Generated from transitions rather than written by hand, so the timeline a
 * patient sees and the record staff rely on in a dispute are the same rows.
 */
export interface AppointmentEvent {
  id: string;
  appointmentId: string;
  /** The action name from the state machine, e.g. 'accept'. */
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actorSide: 'patient' | 'hospital' | 'system';
  /** Role only — never a staff member's name, to the patient. */
  actorRole: string;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
}

/** In-app notification. Delivery is in-app only unless a provider is configured. */
export interface Notification {
  id: string;
  /** Recipient. For hospital-side notices this is the hospital id. */
  audience: 'patient' | 'hospital';
  recipientId: string;
  kind: string;
  title: string;
  body: string;
  appointmentId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ClinicSession {
  id: string;
  hospitalId: string;
  departmentId: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  booked: number;
  status: 'open' | 'full' | 'cancelled' | 'closed';
}

export interface ReviewReport {
  id: string;
  reviewId: string;
  reporterId: string;
  reason: string;
  detail: string | null;
  createdAt: string;
  status: 'open' | 'actioned' | 'dismissed';
}

export interface ModerationEvent {
  id: string;
  reviewId: string;
  actorId: string;
  actorRole: string;
  action: 'flag' | 'hide' | 'restore' | 'remove' | 'dismiss_report' | 'ai_flag';
  reason: string;
  /** Present for AI-assisted flags. Never auto-applies a destructive action. */
  aiConfidence: number | null;
  previousStatus: ReviewModerationStatus;
  newStatus: ReviewModerationStatus;
  createdAt: string;
}

/* =========================================================================
 * Phase 3 — Journey layer (F1–F20)
 * Added 2026-09-27. See docs/research/02-feature-opportunities.md.
 * ========================================================================= */

/** Where a fact came from. `google_live` is never persisted — see places/policy.ts. */
export type SourceType =
  | 'flowcare_field_check'
  | 'hospital_confirmed'
  | 'hospital_published'
  | 'official_registry'
  | 'user_reported_pending'
  | 'google_live';

/**
 * F18. Attached to every fact-bearing record. `verifiedAt: null` means nobody
 * ever checked — it must never render as fresh.
 */
export interface Provenance {
  source: SourceType;
  sourceUrl: string | null;
  verifiedAt: string | null;
  verifiedByRole: string | null;
}

export type FreshnessState = 'fresh' | 'ageing' | 'stale' | 'unverified' | 'live';

export interface FreshnessView {
  state: FreshnessState;
  ageDays: number | null;
  ttlDays: number;
  /** e.g. "FlowCare · verified 12 Aug 2026" */
  label: string;
  /** e.g. "may be out of date" — null when fresh. */
  caution: string | null;
}

export interface FactView<T> {
  value: T;
  provenance: Provenance;
  freshness: FreshnessView;
}

/** F2 — service verified at THIS location, not just listed. */
export interface ServiceVerification {
  hospitalId: string;
  serviceSlug: string;
  method: 'hospital_confirmed' | 'public_document' | 'staff_observed' | 'user_reported_pending';
  provenance: Provenance;
}

/** F4 — listed on a scheme registry. NEVER means "cashless is honoured". */
export interface SchemeListing {
  hospitalId: string;
  schemeCode: string;
  schemeName: string;
  listingStatus: 'listed' | 'unknown';
  provenance: Provenance;
}

/** F5 — published administrative charges only. Never an estimate. */
export interface FacilityCharge {
  hospitalId: string;
  chargeType: 'opd_registration' | 'new_patient_consultation' | 'followup_consultation';
  amountMin: number;
  amountMax: number;
  currency: 'INR';
  isPublishedRange: boolean;
  provenance: Provenance;
}

export type AccessibilityStatus =
  | 'meets_standard'
  | 'present_below_standard'
  | 'not_present'
  | 'not_assessed';

/** F7 — one observable component, never collapsed into a score. */
export interface AccessibilityComponent {
  hospitalId: string;
  componentCode: string;
  status: AccessibilityStatus;
  standardReference: string | null;
  note: string | null;
  provenance: Provenance;
}

/** F8 — language support per workflow stage, not per hospital. */
export interface LanguageSupport {
  hospitalId: string;
  stage: string;
  languages: string[];
  provenance: Provenance;
}

/** F10 + F13 + F14 — arrival logistics. */
export interface ArrivalPack {
  hospitalId: string;
  gateLabel: string | null;
  gateNote: string | null;
  firstCounter: string | null;
  buildingNote: string | null;
  parkingNote: string | null;
  dropoffNote: string | null;
  latePolicyText: string | null;
  arrivalGuidanceText: string | null;
  provenance: Provenance;
}

/** F12 — static landmark steps. No indoor positioning, ever. */
export interface WayfindingRoute {
  hospitalId: string;
  fromPoint: string;
  toPoint: string;
  locale: string;
  steps: string[];
  stepFree: boolean | null;
  walkingMinutes: number | null;
  provenance: Provenance;
}

/** F9 — ADMINISTRATIVE preparation only. Clinical text is blocked in CI. */
export interface PrepRequirement {
  hospitalId: string;
  departmentId: string | null;
  code: string;
  text: string;
  appliesTo: 'all' | 'first_visit' | 'scheme_patients' | 'procedure';
  provenance: Provenance;
}

/** F3 — a private organising label. No clinical fields, ever. */
export interface CareContext {
  id: string;
  ownerUserId: string;
  label: string;
  accessibilityPrefs: string[];
  languagePrefs: string[];
  transportMode: TravelMode | null;
  createdAt: string;
}

/** F19 — where and when only. Never why. */
export interface VisitRecord {
  id: string;
  ownerUserId: string;
  careContextId: string | null;
  hospitalId: string;
  departmentId: string | null;
  visitDate: string;
  createdAt: string;
}

export type FollowUpTaskType =
  | 'collect_report'
  | 'book_followup'
  | 'book_referral'
  | 'collect_medicines'
  | 'submit_documents';

/** F20 — closed enum, no free text. FlowCare never generates the recommendation. */
export interface FollowUpTask {
  id: string;
  ownerUserId: string;
  careContextId: string | null;
  hospitalId: string | null;
  departmentId: string | null;
  taskType: FollowUpTaskType;
  dueDate: string;
  status: 'open' | 'done' | 'dismissed';
  createdAt: string;
}

/** F17 — user-reported facility correction. Never published without human review. */
export interface FacilityCorrection {
  id: string;
  hospitalId: string;
  fieldCode: string;
  reportedByUserId: string;
  claimedValue: string | null;
  evidenceKind: 'i_called' | 'i_visited' | 'i_work_here' | 'saw_a_notice' | 'other';
  note: string | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'duplicate';
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  outcome: string | null;
  createdAt: string;
}

/**
 * F16 — a detected FlowCare-vs-Google disagreement.
 * Stores SALTED HASHES only: the Google value must not be persisted
 * (Maps Service Terms §14.3). See lib/discrepancy.ts.
 */
export interface FieldDiscrepancy {
  hospitalId: string;
  fieldCode: string;
  flowcareValueHash: string;
  externalValueHash: string;
  detectedAt: string;
  status: 'open' | 'resolved';
}

export type TravelMode = 'walk' | 'transit' | 'drive';

/** F6 — never substitute one mode's time for another. */
export interface TravelEstimate {
  mode: TravelMode;
  minutes: number | null;
  distanceKm: number | null;
  /** 'straight_line' is the honest fallback when routing is unavailable. */
  basis: 'routing' | 'straight_line';
  status: 'ok' | 'not_configured' | 'unsupported_mode' | 'error';
  message: string | null;
}
