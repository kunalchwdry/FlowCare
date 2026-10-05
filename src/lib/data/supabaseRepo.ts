/**
 * Supabase implementation of the discovery Repo.
 *
 * The Care Access portion is implemented against the additive schema in
 * supabase/migrations and has been exercised against the configured project.
 * Discovery methods use the linked project's verified legacy vocabulary via
 * liveRepo; this avoids silently selecting reconstructed columns.
 *
 * Every ordinary read goes through the RLS-scoped request client. Only system
 * Care Access transitions and explicitly administrative writes use the
 * service-role client, and only after the route handler has verified the
 * caller's role.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CareAccessMetrics, CareAccessOption, CareAccessRequest, CareAccessTransitionInput, CareEpisode,
  CareStateTransition, CareTask, CapacitySignal, NewCareAccessRequest, NewCareTask,
  QueueEntry,
} from '@/lib/careAccess/types';
import type { NewOperationalDepartment, NewOperationalService, NewOperationalSlot, NewProvider, NewProviderSchedule, OperationalDepartment, OperationalService, OperationalSlot, Provider, ProviderSchedule, QueueListFilters } from '@/lib/operations/types';
import type {
  AuditEvent, CorrectionReview, FacilityFacts, NewCareContext, NewCorrection,
  NewFollowUpTask, NewReport, NewReview, NewVisitRecord, Repo,
} from './repo';
import { assertAdministrative } from '@/lib/journey/prep';
import { liveRepo } from './liveRepo';
import { fromDbStatus, idempotencyKey } from '@/lib/appointments/dbVocabulary';
import type {
  AccessibilityComponent, Appointment, ArrivalPack, CareContext, ClinicSession,
  FacilityCharge, FacilityCorrection, Favorite, FollowUpTask, Hospital,
  HospitalReview, LanguageSupport, ModerationEvent, PrepRequirement,
  Provenance, QueueSnapshot, ReviewReport, SchemeListing, ServiceVerification,
  VisitRecord, WayfindingRoute,
} from '@/lib/types';

type Row = Record<string, any>;

/**
 * Provenance is stored as five columns on every fact table rather than a
 * JSON blob, so that "show me everything not verified in 12 months" is an
 * index scan rather than a full-table JSON filter.
 */
function mapProvenance(r: Row): Provenance {
  return {
    source: r.source,
    sourceUrl: r.source_url ?? null,
    verifiedAt: r.verified_at ?? null,
    verifiedByRole: r.verified_by_role ?? null,
  };
}

function mapCareContext(r: Row): CareContext {
  return {
    id: r.id, ownerUserId: r.owner_user_id, label: r.label,
    accessibilityPrefs: r.accessibility_prefs ?? [],
    languagePrefs: r.language_prefs ?? [],
    transportMode: r.transport_mode ?? null,
    createdAt: r.created_at,
  };
}

function mapVisitRecord(r: Row): VisitRecord {
  return {
    id: r.id, ownerUserId: r.owner_user_id, careContextId: r.care_context_id ?? null,
    hospitalId: r.hospital_id, departmentId: r.department_id ?? null,
    visitDate: r.visit_date, createdAt: r.created_at,
  };
}

function mapFollowUpTask(r: Row): FollowUpTask {
  return {
    id: r.id, ownerUserId: r.owner_user_id, careContextId: r.care_context_id ?? null,
    hospitalId: r.hospital_id ?? null, departmentId: r.department_id ?? null,
    taskType: r.task_type, dueDate: r.due_date, status: r.status, createdAt: r.created_at,
  };
}

function mapCorrection(r: Row): FacilityCorrection {
  return {
    id: r.id, hospitalId: r.hospital_id, fieldCode: r.field_code,
    reportedByUserId: r.reported_by_user_id, claimedValue: r.claimed_value ?? null,
    evidenceKind: r.evidence_kind, note: r.note ?? null, status: r.status,
    reviewedByUserId: r.reviewed_by_user_id ?? null, reviewedAt: r.reviewed_at ?? null,
    outcome: r.outcome ?? null, createdAt: r.created_at,
  };
}

function mapCareRequest(r: Row): CareAccessRequest {
  return {
    id: r.id, patientId: r.patient_id, patientPhone: r.patient_phone ?? null, specialty: r.specialty ?? null,
    serviceType: r.service_type, location: r.location ?? null,
    preferredStartDate: r.preferred_start_date ?? null, preferredEndDate: r.preferred_end_date ?? null,
    preferredTimeRange: r.preferred_time_range ?? null, budgetConstraint: r.budget_constraint ?? null,
    accessibilityRequirements: r.accessibility_requirements ?? [], languagePreference: r.language_preference ?? [],
    coverage: r.coverage ?? null, referralRequired: r.referral_required ?? null, state: r.state,
    slotType: r.slot_type ?? null, queueId: r.queue_id ?? null, queuePosition: r.queue_position ?? null,
    approvalDeadline: r.approval_deadline ?? null, approvalResponseWindowMinutes: r.approval_response_window_minutes ?? null,
    recoveryPolicy: r.recovery_policy ?? null, selectedHospitalId: r.selected_hospital_id ?? null, selectedOptionId: r.selected_option_id ?? null,
    appointmentId: r.appointment_id ?? null, episodeId: r.episode_id ?? null, version: r.version ?? 1,
    createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at ?? null,
  };
}

function mapCareOption(r: Row): CareAccessOption {
  return {
    id: r.id, careRequestId: r.care_request_id, hospitalId: r.hospital_id,
    hospitalName: r.hospital_name ?? 'Hospital', departmentId: r.department_id ?? null,
    departmentName: r.department_name ?? null, providerId: r.provider_id ?? null, providerName: r.provider_name ?? null,
    serviceSlug: r.service_slug ?? null, sessionId: r.session_id ?? null, slotType: r.slot_type ?? null,
    approvalRequired: r.approval_required == null ? undefined : Boolean(r.approval_required), waitlistEnabled: r.waitlist_enabled == null ? undefined : Boolean(r.waitlist_enabled),
    approvalDeadline: r.approval_deadline ?? null, slotLabel: r.slot_label ?? null, distanceKm: r.distance_km == null ? null : Number(r.distance_km),
    queueWaitMinutes: r.queue_wait_minutes ?? null, queueObservedAt: r.queue_observed_at ?? null,
    costBand: r.cost_band ?? null, costVerifiedAt: r.cost_verified_at ?? null,
    accessibility: r.accessibility ?? [], languages: r.languages ?? [], capabilityMatched: Boolean(r.capability_matched),
    eligible: Boolean(r.eligible), freshness: r.freshness, freshnessLabel: r.freshness_label,
    reasons: Array.isArray(r.reasons) ? r.reasons : [], status: r.status,
    offeredAt: r.offered_at, expiresAt: r.expires_at ?? null, selectedAt: r.selected_at ?? null,
  };
}

