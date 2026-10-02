/**
 * File-backed in-memory repository used when Supabase is not configured.
 * Mutations are persisted to .data/demo-state.json so favourites and reviews
 * survive a dev-server restart. This is a DEVELOPMENT implementation only and
 * enforces authorisation in application code; the Supabase implementation
 * additionally enforces it in the database via RLS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SEED } from './seed';
import { FACTS } from './facts';
import type {
  AuditEvent, CorrectionReview, FacilityFacts, NewCareContext, NewCorrection,
  NewAppointmentRequest, NewFollowUpTask, NewReport, NewReview, NewVisitRecord, Repo,
  TransitionInput,
} from './repo';
import { plan, TransitionError } from '@/lib/appointments/stateMachine';
import { assertAdministrative } from '@/lib/journey/prep';
import type {
  AccessibilityComponent, Appointment, CareContext, ClinicSession,
  FacilityCorrection, Favorite, FollowUpTask, Hospital, HospitalReview,
  ModerationEvent, QueueSnapshot, ReviewReport, SchemeListing,
  ServiceVerification, VisitRecord, AppointmentEvent, Notification,
} from '@/lib/types';

interface MutableState {
  /** Appointment requests made in this demo, on top of the seeded history. */
  appointments: Appointment[];
  favorites: Favorite[];
  reviews: HospitalReview[];
  reports: ReviewReport[];
  moderationEvents: ModerationEvent[];
  audit: Array<AuditEvent & { at: string }>;
  /* journey layer */
  careContexts: CareContext[];
  visitRecords: VisitRecord[];
  followUpTasks: FollowUpTask[];
  corrections: FacilityCorrection[];
  /** Audit trail for appointment transitions. Append-only. */
  appointmentEvents: AppointmentEvent[];
  notifications: Notification[];
}

const DATA_DIR = path.join(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'demo-state.json');

function emptyState(): MutableState {
  return {
    appointments: [], favorites: [], reviews: [...SEED.reviews], reports: [], moderationEvents: [], audit: [],
    careContexts: [], visitRecords: [], followUpTasks: [], corrections: [],
      appointmentEvents: [], notifications: [],
  };
}

let state: MutableState | null = null;

/**
 * Raise in-app notices for a transition.
 *
 * In-app only, deliberately. No email or SMS provider is configured, and
 * writing "we have emailed you" when nothing was sent is the kind of claim
 * this codebase does not make. Both sides are notified so the patient and
 * the hospital see the same event from their own point of view.
 */
function notify(
  s: MutableState,
  apt: Appointment,
  action: string,
  to: string,
  reason: string | null,
): void {
  const now = new Date().toISOString();
  const hospital = SEED.hospitals.find((h) => h.id === apt.hospitalId);
  const name = hospital?.name ?? 'The hospital';

  const forPatient: Record<string, { title: string; body: string }> = {
    accept: { title: 'Appointment confirmed', body: `${name} confirmed your appointment.` },
    reject: { title: 'Request declined', body: reason ? `${name} declined your request: ${reason}` : `${name} declined your request.` },
    propose_reschedule: { title: 'A different time was proposed', body: `${name} has proposed another time. Accept or decline it on your visits page.` },
    cancel: { title: 'Appointment cancelled', body: reason ? `${name} cancelled this appointment: ${reason}` : 'This appointment was cancelled.' },
    check_in: { title: 'Checked in', body: `You are checked in at ${name}.` },
    start: { title: 'Your consultation has started', body: `${name} has called you through.` },
    complete: { title: 'Visit completed', body: `Your visit to ${name} is complete. You can now leave a review.` },
    no_show: { title: 'Marked as not attended', body: `${name} recorded this appointment as not attended.` },
  };

  const p = forPatient[action];
  if (p) {
    s.notifications.push({
      id: uid('ntf'), audience: 'patient', recipientId: apt.patientId,
      kind: action, title: p.title, body: p.body,
      appointmentId: apt.id, readAt: null, createdAt: now,
    });
  }

  // The hospital side only needs telling about things the patient initiated.
  const forHospital: Record<string, { title: string; body: string }> = {
    accept_reschedule: { title: 'Patient accepted the new time', body: 'A proposed time was accepted.' },
    decline_reschedule: { title: 'Patient declined the new time', body: 'A proposed time was declined and the appointment is cancelled.' },
    cancel: { title: 'Appointment cancelled', body: reason ? `Cancelled: ${reason}` : 'An appointment was cancelled.' },
  };
  const h = forHospital[action];
  if (h) {
    s.notifications.push({
      id: uid('ntf'), audience: 'hospital', recipientId: apt.hospitalId,
      kind: action, title: h.title, body: h.body,
      appointmentId: apt.id, readAt: null, createdAt: now,
    });
  }
  void to;
}

