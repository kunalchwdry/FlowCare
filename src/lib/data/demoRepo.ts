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
} from './repo';
import { assertAdministrative } from '@/lib/journey/prep';
import type {
  AccessibilityComponent, Appointment, CareContext, ClinicSession,
  FacilityCorrection, Favorite, FollowUpTask, Hospital, HospitalReview,
  ModerationEvent, QueueSnapshot, ReviewReport, SchemeListing,
  ServiceVerification, VisitRecord,
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
}

const DATA_DIR = path.join(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'demo-state.json');

function emptyState(): MutableState {
  return {
    appointments: [], favorites: [], reviews: [...SEED.reviews], reports: [], moderationEvents: [], audit: [],
    careContexts: [], visitRecords: [], followUpTasks: [], corrections: [],
  };
}

let state: MutableState | null = null;

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
    let rows: Appointment[] = [...SEED.appointments, ...load().appointments];
    if (patientId) rows = rows.filter((a) => a.patientId === patientId);
    if (hospitalId) rows = rows.filter((a) => a.hospitalId === hospitalId);
    return rows;
  },

  async getAppointment(id: string): Promise<Appointment | null> {
    return [...SEED.appointments, ...load().appointments].find((a) => a.id === id) ?? null;
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
    };
    s.appointments.push(appointment);
    save();
    return appointment;
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