function mapCareEpisode(r: Row): CareEpisode {
  return { id: r.id, careRequestId: r.care_request_id, patientId: r.patient_id, hospitalId: r.hospital_id ?? null,
    appointmentId: r.appointment_id ?? null, followUpRequired: Boolean(r.follow_up_required),
    followUpCompleted: Boolean(r.follow_up_completed), createdAt: r.created_at, closedAt: r.closed_at ?? null };
}

function mapCareTask(r: Row): CareTask {
  return { id: r.id, careRequestId: r.care_request_id, episodeId: r.episode_id ?? null, patientId: r.patient_id,
    hospitalId: r.hospital_id ?? null, ownerType: r.owner_type, ownerId: r.owner_id ?? null, taskType: r.task_type,
    title: r.title, description: r.description ?? null, status: r.status, deadline: r.deadline ?? null,
    resolution: r.resolution ?? null, createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at ?? null };
}

function mapCapacitySignal(r: Row): CapacitySignal {
  return { id: r.id, hospitalId: r.hospital_id, serviceSlug: r.service_slug ?? null,
    available: r.available ?? null, queueWaitMinutes: r.queue_wait_minutes ?? null, waitingCount: r.waiting_count ?? null,
    note: r.note ?? null, source: r.source, updatedAt: r.updated_at, expiresAt: r.expires_at ?? null };
}

function mapOperationalDepartment(r: Row): OperationalDepartment {
  return { id: r.id, hospitalId: r.hospital_id, name: r.name, bookingOpen: Boolean(r.booking_open),
    consultationCapacity: Number(r.consultation_capacity), noShowGraceMinutes: r.no_show_grace_minutes ?? null,
    approvalResponseWindowMinutes: Number(r.approval_response_window_minutes ?? 240), waitlistEnabled: Boolean(r.waitlist_enabled ?? true),
    recoveryPolicy: r.recovery_policy ?? 'offer_alternatives', queueOrderRule: r.queue_order_rule ?? 'arrival_order' };
}
function mapOperationalService(r: Row): OperationalService {
  return { id: r.id, hospitalId: r.departments?.hospital_id ?? r.hospital_id, departmentId: r.department_id, serviceSlug: r.service_slug, label: r.label, active: Boolean(r.active), source: r.source ?? 'hospital_configured' };
}
function mapProvider(r: Row): Provider {
  return { id: r.id, hospitalId: r.hospital_id, departmentId: r.department_id, name: r.name,
    specialty: r.specialty ?? null, qualification: r.qualification ?? null, active: Boolean(r.active) };
}
function mapProviderSchedule(r: Row): ProviderSchedule {
  return { id: r.id, providerId: r.provider_id, weekday: Number(r.weekday), startsAt: r.starts_at,
    endsAt: r.ends_at, timezone: r.timezone, active: Boolean(r.active) };
}
function mapOperationalSlot(r: Row): OperationalSlot {
  const booked = Number(r.booked ?? 0);
  return { id: r.id, hospitalId: r.hospital_id ?? r.departments?.hospital_id, departmentId: r.department_id,
    providerId: r.provider_id ?? null, serviceSlug: r.service_slug ?? null, startsAt: r.starts_at, endsAt: r.ends_at,
    kind: r.kind, capacity: Number(r.capacity), booked, bookingOpen: Boolean(r.booking_open), slotType: r.slot_type ?? 'approval_required',
    waitlistEnabled: Boolean(r.waitlist_enabled), approvalResponseWindowMinutes: Number(r.approval_response_window_minutes ?? 240),
    recoveryPolicy: r.recovery_policy ?? 'offer_alternatives', expiresAt: r.expires_at ?? null,
    updatedAt: r.updated_at ?? r.starts_at, source: 'database' };
}
function mapQueueEntry(r: Row): QueueEntry {
  return { id: r.id, queueId: r.queue_id, careRequestId: r.care_request_id ?? null, appointmentId: r.appointment_id ?? null,
    patientId: r.patient_id, hospitalId: r.hospital_id, departmentId: r.department_id, providerId: r.provider_id ?? null,
    slotId: r.slot_id ?? null, queueType: r.queue_type, status: r.status, position: r.position ?? null,
    estimatedSlotAt: r.estimated_slot_at ?? null, lastUpdatedAt: r.last_updated_at, createdAt: r.created_at };
}

const PROVENANCE_COLS = 'source, source_url, verified_at, verified_by_role';


function mapHospital(r: Row): Hospital {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    type: r.type,
    addressLine: r.address_line,
    city: r.city,
    state: r.state,
    postalCode: r.postal_code,
    location: { lat: Number(r.latitude), lng: Number(r.longitude) },
    phone: r.phone,
    website: r.website,
    flowcareVerified: Boolean(r.flowcare_verified),
    onboardedAt: r.onboarded_at,
    departments: (r.hospital_departments ?? []).map((d: Row) => ({
      id: d.id, hospitalId: r.id, specialty: d.specialty, name: d.name, active: d.active,
    })),
    services: (r.hospital_services ?? []).map((s: Row) => ({
      id: s.id, hospitalId: r.id, slug: s.slug, name: s.name,
    })),
    accessibility: r.accessibility ?? [],
    languages: r.languages ?? [],
    operatingHours: r.operating_hours ?? {},
    emergencyServices: Boolean(r.emergency_services),
    bedCount: r.bed_count,
    description: r.description,
    placeLink: r.hospital_external_places?.[0]
      ? {
          hospitalId: r.id,
          placeId: r.hospital_external_places[0].google_place_id,
          matchMethod: r.hospital_external_places[0].match_method,
          matchConfidence: r.hospital_external_places[0].match_confidence,
          verifiedBy: r.hospital_external_places[0].verified_by,
          verifiedAt: r.hospital_external_places[0].verified_at,
          cachedLat: r.hospital_external_places[0].cached_lat,
          cachedLng: r.hospital_external_places[0].cached_lng,
          cachedCoordsAt: r.hospital_external_places[0].cached_coords_at,
        }
      : null,
    isDemoRecord: false,
  };
}

