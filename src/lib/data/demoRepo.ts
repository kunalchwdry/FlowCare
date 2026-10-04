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
  CareAccessMetrics, CareAccessOption, CareAccessRequest, CareAccessTransitionInput,
  CareEpisode, CareStateTransition, CareTask, CapacitySignal, NewCareAccessRequest, NewCareTask,
  QueueEntry, SlotType, RecoveryPolicy,
} from '@/lib/careAccess/types';
import type { NewOperationalDepartment, NewOperationalService, NewOperationalSlot, NewProvider, NewProviderSchedule, OperationalDepartment, OperationalService, OperationalSlot, Provider, ProviderSchedule, QueueListFilters } from '@/lib/operations/types';
import { planCareAccessTransition, CareAccessTransitionError } from '@/lib/careAccess/stateMachine';
import { formatQueueId } from '@/lib/operations/policy';
import type {
  AuditEvent, CorrectionReview, FacilityFacts, NewAppointmentMessage, NewCareContext,
  NewCorrection, NewAppointmentRequest, NewFollowUpTask, NewReport, NewReview,
  NewVisitRecord, Repo, TransitionInput,
} from './repo';
import { plan, TransitionError } from '@/lib/appointments/stateMachine';
import { assertAdministrative } from '@/lib/journey/prep';
import type {
  AccessibilityComponent, Appointment, CareContext, ClinicSession,
  FacilityCorrection, Favorite, FollowUpTask, Hospital, HospitalReview,
  ModerationEvent, QueueSnapshot, ReviewReport, SchemeListing,
  ServiceVerification, VisitRecord, AppointmentEvent, AppointmentMessage, Notification,
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
  appointmentMessages: AppointmentMessage[];
  notifications: Notification[];
  /* Closed-loop care access exchange. */
  careRequests: CareAccessRequest[];
  careOptions: CareAccessOption[];
  careTransitions: CareStateTransition[];
  careEpisodes: CareEpisode[];
  careTasks: CareTask[];
  capacitySignals: CapacitySignal[];
  operationalSlots: OperationalSlot[];
  operationalServices: OperationalService[];
  providers: Provider[];
  providerSchedules: ProviderSchedule[];
  queueEntries: QueueEntry[];
}

const DATA_DIR = path.join(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'demo-state.json');

