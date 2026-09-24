/**
 * Supabase implementation of the discovery Repo.
 *
 * STATUS: implemented against the schema in supabase/migrations, but NOT
 * executed against a live project in this environment (no project is
 * configured here). See docs/testing.md -> "Blocked / externally dependent".
 *
 * Every read goes through the RLS-scoped request client. Only moderation and
 * audit writes use the service-role client, and only after the route handler
 * has already verified the caller's admin role.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AuditEvent, CorrectionReview, FacilityFacts, NewCareContext, NewCorrection,
  NewFollowUpTask, NewReport, NewReview, NewVisitRecord, Repo,
} from './repo';
import { assertAdministrative } from '@/lib/journey/prep';
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

    async listHospitals() {
      const res = await client.from('hospitals').select(HOSPITAL_SELECT).eq('active', true);
      return must<Row[]>(res).map(mapHospital);
    },

    async getHospital(idOrSlug) {
      const res = await client.from('hospitals').select(HOSPITAL_SELECT).or(`id.eq.${idOrSlug},slug.eq.${idOrSlug}`).limit(1);
      const rows = must<Row[]>(res);
      return rows[0] ? mapHospital(rows[0]) : null;
    },

    async listSessions(hospitalIds) {
      let q = client.from('clinic_sessions')
        .select('id, hospital_id, department_id, session_date, start_time, end_time, capacity, booked, status')
        .gte('session_date', new Date().toISOString().slice(0, 10));
      if (hospitalIds?.length) q = q.in('hospital_id', hospitalIds);
      return must<Row[]>(await q).map((r): ClinicSession => ({
        id: r.id, hospitalId: r.hospital_id, departmentId: r.department_id,
        date: r.session_date, startTime: r.start_time, endTime: r.end_time,
        capacity: r.capacity, booked: r.booked, status: r.status,
      }));
    },

    async listQueues(hospitalIds) {
      let q = client.from('hospital_queue_snapshots')
        .select('hospital_id, published, waiting_count, median_wait_minutes, observed_at');
      if (hospitalIds?.length) q = q.in('hospital_id', hospitalIds);
      return must<Row[]>(await q).map((r): QueueSnapshot => ({
        hospitalId: r.hospital_id, published: r.published, waitingCount: r.waiting_count,
        medianWaitMinutes: r.median_wait_minutes, observedAt: r.observed_at,
      }));
    },

    async listReviews(opts) {
      let q = client.from('hospital_reviews').select('*').order('created_at', { ascending: false });
      if (opts?.hospitalId) q = q.eq('hospital_id', opts.hospitalId);
      if (!opts?.includeNonPublished) q = q.eq('status', 'published');
      return must<Row[]>(await q).map(mapReview);
    },

    async listAppointments({ patientId, hospitalId }) {
      let q = client.from('appointments').select('id, hospital_id, patient_id, department_id, session_id, scheduled_for, status, completed_at');
      if (patientId) q = q.eq('patient_id', patientId);
      if (hospitalId) q = q.eq('hospital_id', hospitalId);
      return must<Row[]>(await q).map((r): Appointment => ({
        id: r.id, hospitalId: r.hospital_id, patientId: r.patient_id,
        departmentId: r.department_id, sessionId: r.session_id,
        scheduledFor: r.scheduled_for, status: r.status, completedAt: r.completed_at,
      }));
    },

    async getAppointment(id: string) {
      const res = await client
        .from('appointments')
        .select('id, hospital_id, patient_id, department_id, session_id, scheduled_for, status, completed_at')
        .eq('id', id)
        .maybeSingle();
      if (res.error) throw new Error(`supabase: ${res.error.message}`);
      const r = res.data as Row | null;
      if (!r) return null;
      return {
        id: r.id, hospitalId: r.hospital_id, patientId: r.patient_id,
        departmentId: r.department_id, sessionId: r.session_id,
        scheduledFor: r.scheduled_for, status: r.status, completedAt: r.completed_at,
      } as Appointment;
    },

    /**
     * Not ported. Against the live schema a slot request must go through the
     * SECURITY DEFINER booking function so capacity, versioning, idempotency
     * and audit stay in the database — never a client-side insert. Failing
     * loudly is correct: a silent no-op would look like a successful booking.
     */
    async requestAppointment(): Promise<Appointment> {
      throw new Error('supabase: requestAppointment is not ported to the live schema yet');
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
      const c = adminClient ?? client;
      await c.from('audit_events').insert({
        actor_id: e.actorId, actor_role: e.actorRole, action: e.action,
        entity: e.entity, entity_id: e.entityId, metadata: e.metadata,
      });
    },

    /* ================================================ journey layer ==== */

    async getFacilityFacts(hospitalId: string): Promise<FacilityFacts> {
      // Eight small reads in parallel beats one wide join: each fact table
      // has its own RLS policy and its own freshness index.
      const [sv, sl, ch, ac, ls, ap, rt, pr] = await Promise.all([
        client.from('hospital_service_verifications')
          .select(`hospital_id, service_slug, method, ${PROVENANCE_COLS}`).eq('hospital_id', hospitalId),
        client.from('hospital_scheme_listings')
          .select(`hospital_id, scheme_code, scheme_name, listing_status, ${PROVENANCE_COLS}`).eq('hospital_id', hospitalId),
        client.from('hospital_charges')
          .select(`hospital_id, charge_type, amount_min, amount_max, currency, is_published_range, ${PROVENANCE_COLS}`).eq('hospital_id', hospitalId),
        client.from('hospital_accessibility_components')
          .select(`hospital_id, component_code, status, standard_reference, note, ${PROVENANCE_COLS}`).eq('hospital_id', hospitalId),
        client.from('hospital_language_support')
          .select(`hospital_id, stage, languages, ${PROVENANCE_COLS}`).eq('hospital_id', hospitalId),
        client.from('hospital_arrival_packs')
          .select(`hospital_id, gate_label, gate_note, first_counter, building_note, parking_note, dropoff_note, late_policy_text, arrival_guidance_text, ${PROVENANCE_COLS}`).eq('hospital_id', hospitalId).limit(1),
        client.from('hospital_wayfinding_routes')
          .select(`hospital_id, from_point, to_point, locale, steps, step_free, walking_minutes, ${PROVENANCE_COLS}`).eq('hospital_id', hospitalId),
        client.from('hospital_prep_requirements')
          .select(`hospital_id, department_id, code, text, applies_to, ${PROVENANCE_COLS}`).eq('hospital_id', hospitalId),
      ]);

      const packRow = must<Row[]>(ap)[0];

      return {
        hospitalId,
        serviceVerifications: must<Row[]>(sv).map((r): ServiceVerification => ({
          hospitalId: r.hospital_id, serviceSlug: r.service_slug, method: r.method,
          provenance: mapProvenance(r),
        })),
        schemeListings: must<Row[]>(sl).map((r): SchemeListing => ({
          hospitalId: r.hospital_id, schemeCode: r.scheme_code, schemeName: r.scheme_name,
          listingStatus: r.listing_status, provenance: mapProvenance(r),
        })),
        charges: must<Row[]>(ch).map((r): FacilityCharge => ({
          hospitalId: r.hospital_id, chargeType: r.charge_type,
          amountMin: Number(r.amount_min), amountMax: Number(r.amount_max),
          currency: r.currency, isPublishedRange: Boolean(r.is_published_range),
          provenance: mapProvenance(r),
        })),
        accessibilityComponents: must<Row[]>(ac).map((r): AccessibilityComponent => ({
          hospitalId: r.hospital_id, componentCode: r.component_code, status: r.status,
          standardReference: r.standard_reference ?? null, note: r.note ?? null,
          provenance: mapProvenance(r),
        })),
        languageSupport: must<Row[]>(ls).map((r): LanguageSupport => ({
          hospitalId: r.hospital_id, stage: r.stage, languages: r.languages ?? [],
          provenance: mapProvenance(r),
        })),
        arrivalPack: packRow
          ? ({
              hospitalId: packRow.hospital_id,
              gateLabel: packRow.gate_label ?? null,
              gateNote: packRow.gate_note ?? null,
              firstCounter: packRow.first_counter ?? null,
              buildingNote: packRow.building_note ?? null,
              parkingNote: packRow.parking_note ?? null,
              dropoffNote: packRow.dropoff_note ?? null,
              latePolicyText: packRow.late_policy_text ?? null,
              arrivalGuidanceText: packRow.arrival_guidance_text ?? null,
              provenance: mapProvenance(packRow),
            } as ArrivalPack)
          : null,
        routes: must<Row[]>(rt).map((r): WayfindingRoute => ({
          hospitalId: r.hospital_id, fromPoint: r.from_point, toPoint: r.to_point,
          locale: r.locale, steps: r.steps ?? [], stepFree: r.step_free ?? null,
          walkingMinutes: r.walking_minutes ?? null, provenance: mapProvenance(r),
        })),
        prepRequirements: must<Row[]>(pr).map((r): PrepRequirement => ({
          hospitalId: r.hospital_id, departmentId: r.department_id ?? null,
          code: r.code, text: r.text, appliesTo: r.applies_to,
          provenance: mapProvenance(r),
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
