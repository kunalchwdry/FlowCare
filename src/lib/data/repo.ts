import type {
  AccessibilityComponent, Appointment, AppointmentMessage, ArrivalPack, CareContext,
  ClinicSession, FacilityCharge, FacilityCorrection, Favorite, FollowUpTask, Hospital,
  HospitalReview, LanguageSupport, ModerationEvent, PrepRequirement, QueueSnapshot,
  ReviewReport, SchemeListing, ServiceVerification, VisitRecord, WayfindingRoute,
  AppointmentEvent, Notification,
} from '@/lib/types';

/** Storage-agnostic contract. Implemented by demoRepo and supabaseRepo. */
export interface Repo {
  readonly kind: 'demo' | 'supabase';
  listHospitals(): Promise<Hospital[]>;
  getHospital(idOrSlug: string): Promise<Hospital | null>;
  listSessions(hospitalIds?: string[]): Promise<ClinicSession[]>;
  listQueues(hospitalIds?: string[]): Promise<QueueSnapshot[]>;
  listReviews(opts?: { hospitalId?: string; includeNonPublished?: boolean }): Promise<HospitalReview[]>;
  listAppointments(opts: { patientId?: string; hospitalId?: string }): Promise<Appointment[]>;
  getAppointment(id: string): Promise<Appointment | null>;
  /** Creates a slot REQUEST. Never returns a confirmed booking. */
  requestAppointment(input: NewAppointmentRequest): Promise<Appointment>;

  /**
   * The only way an appointment's status may change.
   *
   * Validation lives in lib/appointments/stateMachine; this just applies the
   * plan it returns and writes the matching event. No caller anywhere may
   * assign `status` directly.
   */
  transitionAppointment(input: TransitionInput): Promise<Appointment>;
  listAppointmentEvents(appointmentId: string): Promise<AppointmentEvent[]>;
  listAppointmentMessages(appointmentId: string): Promise<AppointmentMessage[]>;
  sendAppointmentMessage(input: NewAppointmentMessage): Promise<AppointmentMessage>;

  listNotifications(audience: 'patient' | 'hospital', recipientId: string): Promise<Notification[]>;
  markNotificationsRead(audience: 'patient' | 'hospital', recipientId: string): Promise<void>;

  createReview(input: NewReview): Promise<HospitalReview>;
  getReview(id: string): Promise<HospitalReview | null>;
  setReviewStatus(id: string, status: HospitalReview['status']): Promise<void>;

  listFavorites(userId: string): Promise<Favorite[]>;
  addFavorite(userId: string, hospitalId: string, note?: string | null): Promise<Favorite>;
  removeFavorite(userId: string, hospitalId: string): Promise<void>;

  createReport(input: NewReport): Promise<ReviewReport>;
  listReports(status?: ReviewReport['status']): Promise<ReviewReport[]>;
  setReportStatus(id: string, status: ReviewReport['status']): Promise<void>;

  recordModerationEvent(e: Omit<ModerationEvent, 'id' | 'createdAt'>): Promise<ModerationEvent>;
  listModerationEvents(reviewId?: string): Promise<ModerationEvent[]>;

  recordAuditEvent(e: AuditEvent): Promise<void>;

  /* ------------------------------------------------- journey layer ----- */
  /**
   * Facility facts (F2, F4, F5, F7, F8, F9, F10, F12). Read-only from the
   * application's point of view: they change through the correction workflow
   * (F17) and operator import, never through a user write path.
   */
  getFacilityFacts(hospitalId: string): Promise<FacilityFacts>;
  /** Bulk read for search/compare. Only the fields those surfaces need. */
  listServiceVerifications(hospitalIds?: string[]): Promise<ServiceVerification[]>;
  listSchemeListings(hospitalIds?: string[]): Promise<SchemeListing[]>;
  listAccessibilityComponents(hospitalIds?: string[]): Promise<AccessibilityComponent[]>;

  /* F3 — care contexts. Owner-scoped; never readable across users. */
  listCareContexts(ownerUserId: string): Promise<CareContext[]>;
  createCareContext(input: NewCareContext): Promise<CareContext>;
  deleteCareContext(ownerUserId: string, id: string): Promise<void>;