function emptyState(): MutableState {
  return {
    appointments: [], favorites: [], reviews: [...SEED.reviews], reports: [], moderationEvents: [], audit: [],
    careContexts: [], visitRecords: [], followUpTasks: [], corrections: [],
    appointmentEvents: [], appointmentMessages: [], notifications: [],
    careRequests: [], careOptions: [], careTransitions: [], careEpisodes: [], careTasks: [], capacitySignals: [],
    operationalSlots: [], operationalServices: [], providers: [], providerSchedules: [], queueEntries: [],
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
    decline_reschedule: { title: 'Patient declined the new time', body: 'The patient kept the original appointment time.' },
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
    if (session.slotType === 'waitlist') throw new Error('WAITLIST_REQUIRED');
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
      status: session.slotType === 'instant' ? 'booked' : 'requested',
      slotType: session.slotType ?? 'approval_required',
      queueId: formatQueueId(new Date().getFullYear(), session.departmentId, Math.floor(100000 + Math.random() * 900000)),
      approvalStatus: session.slotType === 'instant' ? 'not_required' : 'pending',
      approvalDeadline: session.slotType === 'approval_required' ? new Date(Date.now() + (session.approvalResponseWindowMinutes ?? 240) * 60_000).toISOString() : null,
      completedAt: null,
      reason: input.reason ?? null,
      requestedAt: new Date().toISOString(),
      // Explicit from the start. Leaving it undefined meant the first
      // transition jumped straight to 2, and every caller had to guess
      // what "no version" meant.
      version: 1,
    };
    s.appointments.push(appointment);
    s.queueEntries.push({ id: uid('queue'), queueId: appointment.queueId!, careRequestId: null, appointmentId: appointment.id,
      patientId: appointment.patientId, hospitalId: appointment.hospitalId, departmentId: appointment.departmentId, providerId: session.providerId ?? null,
      slotId: session.id, queueType: 'appointment', status: session.slotType === 'instant' ? 'booked' : 'approval_pending', position: null,
      estimatedSlotAt: appointment.scheduledFor, lastUpdatedAt: appointment.requestedAt!, createdAt: appointment.requestedAt! });
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
    const priorProposedSessionId = row.proposedSessionId ?? null;
    const priorProposedFor = row.proposedFor ?? null;
    const priorStatus = row.status;

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

    if (decided.action === 'propose_reschedule') {
      s.appointmentMessages.push({
        id: uid('msg'), appointmentId: row.id, senderSide: 'hospital', senderId: input.actorId,
        kind: 'time_proposal', body: decided.reason ?? 'The hospital suggested a different time.',
        proposedSessionId: row.proposedSessionId, proposedFor: row.proposedFor,
        previousStatus: priorStatus, proposalStatus: 'pending', createdAt: now,
      });
    } else if (decided.action === 'accept_reschedule' || decided.action === 'decline_reschedule') {
      const proposal = [...s.appointmentMessages]
        .reverse()
        .find((m) => m.appointmentId === row.id && m.kind === 'time_proposal' && m.proposalStatus === 'pending');
      if (proposal) proposal.proposalStatus = decided.action === 'accept_reschedule' ? 'accepted' : 'declined';
      s.appointmentMessages.push({
        id: uid('msg'), appointmentId: row.id, senderSide: 'patient', senderId: input.actorId,
        kind: 'time_response',
        body: decided.action === 'accept_reschedule'
          ? 'I accepted the hospital\'s suggested time.'
          : 'I declined the hospital\'s suggested time and kept the original appointment.',
        proposedSessionId: priorProposedSessionId, proposedFor: priorProposedFor,
        previousStatus: priorStatus, proposalStatus: decided.action === 'accept_reschedule' ? 'accepted' : 'declined', createdAt: now,
      });
    }

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

  async listAppointmentMessages(appointmentId: string): Promise<AppointmentMessage[]> {
    return load()
      .appointmentMessages.filter((m) => m.appointmentId === appointmentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async sendAppointmentMessage(input: NewAppointmentMessage): Promise<AppointmentMessage> {
    const s = load();
    const appointment = [...SEED.appointments, ...s.appointments].find((a) => a.id === input.appointmentId);
    if (!appointment) throw new Error('NOT_FOUND');
    if (input.senderSide === 'patient' && appointment.patientId !== input.senderId) throw new Error('NOT_FOUND');
    if (input.body.trim().length === 0 || input.body.trim().length > 1000) throw new Error('INVALID_INPUT');
    const message: AppointmentMessage = {
      id: uid('msg'), appointmentId: input.appointmentId, senderSide: input.senderSide,
      senderId: input.senderId, kind: 'message', body: input.body.trim(), createdAt: new Date().toISOString(),
    };
    s.appointmentMessages.push(message);
    save();
    return { ...message };
  },

  /* ================================================= care access exchange */

  async listCareRequests({ patientId, hospitalId }) {
    let rows = load().careRequests;
    if (patientId) rows = rows.filter((r) => r.patientId === patientId);
    if (hospitalId) rows = rows.filter((r) => r.selectedHospitalId === hospitalId);
    return rows.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((r) => ({ ...r }));
  },

  async getCareRequest(id) {
    const row = load().careRequests.find((r) => r.id === id);
    return row ? { ...row } : null;
  },

  async createCareRequest(input: NewCareAccessRequest) {
    const s = load();
    const now = new Date().toISOString();
    const request: CareAccessRequest = {
      id: uid('care'), patientId: input.patientId,
      specialty: input.specialty ?? null, serviceType: input.serviceType,
      location: input.location ?? null, preferredStartDate: input.preferredStartDate ?? null,
      preferredEndDate: input.preferredEndDate ?? null, preferredTimeRange: input.preferredTimeRange ?? null,
      budgetConstraint: input.budgetConstraint ?? null,
      accessibilityRequirements: input.accessibilityRequirements ?? [],
      languagePreference: input.languagePreference ?? [], coverage: input.coverage ?? null,
      referralRequired: input.referralRequired ?? null, state: 'REQUESTED', patientPhone: null,
      slotType: null, queueId: null, queuePosition: null, approvalDeadline: null,
      approvalResponseWindowMinutes: null, recoveryPolicy: null,
      selectedHospitalId: null, selectedOptionId: null, appointmentId: null, episodeId: null,
      version: 1, createdAt: now, updatedAt: now, closedAt: null,
    };
    s.careRequests.push(request);
    s.careTransitions.push({
      id: uid('careevt'), careRequestId: request.id, previousState: null,
      newState: 'REQUESTED', action: 'create', actorId: null, actorRole: 'system',
      reason: null, metadata: { created: true }, createdAt: now,
    });
    save();
    return { ...request };
  },

  async listCareOptions(careRequestId) {
    return load().careOptions
      .filter((o) => o.careRequestId === careRequestId)
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.hospitalName.localeCompare(b.hospitalName))
      .map((o) => ({ ...o, reasons: [...o.reasons], accessibility: [...o.accessibility], languages: [...o.languages] }));
  },

  async saveCareOptions(careRequestId, options) {
    const s = load();
    s.careOptions = s.careOptions.filter((o) => o.careRequestId !== careRequestId);
    s.careOptions.push(...options.map((o) => ({ ...o })));
    save();
    return options.map((o) => ({ ...o }));
  },

  async transitionCareRequest(input) {
    const s = load();
    const row = s.careRequests.find((r) => r.id === input.careRequestId);
    if (!row) throw new Error('NOT_FOUND');
    if (input.actor === 'patient' && row.patientId !== input.actorId) throw new Error('NOT_FOUND');
    if (input.actor === 'hospital' && row.selectedHospitalId && row.selectedHospitalId !== (input.metadata?.hospitalId as string | undefined)) {
      throw new Error('NOT_FOUND');
    }
    const decided = planCareAccessTransition(row.state, input, row.version);
    const now = new Date().toISOString();
    const optionActions = ['select_option', 'select_recovery', 'request_approval', 'join_waitlist', 'rebook'];
    let selectedOption = row.selectedOptionId ? s.careOptions.find((o) => o.id === row.selectedOptionId && o.careRequestId === row.id) : null;
    if (optionActions.includes(decided.action)) {
      const option = s.careOptions.find((o) => o.id === decided.optionId && o.careRequestId === row.id);
      if (!option || !option.eligible) throw new Error('OPTION_NOT_FOUND');
      s.careOptions = s.careOptions.map((o) => ({
        ...o,
        status: o.id === option.id ? 'selected' : o.careRequestId === row.id && o.status === 'offered' ? 'declined' : o.status,
        selectedAt: o.id === option.id ? now : o.selectedAt,
      }));
      selectedOption = option;
      row.selectedHospitalId = option.hospitalId;
      row.selectedOptionId = option.id;
      row.slotType = option.slotType ?? 'approval_required';
      row.approvalResponseWindowMinutes = option.slotType === 'approval_required' ? 240 : null;
      row.approvalDeadline = decided.action === 'request_approval' && option.slotType === 'approval_required'
        ? new Date(Date.now() + (row.approvalResponseWindowMinutes ?? 240) * 60_000).toISOString() : null;
      row.recoveryPolicy = 'offer_alternatives';
    }
    if (decided.action === 'book' && row.selectedOptionId && !selectedOption) {
      selectedOption = s.careOptions.find((o) => o.id === row.selectedOptionId && o.careRequestId === row.id) ?? null;
      if (selectedOption) row.slotType = selectedOption.slotType ?? 'approval_required';
    }
    if (decided.action === 'book' && input.appointmentId) row.appointmentId = input.appointmentId;
    if (['request_approval', 'join_waitlist', 'rebook'].includes(decided.action) && selectedOption && !row.queueId) {
      const session = SEED.sessions.find((x) => x.id === selectedOption?.sessionId);
      const prefix = (session?.departmentId ?? 'CARE').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'CARE';
      row.queueId = formatQueueId(new Date().getFullYear(), prefix, Math.floor(100000 + Math.random() * 900000));
      row.queuePosition = s.queueEntries.filter((e) => e.slotId === selectedOption?.sessionId && ['waiting', 'approval_pending'].includes(e.status)).length + 1;
      const sessionDate = session ? `${session.date}T${session.startTime}:00` : null;
      s.queueEntries.push({ id: uid('queue'), queueId: row.queueId, careRequestId: row.id, appointmentId: row.appointmentId,
        patientId: row.patientId, hospitalId: selectedOption.hospitalId, departmentId: selectedOption.departmentId ?? '', providerId: selectedOption.providerId ?? null,
        slotId: selectedOption.sessionId, queueType: row.slotType === 'waitlist' ? 'waitlist' : decided.action === 'rebook' ? 'recovery' : 'approval',
        status: decided.action === 'join_waitlist' ? 'waiting' : decided.action === 'rebook' ? 'rebooked' : 'approval_pending',
        position: row.queuePosition, estimatedSlotAt: sessionDate, lastUpdatedAt: now, createdAt: now });
    }
    row.state = decided.to;
    if (row.queueId) {
      const queue = s.queueEntries.find((e) => e.queueId === row.queueId);
      if (queue) {
        queue.status = decided.to === 'BOOKED' || decided.to === 'REBOOKED' ? 'booked' : decided.to === 'APPROVAL_EXPIRED' ? 'expired' : queue.status;
        queue.appointmentId = row.appointmentId;
        queue.lastUpdatedAt = now;
      }
    }
    row.version += 1;
    row.updatedAt = now;
    if (decided.to === 'CLOSED') row.closedAt = now;
    const transition: CareStateTransition = {
      id: uid('careevt'), careRequestId: row.id, previousState: decided.from,
      newState: decided.to, action: decided.action, actorId: input.actorId,
      actorRole: input.actorRole, reason: decided.reason, metadata: decided.metadata,
      createdAt: now,
    };
    s.careTransitions.push(transition);
    if (!row.episodeId && row.selectedHospitalId && ['PATIENT_SELECTED', 'REFERRAL_SUBMITTED', 'APPROVAL_PENDING', 'APPROVED', 'ACKNOWLEDGED', 'ACCEPTED', 'SLOT_OFFERED', 'WAITLISTED', 'BOOKED', 'RECOVERY_REQUIRED', 'RECOVERY_OPTIONS_AVAILABLE', 'REBOOKED'].includes(row.state)) {
      const episode: CareEpisode = {
        id: uid('episode'), careRequestId: row.id, patientId: row.patientId,
        hospitalId: row.selectedHospitalId, appointmentId: row.appointmentId,
        followUpRequired: false, followUpCompleted: false, createdAt: now, closedAt: null,
      };
      s.careEpisodes.push(episode);
      row.episodeId = episode.id;
    } else if (row.episodeId) {
      const episode = s.careEpisodes.find((e) => e.id === row.episodeId);
      if (episode) {
        if (row.appointmentId) episode.appointmentId = row.appointmentId;
        if (row.state === 'FOLLOW_UP_OPEN') episode.followUpRequired = true;
        if (row.state === 'CLOSED') episode.closedAt = now;
      }
    }
    save();
    return { ...row };
  },

  async listCareTransitions(careRequestId) {
    return load().careTransitions.filter((e) => e.careRequestId === careRequestId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async listCareEpisodes({ patientId, hospitalId }) {
    let rows = load().careEpisodes;
    if (patientId) rows = rows.filter((e) => e.patientId === patientId);
    if (hospitalId) rows = rows.filter((e) => e.hospitalId === hospitalId);
    return rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((e) => ({ ...e }));
  },

  async listCareTasks({ patientId, hospitalId, careRequestId }) {
    let rows = load().careTasks;
    if (patientId) rows = rows.filter((t) => t.patientId === patientId);
    if (hospitalId) rows = rows.filter((t) => t.hospitalId === hospitalId);
    if (careRequestId) rows = rows.filter((t) => t.careRequestId === careRequestId);
    return rows.slice().sort((a, b) => a.status.localeCompare(b.status) || b.updatedAt.localeCompare(a.updatedAt)).map((t) => ({ ...t }));
  },

  async createCareTask(input: NewCareTask) {
    const s = load();
    const now = new Date().toISOString();
    const task: CareTask = {
      id: uid('task'), careRequestId: input.careRequestId, episodeId: input.episodeId ?? null,
      patientId: input.patientId, hospitalId: input.hospitalId ?? null,
      ownerType: input.ownerType, ownerId: input.ownerId ?? null, taskType: input.taskType,
      title: input.title.trim(), description: input.description?.trim() || null, status: 'open',
      deadline: input.deadline ?? null, resolution: null, createdAt: now, updatedAt: now, completedAt: null,
    };
    s.careTasks.push(task);
    save();
    return { ...task };
  },

  async updateCareTask(id, actorId, status, resolution = null) {
    const s = load();
    const task = s.careTasks.find((t) => t.id === id && (t.ownerId === actorId || t.patientId === actorId || t.hospitalId === actorId));
    if (!task) throw new Error('NOT_FOUND');
    task.status = status; task.resolution = resolution?.trim() || task.resolution;
    task.updatedAt = new Date().toISOString();
    task.completedAt = status === 'completed' ? (task.completedAt ?? task.updatedAt) : null;
    if (status === 'completed') {
      const row = s.careRequests.find((r) => r.id === task.careRequestId);
      if (row?.state === 'FOLLOW_UP_OPEN' && s.careTasks.filter((t) => t.careRequestId === row.id && t.status !== 'completed').length <= 1) {
        row.state = 'CLOSED'; row.closedAt = task.updatedAt; row.updatedAt = task.updatedAt; row.version += 1;
        s.careTransitions.push({ id: uid('careevt'), careRequestId: row.id, previousState: 'FOLLOW_UP_OPEN', newState: 'CLOSED', action: 'close', actorId, actorRole: task.ownerType, reason: null, metadata: { taskId: task.id }, createdAt: task.updatedAt });
      }
    }
    save();
    return { ...task };
  },

  async listCapacitySignals(hospitalIds) {
    const s = load();
    const ids = hospitalIds ? new Set(hospitalIds) : null;
    const seeded: CapacitySignal[] = SEED.queues.map((q) => ({
      id: `demo-capacity-${q.hospitalId}`, hospitalId: q.hospitalId, serviceSlug: null,
      available: q.published ? true : null, queueWaitMinutes: q.medianWaitMinutes,
      waitingCount: q.waitingCount, note: q.published ? 'Synthetic demo queue signal' : null,
      source: 'demo_simulated', updatedAt: q.observedAt ?? new Date().toISOString(),
      expiresAt: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
    }));
    const all = [...seeded, ...s.capacitySignals];
    const deduped = new Map<string, CapacitySignal>();
    for (const signal of all) {
      if (!ids || ids.has(signal.hospitalId)) deduped.set(`${signal.hospitalId}:${signal.serviceSlug ?? ''}`, signal);
    }
    return [...deduped.values()].map((x) => ({ ...x }));
  },

  async publishCapacitySignal(input) {
    const s = load();
    const signal: CapacitySignal = { ...input, id: uid('capacity'), updatedAt: new Date().toISOString() };
    s.capacitySignals = s.capacitySignals.filter((x) => !(x.hospitalId === signal.hospitalId && x.serviceSlug === signal.serviceSlug));
    s.capacitySignals.push(signal);
    save();
    return { ...signal };
  },

  async getCareAccessMetrics(hospitalId) {
    let requests = load().careRequests;
    if (hospitalId) requests = requests.filter((r) => r.selectedHospitalId === hospitalId);
    const ids = new Set(requests.map((r) => r.id));
    const events = load().careTransitions.filter((e) => ids.has(e.careRequestId));
    const duration = (from: string, to: string) => {
      const out: number[] = [];
      for (const id of ids) {
        const es = events.filter((e) => e.careRequestId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const a = es.find((e) => e.newState === from); const b = es.find((e) => e.newState === to);
        if (a && b) out.push((new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) / 60_000);
      }
      return out.length ? Math.round(out.reduce((a, b) => a + b, 0) / out.length) : null;
    };
    const staleCapacitySignals = (await this.listCapacitySignals(hospitalId ? [hospitalId] : undefined)).filter((s) => s.expiresAt && new Date(s.expiresAt) <= new Date()).length;
    return {
      total: requests.length, closed: requests.filter((r) => r.state === 'CLOSED').length,
      closureRate: requests.length ? Math.round((requests.filter((r) => r.state === 'CLOSED').length / requests.length) * 100) : null,
      averageAcknowledgementMinutes: duration('REFERRAL_SUBMITTED', 'ACKNOWLEDGED'),
      averageBookingMinutes: duration('SLOT_OFFERED', 'BOOKED'),
      unresolved: requests.filter((r) => !['CLOSED', 'CANCELLED', 'NO_SHOW'].includes(r.state)).length,
      staleCapacitySignals, cancellations: requests.filter((r) => r.state === 'CANCELLED').length,
      noShows: requests.filter((r) => r.state === 'NO_SHOW').length,
      followUpsOpen: requests.filter((r) => r.state === 'FOLLOW_UP_OPEN').length,
      pendingApprovals: requests.filter((r) => r.state === 'APPROVAL_PENDING').length,
      approvalExpired: requests.filter((r) => r.state === 'APPROVAL_EXPIRED').length,
      waitlisted: requests.filter((r) => r.state === 'WAITLISTED').length,
      recoveryRequired: requests.filter((r) => ['RECOVERY_REQUIRED', 'RECOVERY_OPTIONS_AVAILABLE'].includes(r.state)).length,
    } satisfies CareAccessMetrics;
  },

  async listOperationalDepartments(hospitalId) {
    const hospitals = hospitalId ? SEED.hospitals.filter((h) => h.id === hospitalId) : SEED.hospitals;
    const created = load().careContexts.length; // keeps this method pure; operational rows below are durable in state
    void created;
    const rows: OperationalDepartment[] = hospitals.flatMap((h) => h.departments.map((d) => ({
      id: d.id, hospitalId: h.id, name: d.name, bookingOpen: true, consultationCapacity: 4,
      noShowGraceMinutes: 30, approvalResponseWindowMinutes: 240, waitlistEnabled: true,
      recoveryPolicy: 'offer_alternatives' as const, queueOrderRule: 'arrival_order' as const,
    })));
    return rows;
  },

  async createOperationalDepartment(input: NewOperationalDepartment) {
    const hospital = SEED.hospitals.find((h) => h.id === input.hospitalId);
    if (!hospital) throw new Error('NOT_FOUND');
    const row: OperationalDepartment = {
      id: uid('dept'), hospitalId: input.hospitalId, name: input.name.trim(), bookingOpen: input.bookingOpen ?? true,
      consultationCapacity: input.consultationCapacity ?? 4, noShowGraceMinutes: input.noShowGraceMinutes ?? 30,
      approvalResponseWindowMinutes: input.approvalResponseWindowMinutes ?? 240, waitlistEnabled: input.waitlistEnabled ?? true,
      recoveryPolicy: input.recoveryPolicy ?? 'offer_alternatives', queueOrderRule: input.queueOrderRule ?? 'arrival_order',
    };
    // Demo departments are represented as an operational overlay; the seed directory remains untouched.
    save();
    return row;
  },

  async listOperationalServices(hospitalId) {
    return load().operationalServices.filter((s) => !hospitalId || s.hospitalId === hospitalId).map((s) => ({ ...s }));
  },

  async createOperationalService(input: NewOperationalService) {
    const dept = (await demoRepo.listOperationalDepartments()).find((d) => d.id === input.departmentId);
    if (!dept) throw new Error('NOT_FOUND');
    const row: OperationalService = { id: uid('service'), hospitalId: dept.hospitalId, departmentId: dept.id, serviceSlug: input.serviceSlug.trim(), label: input.label.trim(), active: input.active ?? true, source: 'hospital_configured' };
    load().operationalServices.push(row); save(); return { ...row };
  },

  async listProviders(hospitalId) {
    return load().providers.filter((p) => !hospitalId || p.hospitalId === hospitalId).map((p) => ({ ...p }));
  },

  async createProvider(input: NewProvider) {
    const dept = (await demoRepo.listOperationalDepartments(input.hospitalId)).find((d) => d.id === input.departmentId);
    if (!dept) throw new Error('NOT_FOUND');
    const row: Provider = { id: uid('provider'), hospitalId: input.hospitalId, departmentId: input.departmentId,
      name: input.name.trim(), specialty: input.specialty?.trim() || null, qualification: input.qualification?.trim() || null,
      active: input.active ?? true };
    load().providers.push(row); save(); return { ...row };
  },

  async listProviderSchedules(providerId) {
    return load().providerSchedules.filter((s) => !providerId || s.providerId === providerId).map((s) => ({ ...s }));
  },

  async createProviderSchedule(input: NewProviderSchedule) {
    const provider = load().providers.find((p) => p.id === input.providerId);
    if (!provider) throw new Error('NOT_FOUND');
    const row: ProviderSchedule = { id: uid('schedule'), providerId: input.providerId, weekday: input.weekday,
      startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone ?? 'Asia/Kolkata', active: input.active ?? true };
    load().providerSchedules.push(row); save(); return { ...row };
  },

  async listOperationalSlots(hospitalId) {
    const sessions = await demoRepo.listSessions(hospitalId ? [hospitalId] : undefined);
    const seeded: OperationalSlot[] = sessions.map((s) => ({
      id: s.id, hospitalId: s.hospitalId, departmentId: s.departmentId, providerId: s.providerId ?? null,
      serviceSlug: s.serviceSlug ?? null, startsAt: `${s.date}T${s.startTime}:00+05:30`, endsAt: `${s.date}T${s.endTime}:00+05:30`,
      kind: 'appointment', capacity: s.capacity, booked: s.booked, bookingOpen: s.status === 'open',
      slotType: s.slotType ?? 'approval_required', waitlistEnabled: s.waitlistEnabled ?? true,
      approvalResponseWindowMinutes: s.approvalResponseWindowMinutes ?? 240, recoveryPolicy: s.recoveryPolicy ?? 'offer_alternatives',
      expiresAt: s.approvalDeadline ?? null, updatedAt: s.updatedAt ?? new Date().toISOString(), source: 'demo_simulated',
    }));
    const created = load().operationalSlots.filter((s) => !hospitalId || s.hospitalId === hospitalId);
    return [...seeded, ...created].map((s) => ({ ...s }));
  },

  async createOperationalSlot(input: NewOperationalSlot) {
    const dept = (await demoRepo.listOperationalDepartments()).find((d) => d.id === input.departmentId);
    if (!dept) throw new Error('NOT_FOUND');
    const hospitalId = dept.hospitalId;
    const row: OperationalSlot = { id: uid('slot'), hospitalId, departmentId: input.departmentId, providerId: input.providerId ?? null,
      serviceSlug: input.serviceSlug ?? null, startsAt: input.startsAt, endsAt: input.endsAt, kind: input.kind ?? 'appointment',
      capacity: input.capacity, booked: 0, bookingOpen: input.bookingOpen ?? true, slotType: input.slotType,
      waitlistEnabled: input.waitlistEnabled ?? input.slotType === 'waitlist', approvalResponseWindowMinutes: input.approvalResponseWindowMinutes ?? 240,
      recoveryPolicy: input.recoveryPolicy ?? 'offer_alternatives', expiresAt: input.expiresAt ?? null,
      updatedAt: new Date().toISOString(), source: 'demo_simulated' };
    load().operationalSlots.push(row); save(); return { ...row };
  },

  async updateOperationalSlot(id, patch) {
    const existing = (await demoRepo.listOperationalSlots()).find((s) => s.id === id);
    if (!existing) throw new Error('NOT_FOUND');
    if (id.startsWith('slot-') && !load().operationalSlots.some((s) => s.id === id)) throw new Error('DEMO_SEED_READ_ONLY');
    const row = { ...existing, ...patch, updatedAt: new Date().toISOString() } as OperationalSlot;
    const index = load().operationalSlots.findIndex((s) => s.id === id);
    if (index >= 0) load().operationalSlots[index] = row;
    else load().operationalSlots.push(row);
    save(); return { ...row };
  },

  async listQueueEntries(filters: QueueListFilters = {}) {
    const s = load();
    let entries = s.queueEntries;
    if (filters.hospitalId) entries = entries.filter((e) => e.hospitalId === filters.hospitalId);
    if (filters.departmentId) entries = entries.filter((e) => e.departmentId === filters.departmentId);
    if (filters.status) entries = entries.filter((e) => e.status === filters.status);
    return { entries: entries.slice().sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt)), source: 'demo_simulated' as const, updatedAt: new Date().toISOString(), staleAfterMinutes: 5 };
  },

  async expireDueCareRequests() {
    const due = load().careRequests.filter((r) => r.state === 'APPROVAL_PENDING' && r.approvalDeadline && new Date(r.approvalDeadline) <= new Date());
    let count = 0;
    for (const row of due) {
      try { await demoRepo.transitionCareRequest({ careRequestId: row.id, action: 'expire_approval', actorId: row.patientId, actorRole: 'system', actor: 'system', expectedVersion: row.version, reason: 'Approval deadline passed without a hospital decision.', metadata: { reason: 'hospital_no_response' } }); count += 1; } catch { /* another worker may have won the version race */ }
    }
    return count;
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