function load(): MutableState {
  if (state) return state;
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as MutableState;
    state = { ...emptyState(), ...parsed };
  } catch {
    state = emptyState();
  }
  return state!;
}

function save() {
  if (!state) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    /* non-fatal in read-only environments */
  }
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const demoRepo: Repo = {
  kind: 'demo',

  async listHospitals(): Promise<Hospital[]> {
    return SEED.hospitals;
  },

  async getHospital(idOrSlug) {
    return SEED.hospitals.find((h) => h.id === idOrSlug || h.slug === idOrSlug) ?? null;
  },

  async listSessions(hospitalIds?: string[]): Promise<ClinicSession[]> {
    const taken = new Map<string, number>();
    for (const a of load().appointments) {
      if (a.status === 'cancelled') continue;
      taken.set(a.sessionId, (taken.get(a.sessionId) ?? 0) + 1);
    }
    const withRequests = SEED.sessions.map((s) => {
      const extra = taken.get(s.id) ?? 0;
      if (!extra) return s;
      const booked = Math.min(s.capacity, s.booked + extra);
      return { ...s, booked, status: booked >= s.capacity ? ('full' as const) : s.status };
    });
    if (!hospitalIds) return withRequests;
    const set = new Set(hospitalIds);
    return withRequests.filter((s) => set.has(s.hospitalId));
  },

  async listQueues(hospitalIds?: string[]): Promise<QueueSnapshot[]> {
    if (!hospitalIds) return SEED.queues;
    const set = new Set(hospitalIds);
    return SEED.queues.filter((q) => set.has(q.hospitalId));
  },

  async listReviews(opts) {
    const s = load();
    let rows = s.reviews;
    if (opts?.hospitalId) rows = rows.filter((r) => r.hospitalId === opts.hospitalId);
    if (!opts?.includeNonPublished) rows = rows.filter((r) => r.status === 'published');
    return rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async listAppointments({ patientId, hospitalId }): Promise<Appointment[]> {
    // Copies throughout: callers must not be able to write into repo state.
    let rows: Appointment[] = [...SEED.appointments, ...load().appointments].map((a) => ({ ...a }));
    if (patientId) rows = rows.filter((a) => a.patientId === patientId);
    if (hospitalId) rows = rows.filter((a) => a.hospitalId === hospitalId);
    return rows;
  },

  async getAppointment(id: string): Promise<Appointment | null> {
    const found = [...SEED.appointments, ...load().appointments].find((a) => a.id === id);
    return found ? { ...found } : null;
  },

  /**
   * Records a REQUEST for a slot. Capacity is checked here because the demo
   * repository has no database to enforce it; the Supabase implementation
   * defers to a SECURITY DEFINER function instead.
   */
  async requestAppointment(input: NewAppointmentRequest): Promise<Appointment> {
    const s = load();
    const session = SEED.sessions.find((x) => x.id === input.sessionId);
    if (!session) throw new Error('NOT_FOUND');
    const takenHere = s.appointments.filter(
      (a) => a.sessionId === session.id && a.status !== 'cancelled',
    ).length;
    if (session.status !== 'open') throw new Error('BOOKING_CLOSED');
    if (session.booked + takenHere >= session.capacity) throw new Error('CAPACITY_FULL');
    const already = s.appointments.find(
      (a) => a.sessionId === session.id && a.patientId === input.patientId && a.status !== 'cancelled',
    );
    if (already) return already;

    const appointment: Appointment = {
      id: uid('apt'),
      hospitalId: session.hospitalId,
      patientId: input.patientId,
      departmentId: session.departmentId,
      sessionId: session.id,
      scheduledFor: `${session.date}T${session.startTime}:00`,
      status: 'requested',
      completedAt: null,
      reason: input.reason ?? null,
      requestedAt: new Date().toISOString(),
      // Explicit from the start. Leaving it undefined meant the first
      // transition jumped straight to 2, and every caller had to guess
      // what "no version" meant.
      version: 1,
    };
    s.appointments.push(appointment);
    save();
    /*
     * A copy, not the stored object.
     *
     * Returning the live row let a later mutation reach back into the
     * caller's value: once a transition bumped `version`, a reference
     * handed out earlier appeared to hold the NEW version, so an
     * optimistic-concurrency check comparing against it silently passed
     * and the conflict surfaced as an unrelated illegal-transition error.
     * A stale read has to stay stale — that is the whole mechanism.
     */
    return { ...appointment };
  },

  /**
   * Apply a validated transition.
   *
   * The seeded appointments are immutable fixtures, so a transition against
   * one is materialised into mutable state first. Everything else — who may
   * act, from which status, whether a reason is required — is decided by
   * stateMachine.plan(), never here.
   */
  async transitionAppointment(input: TransitionInput): Promise<Appointment> {
    const s = load();
    const seeded = SEED.appointments.find((a) => a.id === input.appointmentId);
    let row = s.appointments.find((a) => a.id === input.appointmentId);

    if (!row && seeded) {
      row = { ...seeded, version: seeded.version ?? 1 };
      s.appointments.push(row);
    }
    if (!row) throw new Error('NOT_FOUND');

    // Scope check before anything else. A staff member naming another
    // hospital's appointment id gets NOT_FOUND, not FORBIDDEN: a 403 would
    // confirm the row exists and turn this into an enumeration oracle.
    if (input.hospitalId && row.hospitalId !== input.hospitalId) throw new Error('NOT_FOUND');
    if (input.actor === 'patient' && row.patientId !== input.actorId) throw new Error('NOT_FOUND');

    const current = row.version ?? 1;
    const decided = plan({
      action: input.action,
      actor: input.actor,
      permissions: input.permissions ?? [],
      current: row.status,
      expectedVersion: input.expectedVersion,
      actualVersion: current,
      reason: input.reason ?? null,
      proposedSlotId: input.proposedSessionId ?? null,
    });

    const now = new Date().toISOString();

    // Accepting a proposed time moves the booking onto that session, so the
    // seat has to be available there too. Checked here rather than in the
    // state machine because capacity is data, not policy.
    if (decided.consumesCapacity && row.proposedSessionId) {
      const target = SEED.sessions.find((x) => x.id === row!.proposedSessionId);
      if (!target) throw new Error('NOT_FOUND');
      const taken = s.appointments.filter(
        (a) => a.sessionId === target.id && !['cancelled', 'rejected', 'no_show'].includes(a.status),
      ).length;
      if (target.booked + taken >= target.capacity) throw new Error('CAPACITY_FULL');
      row.sessionId = target.id;
      row.scheduledFor = `${target.date}T${target.startTime}:00`;
      row.departmentId = target.departmentId;
    }

    if (decided.action === 'propose_reschedule') {
      const target = SEED.sessions.find((x) => x.id === decided.proposedSlotId);
      if (!target) throw new Error('NOT_FOUND');
      row.proposedSessionId = target.id;
      row.proposedFor = `${target.date}T${target.startTime}:00`;
    } else {
      row.proposedSessionId = null;
      row.proposedFor = null;
    }

    const from = row.status;
    row.status = decided.to;
    row.version = current + 1;
    if (decided.to === 'booked') row.confirmedAt = now;
    if (decided.to === 'completed') row.completedAt = now;
    if (decided.reason) row.decisionReason = decided.reason;

    s.appointmentEvents.push({
      id: uid('evt'),
      appointmentId: row.id,
      action: decided.action,
      fromStatus: from,
      toStatus: decided.to,
      actorSide: input.actor,
      actorRole: input.actorRole,
      actorId: input.actorId,
      reason: decided.reason,
      createdAt: now,
    });

    notify(s, row, decided.action, decided.to, decided.reason);
    save();
    return { ...row };
  },

  async listAppointmentEvents(appointmentId: string): Promise<AppointmentEvent[]> {
    return load()
      .appointmentEvents.filter((e) => e.appointmentId === appointmentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async listNotifications(audience, recipientId): Promise<Notification[]> {
    return load()
      .notifications.filter((n) => n.audience === audience && n.recipientId === recipientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50);
  },

  async markNotificationsRead(audience, recipientId): Promise<void> {
    const s = load();
    const now = new Date().toISOString();
    for (const n of s.notifications) {
      if (n.audience === audience && n.recipientId === recipientId && !n.readAt) n.readAt = now;
    }
    save();
  },

  async createReview(input: NewReview) {
    const s = load();
    const review: HospitalReview = {
      id: uid('rev'),
      hospitalId: input.hospitalId,
      authorId: input.authorId,
      authorHandle: input.authorHandle,
      appointmentId: input.appointmentId,
      ratings: input.ratings,
      comment: input.comment,
      createdAt: new Date().toISOString(),
      status: input.status,
      verifiedVisit: true,
      helpfulCount: 0,
    };
    s.reviews.push(review);
    save();
    return review;
  },

  async getReview(id) {
    return load().reviews.find((r) => r.id === id) ?? null;
  },

  async setReviewStatus(id, status) {
    const s = load();
    const r = s.reviews.find((x) => x.id === id);
    if (r) { r.status = status; save(); }
  },

  async listFavorites(userId) {
    return load().favorites.filter((f) => f.userId === userId);
  },

  async addFavorite(userId, hospitalId, note = null) {
    const s = load();
    const existing = s.favorites.find((f) => f.userId === userId && f.hospitalId === hospitalId);
    if (existing) return existing;
    const fav: Favorite = { userId, hospitalId, note, createdAt: new Date().toISOString() };
    s.favorites.push(fav);
    save();
    return fav;
  },

  async removeFavorite(userId, hospitalId) {
    const s = load();
    s.favorites = s.favorites.filter((f) => !(f.userId === userId && f.hospitalId === hospitalId));
    save();
  },

  async createReport(input: NewReport) {
    const s = load();
    const report: ReviewReport = {
      id: uid('rep'), reviewId: input.reviewId, reporterId: input.reporterId,
      reason: input.reason, detail: input.detail, createdAt: new Date().toISOString(), status: 'open',
    };
    s.reports.push(report);
    save();
    return report;
  },

  async listReports(status) {
    const s = load();
    return status ? s.reports.filter((r) => r.status === status) : s.reports;
  },

  async setReportStatus(id, status) {
    const s = load();
    const r = s.reports.find((x) => x.id === id);
    if (r) { r.status = status; save(); }
  },

  async recordModerationEvent(e) {
    const s = load();
    const ev: ModerationEvent = { ...e, id: uid('mod'), createdAt: new Date().toISOString() };
    s.moderationEvents.push(ev);
    save();
    return ev;
  },

  async listModerationEvents(reviewId) {
    const s = load();
    return reviewId ? s.moderationEvents.filter((e) => e.reviewId === reviewId) : s.moderationEvents;
  },

  async recordAuditEvent(e) {
    const s = load();
    s.audit.push({ ...e, at: new Date().toISOString() });
    if (s.audit.length > 2000) s.audit.splice(0, s.audit.length - 2000);
    save();
  },

  /* ================================================= journey layer ==== */

  async getFacilityFacts(hospitalId: string): Promise<FacilityFacts> {
    const of = <T extends { hospitalId: string }>(rows: T[]) =>
      rows.filter((r) => r.hospitalId === hospitalId);
    return {
      hospitalId,
      serviceVerifications: of(FACTS.serviceVerifications),
      schemeListings: of(FACTS.schemeListings),
      charges: of(FACTS.charges),
      accessibilityComponents: of(FACTS.accessibilityComponents),
      languageSupport: of(FACTS.languageSupport),
      arrivalPack: FACTS.arrivalPacks.find((a) => a.hospitalId === hospitalId) ?? null,
      routes: of(FACTS.routes),
      prepRequirements: of(FACTS.prepRequirements),
    };
  },

  async listServiceVerifications(hospitalIds?: string[]): Promise<ServiceVerification[]> {
    if (!hospitalIds) return FACTS.serviceVerifications;
    const set = new Set(hospitalIds);
    return FACTS.serviceVerifications.filter((v) => set.has(v.hospitalId));
  },

  async listSchemeListings(hospitalIds?: string[]): Promise<SchemeListing[]> {
    if (!hospitalIds) return FACTS.schemeListings;
    const set = new Set(hospitalIds);
    return FACTS.schemeListings.filter((v) => set.has(v.hospitalId));
  },

  async listAccessibilityComponents(hospitalIds?: string[]): Promise<AccessibilityComponent[]> {
    if (!hospitalIds) return FACTS.accessibilityComponents;
    const set = new Set(hospitalIds);
    return FACTS.accessibilityComponents.filter((v) => set.has(v.hospitalId));
  },

  /* -------------------------------------------------------- F3 ------- */

  async listCareContexts(ownerUserId) {
    return load().careContexts.filter((c) => c.ownerUserId === ownerUserId);
  },

  async createCareContext(input: NewCareContext) {
    const s = load();
    const ctx: CareContext = {
      id: uid('ctx'),
      ownerUserId: input.ownerUserId,
      label: input.label,
      accessibilityPrefs: input.accessibilityPrefs,
      languagePrefs: input.languagePrefs,
      transportMode: input.transportMode,
      createdAt: new Date().toISOString(),
    };
    s.careContexts.push(ctx);
    save();
    return ctx;
  },

  async deleteCareContext(ownerUserId, id) {
    const s = load();
    // Owner scoping is enforced here, not by the caller.
    s.careContexts = s.careContexts.filter(
      (c) => !(c.id === id && c.ownerUserId === ownerUserId),
    );
    // Detach dependents rather than cascading a delete the user did not ask for.
    for (const v of s.visitRecords) if (v.careContextId === id && v.ownerUserId === ownerUserId) v.careContextId = null;
    for (const t of s.followUpTasks) if (t.careContextId === id && t.ownerUserId === ownerUserId) t.careContextId = null;
    save();
  },

  /* ------------------------------------------------------- F19 ------- */

  async listVisitRecords(ownerUserId) {
    return load().visitRecords
      .filter((v) => v.ownerUserId === ownerUserId)
      .sort((a, b) => b.visitDate.localeCompare(a.visitDate));
  },

  async createVisitRecord(input: NewVisitRecord) {
    const s = load();
    const rec: VisitRecord = {
      id: uid('vis'),
      ownerUserId: input.ownerUserId,
      careContextId: input.careContextId,
      hospitalId: input.hospitalId,
      departmentId: input.departmentId,
      visitDate: input.visitDate,
      createdAt: new Date().toISOString(),
    };
    s.visitRecords.push(rec);
    save();
    return rec;
  },

  async deleteVisitRecord(ownerUserId, id) {
    const s = load();
    s.visitRecords = s.visitRecords.filter(
      (v) => !(v.id === id && v.ownerUserId === ownerUserId),
    );
    save();
  },

  async purgeVisitRecords(ownerUserId, olderThanIso) {
    const s = load();
    const before = s.visitRecords.length;
    s.visitRecords = s.visitRecords.filter(
      (v) => !(v.ownerUserId === ownerUserId && v.createdAt < olderThanIso),
    );
    const removed = before - s.visitRecords.length;
    if (removed) save();
    return removed;
  },

  /* ------------------------------------------------------- F20 ------- */

  async listFollowUpTasks(ownerUserId) {
    return load().followUpTasks.filter((t) => t.ownerUserId === ownerUserId);
  },

  async createFollowUpTask(input: NewFollowUpTask) {
    const s = load();
    const task: FollowUpTask = {
      id: uid('fup'),
      ownerUserId: input.ownerUserId,
      careContextId: input.careContextId,
      hospitalId: input.hospitalId,
      departmentId: input.departmentId,
      taskType: input.taskType,
      dueDate: input.dueDate,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    s.followUpTasks.push(task);
    save();
    return task;
  },

  async setFollowUpStatus(ownerUserId, id, status) {
    const s = load();
    const t = s.followUpTasks.find((x) => x.id === id && x.ownerUserId === ownerUserId);
    if (t) { t.status = status; save(); }
  },

  async deleteFollowUpTask(ownerUserId, id) {
    const s = load();
    s.followUpTasks = s.followUpTasks.filter(
      (t) => !(t.id === id && t.ownerUserId === ownerUserId),
    );
    save();
  },

  /* ------------------------------------------------------- F17 ------- */

  async createCorrection(input: NewCorrection) {
    const s = load();
    // Defence in depth: clinical text must not reach storage even if an API
    // validator is bypassed or a future caller forgets to validate.
    if (input.claimedValue) assertAdministrative(input.claimedValue);
    if (input.note) assertAdministrative(input.note);

    const correction: FacilityCorrection = {
      id: uid('cor'),
      hospitalId: input.hospitalId,
      fieldCode: input.fieldCode,
      reportedByUserId: input.reportedByUserId,
      claimedValue: input.claimedValue,
      evidenceKind: input.evidenceKind,
      note: input.note,
      // A new correction is ALWAYS pending. There is no code path that
      // creates a confirmed correction (F17 R17).
      status: input.status === 'duplicate' ? 'duplicate' : 'pending',
      reviewedByUserId: null,
      reviewedAt: null,
      outcome: null,
      createdAt: new Date().toISOString(),
    };
    s.corrections.push(correction);
    save();
    return correction;
  },

  async listCorrections(opts = {}) {
    let rows = load().corrections;
    if (opts.hospitalId) rows = rows.filter((c) => c.hospitalId === opts.hospitalId);
    if (opts.reportedByUserId) rows = rows.filter((c) => c.reportedByUserId === opts.reportedByUserId);
    if (opts.status) rows = rows.filter((c) => c.status === opts.status);
    return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async getCorrection(id) {
    return load().corrections.find((c) => c.id === id) ?? null;
  },

  async reviewCorrection(input: CorrectionReview) {
    const s = load();
    const c = s.corrections.find((x) => x.id === input.correctionId);
    if (!c) throw new Error(`Correction ${input.correctionId} not found`);
    c.status = input.decision;
    c.reviewedByUserId = input.reviewerUserId;
    c.reviewedAt = new Date().toISOString();
    c.outcome = input.outcome;
    save();
    return c;
  },
};

/** Test helper: reset mutable demo state. */
export function __resetDemoState() {
  state = emptyState();
}