function mapReview(r: Row): HospitalReview {
  return {
    id: r.id,
    hospitalId: r.hospital_id,
    authorId: r.author_id,
    authorHandle: r.author_handle,
    appointmentId: r.appointment_id,
    ratings: {
      overall: r.rating_overall, waiting: r.rating_waiting, staff: r.rating_staff,
      appointment: r.rating_appointment, facility: r.rating_facility,
    },
    comment: r.comment,
    createdAt: r.created_at,
    status: r.status,
    verifiedVisit: true,
    helpfulCount: r.helpful_count ?? 0,
  };
}

const HOSPITAL_SELECT = `
  id, slug, name, type, address_line, city, state, postal_code, latitude, longitude,
  phone, website, flowcare_verified, onboarded_at, accessibility, languages,
  operating_hours, emergency_services, bed_count, description,
  hospital_departments ( id, specialty, name, active ),
  hospital_services ( id, slug, name ),
  hospital_external_places ( google_place_id, match_method, match_confidence, verified_by, verified_at, cached_lat, cached_lng, cached_coords_at )
`;

export function createSupabaseRepo(
  client: SupabaseClient,
  adminClient: SupabaseClient | null,
): Repo {
  const must = <T>(res: { data: T | null; error: any }): T => {
    if (res.error) throw new Error(`supabase: ${res.error.message}`);
    return (res.data ?? []) as T;
  };

  return {
    kind: 'supabase',

    /** The linked project owns appointment state; reuse its verified RPC adapter. */
    async transitionAppointment(input) {
      return liveRepo.transitionAppointment(input);
    },
    async listAppointmentEvents(appointmentId) {
      return liveRepo.listAppointmentEvents(appointmentId);
    },
    async listAppointmentMessages(appointmentId) {
      return liveRepo.listAppointmentMessages(appointmentId);
    },
    async sendAppointmentMessage(input) {
      return liveRepo.sendAppointmentMessage(input);
    },
    async listNotifications() {
      return [];
    },
    async markNotificationsRead() {
      /* no notifications table in the live project yet — migration 0009 */
    },

    /* --------------------------------------------- care access exchange */
    async listCareRequests({ patientId, hospitalId }) {
      let q = client.from('care_requests').select('*').order('updated_at', { ascending: false });
      if (patientId) q = q.eq('patient_id', patientId);
      if (hospitalId) q = q.eq('selected_hospital_id', hospitalId);
      return must<Row[]>(await q).map(mapCareRequest);
    },

    async getCareRequest(id) {
      const res = await client.from('care_requests').select('*').eq('id', id).maybeSingle();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return res.data ? mapCareRequest(res.data) : null;
    },

    async createCareRequest(input: NewCareAccessRequest) {
      const res = await client.rpc('create_care_request', {
        p_specialty: input.specialty ?? null, p_service_type: input.serviceType,
        p_location: input.location ?? null, p_start: input.preferredStartDate ?? null,
        p_end: input.preferredEndDate ?? null, p_time_range: input.preferredTimeRange ?? null,
        p_budget: input.budgetConstraint ?? null, p_accessibility: input.accessibilityRequirements ?? [],
        p_languages: input.languagePreference ?? [], p_coverage: input.coverage ?? null,
        p_referral_required: input.referralRequired ?? null,
      });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapCareRequest(res.data as Row);
    },

    async listCareOptions(careRequestId) {
      const res = await client.from('care_access_options')
        .select('*, hospitals(name), departments(name)')
        .eq('care_request_id', careRequestId).order('eligible', { ascending: false });
      return must<Row[]>(res).map((r) => mapCareOption({
        ...r, hospital_name: r.hospitals?.name, department_name: r.departments?.name,
      }));
    },

    async saveCareOptions(careRequestId, options) {
      const res = await client.rpc('save_care_access_options', {
        p_request: careRequestId,
        p_options: options.map((o) => ({
          hospital_id: o.hospitalId, department_id: o.departmentId, session_id: o.sessionId,
          provider_id: o.providerId, service_slug: o.serviceSlug, slot_type: o.slotType,
          approval_required: o.approvalRequired, waitlist_enabled: o.waitlistEnabled, approval_deadline: o.approvalDeadline,
          distance_km: o.distanceKm, queue_wait_minutes: o.queueWaitMinutes, queue_observed_at: o.queueObservedAt,
          cost_band: o.costBand, cost_verified_at: o.costVerifiedAt, accessibility: o.accessibility,
          languages: o.languages, capability_matched: o.capabilityMatched, eligible: o.eligible,
          freshness: o.freshness, freshness_label: o.freshnessLabel, reasons: o.reasons,
          status: o.status, offered_at: o.offeredAt, expires_at: o.expiresAt,
        })),
      });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return (Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean).map((r: Row) => mapCareOption(r));
    },

    async transitionCareRequest(input) {
      if (input.actor === 'system') {
        if (!adminClient) throw new Error('CARE_ACCESS_SYSTEM_ACTION_UNAVAILABLE');
        let patientId = typeof input.metadata?.patientId === 'string' ? input.metadata.patientId : null;
        if (!patientId) patientId = (await this.getCareRequest(input.careRequestId))?.patientId ?? null;
        if (!patientId) throw new Error('NOT_FOUND');
        const system = await adminClient.rpc('transition_care_request_system', {
          p_id: input.careRequestId, p_actor: patientId, p_action: input.action,
          p_option: input.optionId ?? null, p_appointment: input.appointmentId ?? null,
          p_reason: input.reason ?? null, p_metadata: input.metadata ?? {},
          p_expected_version: input.expectedVersion ?? null,
        });
        if (system.error) throw new Error(`supabase: ${system.error.message}`);
        return mapCareRequest(system.data as Row);
      }
      const res = await client.rpc('transition_care_request', {
        p_id: input.careRequestId, p_action: input.action, p_option: input.optionId ?? null,
        p_appointment: input.appointmentId ?? null, p_reason: input.reason ?? null,
        p_metadata: input.metadata ?? {}, p_expected_version: input.expectedVersion ?? null,
      });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapCareRequest(res.data as Row);
    },

    async listCareTransitions(careRequestId) {
      const res = await client.from('care_state_transitions').select('*')
        .eq('care_request_id', careRequestId).order('created_at', { ascending: true });
      return must<Row[]>(res).map((r): CareStateTransition => ({
        id: String(r.id), careRequestId: r.care_request_id, previousState: r.previous_state ?? null,
        newState: r.new_state, action: r.action, actorId: r.actor_id ?? null, actorRole: r.actor_role,
        reason: r.reason ?? null, metadata: r.metadata ?? {}, createdAt: r.created_at,
      }));
    },

    async listCareEpisodes({ patientId, hospitalId }) {
      let q = client.from('care_episodes').select('*').order('created_at', { ascending: false });
      if (patientId) q = q.eq('patient_id', patientId);
      if (hospitalId) q = q.eq('hospital_id', hospitalId);
      return must<Row[]>(await q).map(mapCareEpisode);
    },

    async listCareTasks({ patientId, hospitalId, careRequestId }) {
      let q = client.from('care_tasks').select('*').order('updated_at', { ascending: false });
      if (patientId) q = q.eq('patient_id', patientId);
      if (hospitalId) q = q.eq('hospital_id', hospitalId);
      if (careRequestId) q = q.eq('care_request_id', careRequestId);
      return must<Row[]>(await q).map(mapCareTask);
    },

    async createCareTask(input: NewCareTask) {
      const res = await client.rpc('create_care_task', {
        p_request: input.careRequestId, p_episode: input.episodeId ?? null, p_patient: input.patientId,
        p_hospital: input.hospitalId ?? null, p_owner_type: input.ownerType, p_owner: input.ownerId ?? null,
        p_task_type: input.taskType, p_title: input.title, p_description: input.description ?? null,
        p_deadline: input.deadline ?? null,
      });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapCareTask(res.data as Row);
    },

    async updateCareTask(id, _actorId, status, resolution = null) {
      const res = await client.rpc('update_care_task', { p_id: id, p_status: status, p_resolution: resolution ?? null });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapCareTask(res.data as Row);
    },

    async listCapacitySignals(hospitalIds) {
      let q = client.from('hospital_capacity_signals').select('*').order('updated_at', { ascending: false });
      if (hospitalIds?.length) q = q.in('hospital_id', hospitalIds);
      return must<Row[]>(await q).map(mapCapacitySignal);
    },

    async publishCapacitySignal(input) {
      const res = await client.rpc('publish_capacity_signal', {
        p_hospital: input.hospitalId, p_service: input.serviceSlug ?? null, p_available: input.available ?? null,
        p_wait: input.queueWaitMinutes ?? null, p_waiting: input.waitingCount ?? null,
        p_note: input.note ?? null, p_expires: input.expiresAt ?? null,
      });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapCapacitySignal(res.data as Row);
    },

    async getCareAccessMetrics(hospitalId) {
      const source = hospitalId ? client : (adminClient ?? client);
      let requestQuery = source.from('care_requests').select('*').order('updated_at', { ascending: false });
      if (hospitalId) requestQuery = requestQuery.eq('selected_hospital_id', hospitalId);
      const requestRows = must<Row[]>(await requestQuery);
      const requests = requestRows.map(mapCareRequest);
      const signals = await this.listCapacitySignals(hospitalId ? [hospitalId] : undefined);
      const closed = requests.filter((r) => r.state === 'CLOSED').length;
      return {
        total: requests.length, closed, closureRate: requests.length ? Math.round((closed / requests.length) * 100) : null,
        averageAcknowledgementMinutes: null, averageBookingMinutes: null,
        unresolved: requests.filter((r) => !['CLOSED', 'CANCELLED', 'NO_SHOW'].includes(r.state)).length,
        staleCapacitySignals: signals.filter((s) => s.expiresAt && new Date(s.expiresAt) <= new Date()).length,
        cancellations: requests.filter((r) => r.state === 'CANCELLED').length,
        noShows: requests.filter((r) => r.state === 'NO_SHOW').length,
        followUpsOpen: requests.filter((r) => r.state === 'FOLLOW_UP_OPEN').length,
        pendingApprovals: requests.filter((r) => r.state === 'APPROVAL_PENDING').length,
        approvalExpired: requests.filter((r) => r.state === 'APPROVAL_EXPIRED').length,
        waitlisted: requests.filter((r) => r.state === 'WAITLISTED').length,
        recoveryRequired: requests.filter((r) => ['RECOVERY_REQUIRED','RECOVERY_OPTIONS_AVAILABLE'].includes(r.state)).length,
      } satisfies CareAccessMetrics;
    },

    async listOperationalDepartments(hospitalId) {
      let q = client.from('departments').select('*').order('name');
      if (hospitalId) q = q.eq('hospital_id', hospitalId);
      return must<Row[]>(await q).map(mapOperationalDepartment);
    },

    async createOperationalDepartment(input: NewOperationalDepartment) {
      const res = await client.rpc('create_operational_department', {
        p_hospital: input.hospitalId, p_name: input.name, p_booking_open: input.bookingOpen ?? true,
        p_consultation_capacity: input.consultationCapacity ?? 4, p_no_show_grace_minutes: input.noShowGraceMinutes ?? 30,
        p_approval_response_window_minutes: input.approvalResponseWindowMinutes ?? 240,
        p_waitlist_enabled: input.waitlistEnabled ?? true, p_recovery_policy: input.recoveryPolicy ?? 'offer_alternatives',
        p_queue_order_rule: input.queueOrderRule ?? 'arrival_order',
      });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapOperationalDepartment(res.data as Row);
    },

    async listOperationalServices(hospitalId) {
      let q = client.from('department_services').select('*, departments(hospital_id)').order('label');
      if (hospitalId) {
        const departments = await this.listOperationalDepartments(hospitalId);
        if (!departments.length) return [];
        q = q.in('department_id', departments.map((d) => d.id));
      }
      return must<Row[]>(await q).map(mapOperationalService);
    },

    async createOperationalService(input: NewOperationalService) {
      const dept = await client.from('departments').select('hospital_id').eq('id', input.departmentId).maybeSingle();
      if (dept.error || !dept.data) throw new Error('NOT_FOUND');
      const res = await client.rpc('create_department_service', { p_department: input.departmentId, p_service_slug: input.serviceSlug, p_label: input.label, p_active: input.active ?? true });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapOperationalService({ ...(res.data as Row), hospital_id: dept.data.hospital_id });
    },

    async listProviders(hospitalId) {
      let q = client.from('providers').select('*').order('name');
      if (hospitalId) q = q.eq('hospital_id', hospitalId);
      return must<Row[]>(await q).map(mapProvider);
    },

    async createProvider(input: NewProvider) {
      const res = await client.rpc('create_provider', {
        p_hospital: input.hospitalId, p_department: input.departmentId, p_name: input.name,
        p_specialty: input.specialty ?? null, p_qualification: input.qualification ?? null, p_active: input.active ?? true,
      });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapProvider(res.data as Row);
    },

    async listProviderSchedules(providerId) {
      let q = client.from('provider_schedules').select('*').order('weekday');
      if (providerId) q = q.eq('provider_id', providerId);
      return must<Row[]>(await q).map(mapProviderSchedule);
    },

    async createProviderSchedule(input: NewProviderSchedule) {
      const res = await client.rpc('create_provider_schedule', {
        p_provider: input.providerId, p_weekday: input.weekday, p_starts: input.startsAt, p_ends: input.endsAt,
        p_timezone: input.timezone ?? 'Asia/Kolkata', p_active: input.active ?? true,
      });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapProviderSchedule(res.data as Row);
    },

    async listOperationalSlots(hospitalId) {
      let q = client.from('slots').select('*, departments(hospital_id)').order('starts_at');
      if (hospitalId) {
        const departments = await this.listOperationalDepartments(hospitalId);
        if (!departments.length) return [];
        q = q.in('department_id', departments.map((d) => d.id));
      }
      const rows = must<Row[]>(await q);
      const ids = rows.map((r) => r.id);
      const booked = new Map<string, number>();
      if (ids.length) {
        const appointments = must<Row[]>(await client.from('appointments').select('slot_id,status').in('slot_id', ids));
        for (const a of appointments) if (!['cancelled','denied','no_show'].includes(a.status)) booked.set(a.slot_id, (booked.get(a.slot_id) ?? 0) + 1);
      }
      return rows.map((r) => mapOperationalSlot({ ...r, booked: booked.get(r.id) ?? 0 }));
    },

    async createOperationalSlot(input: NewOperationalSlot) {
      const res = await client.rpc('create_operational_slot', {
        p_department: input.departmentId, p_starts: input.startsAt, p_ends: input.endsAt, p_capacity: input.capacity,
        p_slot_type: input.slotType, p_provider: input.providerId ?? null, p_service_slug: input.serviceSlug ?? null,
        p_kind: input.kind ?? 'appointment', p_booking_open: input.bookingOpen ?? true,
        p_waitlist_enabled: input.waitlistEnabled ?? input.slotType === 'waitlist',
        p_approval_response_window_minutes: input.approvalResponseWindowMinutes ?? 240,
        p_recovery_policy: input.recoveryPolicy ?? 'offer_alternatives', p_expires_at: input.expiresAt ?? null,
      });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      const row = mapOperationalSlot(res.data as Row);
      const dept = await client.from('departments').select('hospital_id').eq('id', row.departmentId).maybeSingle();
      return mapOperationalSlot({ ...(res.data as Row), hospital_id: dept.data?.hospital_id, booked: 0 });
    },

    async updateOperationalSlot(id, patch) {
      const res = await client.rpc('update_operational_slot', {
        p_id: id, p_booking_open: patch.bookingOpen ?? null, p_capacity: patch.capacity ?? null,
        p_slot_type: patch.slotType ?? null, p_waitlist_enabled: patch.waitlistEnabled ?? null,
        p_approval_response_window_minutes: patch.approvalResponseWindowMinutes ?? null,
        p_recovery_policy: patch.recoveryPolicy ?? null, p_expires_at: patch.expiresAt ?? null,
      });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapOperationalSlot(res.data as Row);
    },

    async listQueueEntries(filters: QueueListFilters = {}) {
      let q = client.from('queue_entries').select('*').order('last_updated_at', { ascending: false });
      if (filters.hospitalId) q = q.eq('hospital_id', filters.hospitalId);
      if (filters.departmentId) q = q.eq('department_id', filters.departmentId);
      if (filters.status) q = q.eq('status', filters.status);
      const rows = must<Row[]>(await q);
      return { entries: rows.map(mapQueueEntry), source: 'database' as const, updatedAt: new Date().toISOString(), staleAfterMinutes: 5 };
    },

    async expireDueCareRequests() {
      if (!adminClient) throw new Error('CARE_ACCESS_SYSTEM_ACTION_UNAVAILABLE');
      const res = await adminClient.rpc('expire_due_approvals');
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return Number(res.data ?? 0);
    },

    // The linked project uses the pre-MVP facility vocabulary (`published`,
    // `address`, `lat`, `departments`, `slots`), not the reconstructed
    // `active`/`hospital_departments`/`clinic_sessions` vocabulary that this
    // adapter originally selected. Reuse the verified live facility mapper
    // so a full Supabase request does not turn a public directory into 500.
    async listHospitals() {
      return liveRepo.listHospitals();
    },

    async getHospital(idOrSlug) {
      return liveRepo.getHospital(idOrSlug);
    },

    async listSessions(hospitalIds) {
      return liveRepo.listSessions(hospitalIds);
    },

    async listQueues() {
      return [];
    },

    async listPatientTraffic(hospitalIds, options) {
      // The RPC is SECURITY DEFINER and applies the public/staff scope. Keep
      // the mapping in liveRepo so both repository modes expose one shape.
      return liveRepo.listPatientTraffic(hospitalIds, options);
    },

    async listReviews(opts) {
      let q = client.from('hospital_reviews').select('*').order('created_at', { ascending: false });
      if (opts?.hospitalId) q = q.eq('hospital_id', opts.hospitalId);
      if (!opts?.includeNonPublished) q = q.eq('status', 'published');
      return must<Row[]>(await q).map(mapReview);
    },

    async listAppointments(args) {
      return liveRepo.listAppointments(args);
    },

    async getAppointment(id: string) {
      return liveRepo.getAppointment(id);
    },
    async getPatientReliability(patientId: string) {
      return liveRepo.getPatientReliability(patientId);
    },
    async listVerifiedVisits(patientId: string) {
      return liveRepo.listVerifiedVisits(patientId);
    },
    async getHospitalPatientProfile(appointmentId: string, hospitalId?: string) {
      return liveRepo.getHospitalPatientProfile(appointmentId, hospitalId);
    },

    /** Book against the live `slots` table through its SECURITY DEFINER RPC. */
    async requestAppointment(input): Promise<Appointment> {
      const { data: auth } = await client.auth.getUser();
      if (!auth?.user) throw new Error('AUTH_REQUIRED');
      const name =
        (auth.user.user_metadata?.full_name as string | undefined)?.trim() ||
        auth.user.email || 'Patient';
      const res = await client.rpc('book_appointment', {
        p_slot: input.sessionId,
        p_name: name.slice(0, 120),
        p_key: idempotencyKey(['book', input.sessionId, auth.user.id]),
        p_request_note: input.reason ?? null,
      });
      if (res.error) {
        const message = String(res.error.message ?? 'BOOKING_FAILED');
        for (const code of ['NOT_FOUND', 'BOOKING_CLOSED', 'CAPACITY_FULL', 'AUTH_REQUIRED'] as const) {
          if (message.includes(code)) throw new Error(code);
        }
        throw new Error('BOOKING_FAILED');
      }
      const row = (Array.isArray(res.data) ? res.data[0] : res.data) as Row;
      if (!row?.id) throw new Error('BOOKING_FAILED');
      const slot = await client.from('slots').select('starts_at').eq('id', row.slot_id ?? input.sessionId).maybeSingle();
      if (slot.error) throw new Error(`supabase: ${slot.error.message}`);
      return {
        id: String(row.id), hospitalId: String(row.hospital_id), patientId: String(row.patient_id),
        patientName: row.patient_name ?? name, departmentId: String(row.department_id),
        sessionId: String(row.slot_id ?? input.sessionId), scheduledFor: String(slot.data?.starts_at ?? row.created_at),
        status: fromDbStatus(String(row.status)), completedAt: row.status === 'completed' ? String(row.created_at) : null,
        reason: input.reason ?? null, requestedAt: String(row.created_at), queueId: row.queue_id ?? null,
        slotType: row.slot_type ?? null, approvalDeadline: row.approval_deadline ?? null, approvalStatus: row.approval_status ?? 'not_required', version: Number(row.version ?? 1),
      };
    },

    async createReview(input: NewReview) {
      const res = await client.from('hospital_reviews').insert({
        hospital_id: input.hospitalId,
        author_id: input.authorId,
        author_handle: input.authorHandle,
        appointment_id: input.appointmentId,
        rating_overall: input.ratings.overall,
        rating_waiting: input.ratings.waiting,
        rating_staff: input.ratings.staff,
        rating_appointment: input.ratings.appointment,
        rating_facility: input.ratings.facility,
        comment: input.comment,
        status: input.status,
      }).select('*').single();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapReview(res.data);
    },

    async getReview(id) {
      const res = await client.from('hospital_reviews').select('*').eq('id', id).maybeSingle();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return res.data ? mapReview(res.data) : null;
    },

    async setReviewStatus(id, status) {
      const c = adminClient ?? client;
      const res = await c.from('hospital_reviews').update({ status }).eq('id', id);
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
    },

    async listFavorites(userId) {
      const res = await client.from('hospital_favorites')
        .select('hospital_id, user_id, note, created_at').eq('user_id', userId);
      return must<Row[]>(res).map((r): Favorite => ({
        hospitalId: r.hospital_id, userId: r.user_id, note: r.note, createdAt: r.created_at,
      }));
    },

    async addFavorite(userId, hospitalId, note = null) {
      const res = await client.from('hospital_favorites')
        .upsert({ user_id: userId, hospital_id: hospitalId, note }, { onConflict: 'user_id,hospital_id' })
        .select('hospital_id, user_id, note, created_at').single();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return { hospitalId: res.data.hospital_id, userId: res.data.user_id, note: res.data.note, createdAt: res.data.created_at };
    },

    async removeFavorite(userId, hospitalId) {
      const res = await client.from('hospital_favorites').delete().eq('user_id', userId).eq('hospital_id', hospitalId);
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
    },

    async createReport(input: NewReport) {
      const res = await client.from('review_reports').insert({
        review_id: input.reviewId, reporter_id: input.reporterId,
        reason: input.reason, detail: input.detail,
      }).select('*').single();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      const r = res.data;
      return { id: r.id, reviewId: r.review_id, reporterId: r.reporter_id, reason: r.reason, detail: r.detail, createdAt: r.created_at, status: r.status };
    },

    async listReports(status) {
      const c = adminClient ?? client;
      let q = c.from('review_reports').select('*');
      if (status) q = q.eq('status', status);
      return must<Row[]>(await q).map((r) => ({
        id: r.id, reviewId: r.review_id, reporterId: r.reporter_id,
        reason: r.reason, detail: r.detail, createdAt: r.created_at, status: r.status,
      }));
    },

    async setReportStatus(id, status) {
      const c = adminClient ?? client;
      const res = await c.from('review_reports').update({ status }).eq('id', id);
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
    },

    async recordModerationEvent(e) {
      const c = adminClient ?? client;
      const res = await c.from('review_moderation_events').insert({
        review_id: e.reviewId, actor_id: e.actorId, actor_role: e.actorRole,
        action: e.action, reason: e.reason, ai_confidence: e.aiConfidence,
        previous_status: e.previousStatus, new_status: e.newStatus,
      }).select('*').single();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      const r = res.data;
      return {
        id: r.id, reviewId: r.review_id, actorId: r.actor_id, actorRole: r.actor_role,
        action: r.action, reason: r.reason, aiConfidence: r.ai_confidence,
        previousStatus: r.previous_status, newStatus: r.new_status, createdAt: r.created_at,
      } as ModerationEvent;
    },

    async listModerationEvents(reviewId) {
      const c = adminClient ?? client;
      let q = c.from('review_moderation_events').select('*').order('created_at', { ascending: false });
      if (reviewId) q = q.eq('review_id', reviewId);
      return must<Row[]>(await q).map((r) => ({
        id: r.id, reviewId: r.review_id, actorId: r.actor_id, actorRole: r.actor_role,
        action: r.action, reason: r.reason, aiConfidence: r.ai_confidence,
        previousStatus: r.previous_status, newStatus: r.new_status, createdAt: r.created_at,
      })) as ModerationEvent[];
    },

    async recordAuditEvent(e: AuditEvent) {
      const res = await client.rpc('record_audit_event', {
        p_actor_role: e.actorRole, p_action: e.action, p_entity: e.entity,
        p_entity_id: e.entityId, p_metadata: e.metadata,
      });
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
    },

    /* ================================================ journey layer ==== */

    async getFacilityFacts(hospitalId: string): Promise<FacilityFacts> {
      // Map the actual linked-project vocabulary. In particular, do not turn
      // an unverified/self-reported service into a hospital-confirmed claim.
      const [sv, sl, ch, ac, ls, ap, rt, pr] = await Promise.all([
        client.from('hospital_service_verifications').select('*').eq('hospital_id', hospitalId),
        client.from('hospital_scheme_listings').select('*').eq('hospital_id', hospitalId),
        client.from('hospital_charges').select('*').eq('hospital_id', hospitalId),
        client.from('hospital_accessibility_components').select('*').eq('hospital_id', hospitalId),
        client.from('hospital_language_support').select('*').eq('hospital_id', hospitalId),
        client.from('hospital_arrival_packs').select('*').eq('hospital_id', hospitalId).limit(1),
        client.from('hospital_wayfinding_routes').select('*').eq('hospital_id', hospitalId),
        client.from('hospital_prep_requirements').select('*').eq('hospital_id', hospitalId),
      ]);
      const packRow = must<Row[]>(ap)[0];

      return {
        hospitalId,
        serviceVerifications: must<Row[]>(sv).map((r): ServiceVerification => ({
          hospitalId: r.hospital_id, serviceSlug: r.service_slug,
          method: r.verification === 'hospital_confirmed' ? 'hospital_confirmed' : 'user_reported_pending',
          provenance: mapProvenance(r),
        })),
        schemeListings: must<Row[]>(sl).map((r): SchemeListing => ({
          hospitalId: r.hospital_id, schemeCode: r.scheme_code,
          schemeName: r.scheme_name ?? r.scheme_code,
          listingStatus: r.listing === 'listed' ? 'listed' : 'unknown',
          provenance: mapProvenance(r),
        })),
        charges: must<Row[]>(ch)
          .filter((r) => r.amount_inr != null)
          .map((r): FacilityCharge => ({
            hospitalId: r.hospital_id, chargeType: r.charge_type,
            amountMin: Number(r.amount_inr), amountMax: Number(r.amount_inr),
            currency: r.currency === 'INR' ? 'INR' : 'INR', isPublishedRange: true,
            provenance: mapProvenance(r),
          })),
        accessibilityComponents: must<Row[]>(ac).map((r): AccessibilityComponent => ({
          hospitalId: r.hospital_id, componentCode: r.component,
          status: r.status === 'present' ? 'present_below_standard' : 'not_assessed',
          standardReference: null, note: r.note ?? null, provenance: mapProvenance(r),
        })),
        languageSupport: must<Row[]>(ls).map((r): LanguageSupport => ({
          hospitalId: r.hospital_id, stage: r.support ?? 'facility',
          languages: r.language_code ? [r.language_code] : [], provenance: mapProvenance(r),
        })),
        arrivalPack: packRow ? ({
          hospitalId: packRow.hospital_id,
          gateLabel: null, gateNote: packRow.entrance_note ?? null,
          firstCounter: packRow.registration_note ?? null,
          buildingNote: packRow.opd_timing_note ?? null,
          parkingNote: null, dropoffNote: null, latePolicyText: null,
          arrivalGuidanceText: packRow.what_to_bring ?? null,
          provenance: mapProvenance(packRow),
        } as ArrivalPack) : null,
        routes: must<Row[]>(rt).map((r): WayfindingRoute => ({
          hospitalId: r.hospital_id, fromPoint: r.from_point, toPoint: r.to_point,
          locale: 'en-IN', steps: Array.isArray(r.steps) ? r.steps : [],
          stepFree: r.step_free ?? null, walkingMinutes: null, provenance: mapProvenance(r),
        })),
        prepRequirements: must<Row[]>(pr).map((r): PrepRequirement => ({
          hospitalId: r.hospital_id, departmentId: null, code: r.prep_code,
          text: r.detail, appliesTo: 'all', provenance: mapProvenance(r),
        })),
      };
    },

    async listServiceVerifications(hospitalIds) {
      let q = client.from('hospital_service_verifications')
        .select(`hospital_id, service_slug, method, ${PROVENANCE_COLS}`);
      if (hospitalIds?.length) q = q.in('hospital_id', hospitalIds);
      return must<Row[]>(await q).map((r): ServiceVerification => ({
        hospitalId: r.hospital_id, serviceSlug: r.service_slug, method: r.method,
        provenance: mapProvenance(r),
      }));
    },

    async listSchemeListings(hospitalIds) {
      let q = client.from('hospital_scheme_listings')
        .select(`hospital_id, scheme_code, scheme_name, listing_status, ${PROVENANCE_COLS}`);
      if (hospitalIds?.length) q = q.in('hospital_id', hospitalIds);
      return must<Row[]>(await q).map((r): SchemeListing => ({
        hospitalId: r.hospital_id, schemeCode: r.scheme_code, schemeName: r.scheme_name,
        listingStatus: r.listing_status, provenance: mapProvenance(r),
      }));
    },

    async listAccessibilityComponents(hospitalIds) {
      let q = client.from('hospital_accessibility_components')
        .select(`hospital_id, component_code, status, standard_reference, note, ${PROVENANCE_COLS}`);
      if (hospitalIds?.length) q = q.in('hospital_id', hospitalIds);
      return must<Row[]>(await q).map((r): AccessibilityComponent => ({
        hospitalId: r.hospital_id, componentCode: r.component_code, status: r.status,
        standardReference: r.standard_reference ?? null, note: r.note ?? null,
        provenance: mapProvenance(r),
      }));
    },

    /* -------------------------------------------------------- F3 ------ */
    // RLS on these tables restricts rows to auth.uid(); the explicit
    // owner_user_id filters below are belt-and-braces, not the control.

    async listCareContexts(ownerUserId) {
      const res = await client.from('care_contexts').select('*')
        .eq('owner_user_id', ownerUserId).order('created_at', { ascending: false });
      return must<Row[]>(res).map(mapCareContext);
    },

    async createCareContext(input: NewCareContext) {
      const res = await client.from('care_contexts').insert({
        owner_user_id: input.ownerUserId,
        label: input.label,
        accessibility_prefs: input.accessibilityPrefs,
        language_prefs: input.languagePrefs,
        transport_mode: input.transportMode,
      }).select('*').single();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapCareContext(res.data);
    },

    async deleteCareContext(ownerUserId, id) {
      const res = await client.from('care_contexts').delete()
        .eq('id', id).eq('owner_user_id', ownerUserId);
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
    },

    /* ------------------------------------------------------- F19 ------ */

    async listVisitRecords(ownerUserId) {
      const res = await client.from('visit_records').select('*')
        .eq('owner_user_id', ownerUserId).order('visit_date', { ascending: false });
      return must<Row[]>(res).map(mapVisitRecord);
    },

    async createVisitRecord(input: NewVisitRecord) {
      const res = await client.from('visit_records').insert({
        owner_user_id: input.ownerUserId,
        care_context_id: input.careContextId,
        hospital_id: input.hospitalId,
        department_id: input.departmentId,
        visit_date: input.visitDate,
      }).select('*').single();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapVisitRecord(res.data);
    },

    async deleteVisitRecord(ownerUserId, id) {
      const res = await client.from('visit_records').delete()
        .eq('id', id).eq('owner_user_id', ownerUserId);
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
    },

    async purgeVisitRecords(ownerUserId, olderThanIso) {
      const res = await client.from('visit_records').delete()
        .eq('owner_user_id', ownerUserId).lt('created_at', olderThanIso).select('id');
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return (res.data ?? []).length;
    },

    /* ------------------------------------------------------- F20 ------ */

    async listFollowUpTasks(ownerUserId) {
      const res = await client.from('follow_up_tasks').select('*')
        .eq('owner_user_id', ownerUserId).order('due_date', { ascending: true });
      return must<Row[]>(res).map(mapFollowUpTask);
    },

    async createFollowUpTask(input: NewFollowUpTask) {
      const res = await client.from('follow_up_tasks').insert({
        owner_user_id: input.ownerUserId,
        care_context_id: input.careContextId,
        hospital_id: input.hospitalId,
        department_id: input.departmentId,
        task_type: input.taskType,
        due_date: input.dueDate,
        status: 'open',
      }).select('*').single();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapFollowUpTask(res.data);
    },

    async setFollowUpStatus(ownerUserId, id, status) {
      const res = await client.from('follow_up_tasks').update({ status })
        .eq('id', id).eq('owner_user_id', ownerUserId);
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
    },

    async deleteFollowUpTask(ownerUserId, id) {
      const res = await client.from('follow_up_tasks').delete()
        .eq('id', id).eq('owner_user_id', ownerUserId);
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
    },

    /* ------------------------------------------------------- F17 ------ */

    async createCorrection(input: NewCorrection) {
      if (input.claimedValue) assertAdministrative(input.claimedValue);
      if (input.note) assertAdministrative(input.note);

      const res = await client.from('facility_corrections').insert({
        hospital_id: input.hospitalId,
        field_code: input.fieldCode,
        reported_by_user_id: input.reportedByUserId,
        claimed_value: input.claimedValue,
        evidence_kind: input.evidenceKind,
        note: input.note,
        // Never anything but pending/duplicate on insert. The DB additionally
        // enforces this with a CHECK constraint (see migration 0003).
        status: input.status === 'duplicate' ? 'duplicate' : 'pending',
      }).select('*').single();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapCorrection(res.data);
    },

    async listCorrections(opts = {}) {
      // Admins read through the service-role client; a reporter reads their
      // own rows through RLS.
      const c = opts.reportedByUserId ? client : adminClient ?? client;
      let q = c.from('facility_corrections').select('*')
        .order('created_at', { ascending: false });
      if (opts.hospitalId) q = q.eq('hospital_id', opts.hospitalId);
      if (opts.reportedByUserId) q = q.eq('reported_by_user_id', opts.reportedByUserId);
      if (opts.status) q = q.eq('status', opts.status);
      return must<Row[]>(await q).map(mapCorrection);
    },

    async getCorrection(id) {
      const c = adminClient ?? client;
      const res = await c.from('facility_corrections').select('*').eq('id', id).maybeSingle();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return res.data ? mapCorrection(res.data) : null;
    },

    async reviewCorrection(input: CorrectionReview) {
      // Service-role: the route handler has already checked the admin role.
      const c = adminClient ?? client;
      const res = await c.from('facility_corrections').update({
        status: input.decision,
        reviewed_by_user_id: input.reviewerUserId,
        reviewed_at: new Date().toISOString(),
        outcome: input.outcome,
      }).eq('id', input.correctionId).select('*').single();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      return mapCorrection(res.data);
    },
  };
}