  /* F19 — visit records. Opt-in, owner-scoped, where/when only. */
  listVisitRecords(ownerUserId: string): Promise<VisitRecord[]>;
  createVisitRecord(input: NewVisitRecord): Promise<VisitRecord>;
  deleteVisitRecord(ownerUserId: string, id: string): Promise<void>;
  /** F19 retention: hard-delete anything older than the window. */
  purgeVisitRecords(ownerUserId: string, olderThanIso: string): Promise<number>;

  /* F20 — follow-up tasks. Closed enum, owner-scoped. */
  listFollowUpTasks(ownerUserId: string): Promise<FollowUpTask[]>;
  createFollowUpTask(input: NewFollowUpTask): Promise<FollowUpTask>;
  setFollowUpStatus(ownerUserId: string, id: string, status: FollowUpTask['status']): Promise<void>;
  deleteFollowUpTask(ownerUserId: string, id: string): Promise<void>;

  /* F17 — corrections. Publication requires a human decision. */
  createCorrection(input: NewCorrection): Promise<FacilityCorrection>;
  listCorrections(opts?: {
    hospitalId?: string;
    reportedByUserId?: string;
    status?: FacilityCorrection['status'];
  }): Promise<FacilityCorrection[]>;
  getCorrection(id: string): Promise<FacilityCorrection | null>;
  reviewCorrection(input: CorrectionReview): Promise<FacilityCorrection>;
}

/** Everything the profile page needs about one facility, in one round trip. */
export interface FacilityFacts {
  hospitalId: string;
  serviceVerifications: ServiceVerification[];
  schemeListings: SchemeListing[];
  charges: FacilityCharge[];
  accessibilityComponents: AccessibilityComponent[];
  languageSupport: LanguageSupport[];
  arrivalPack: ArrivalPack | null;
  routes: WayfindingRoute[];
  prepRequirements: PrepRequirement[];
}

export interface NewCareContext {
  ownerUserId: string;
  label: string;
  accessibilityPrefs: string[];
  languagePrefs: string[];
  transportMode: CareContext['transportMode'];
}

export interface NewAppointmentRequest {
  patientId: string;
  /** Hospital, department and time are derived from the session, not the client. */
  sessionId: string;
  reason?: string | null;
}

export interface NewAppointmentMessage {
  appointmentId: string;
  senderSide: 'patient' | 'hospital';
  senderId: string;
  body: string;
}

export interface NewVisitRecord {
  ownerUserId: string;
  careContextId: string | null;
  hospitalId: string;
  departmentId: string | null;
  visitDate: string;
}

export interface NewFollowUpTask {
  ownerUserId: string;
  careContextId: string | null;
  hospitalId: string | null;
  departmentId: string | null;
  taskType: FollowUpTask['taskType'];
  dueDate: string;
}

export interface NewCorrection {
  hospitalId: string;
  fieldCode: string;
  reportedByUserId: string;
  claimedValue: string | null;
  evidenceKind: FacilityCorrection['evidenceKind'];
  note: string | null;
  /** Set by the API when duplicate detection fires. */
  status?: FacilityCorrection['status'];
}

export interface CorrectionReview {
  correctionId: string;
  reviewerUserId: string;
  decision: 'confirmed' | 'rejected' | 'duplicate';
  outcome: string | null;
}

export interface NewReview {
  hospitalId: string;
  authorId: string;
  authorHandle: string;
  appointmentId: string;
  ratings: HospitalReview['ratings'];
  comment: string | null;
  status: HospitalReview['status'];
}

export interface NewReport {
  reviewId: string;
  reporterId: string;
  reason: string;
  detail: string | null;
}

export interface TransitionInput {
  appointmentId: string;
  action: string;
  actor: 'patient' | 'hospital';
  actorId: string;
  actorRole: string;
  /** Hospital permissions held by the caller. Empty for patients. */
  permissions?: readonly string[];
  /** Caller's view of the row; a mismatch is a VERSION_CONFLICT. */
  expectedVersion?: number;
  reason?: string | null;
  proposedSessionId?: string | null;
  /** Scopes the write. A mismatch must surface as NOT_FOUND, never 403. */
  hospitalId?: string | null;
}

export interface AuditEvent {
  actorId: string | null;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string | null;
  /** Must contain no free-text patient content and no precise location. */
  metadata: Record<string, string | number | boolean | null>;
}
