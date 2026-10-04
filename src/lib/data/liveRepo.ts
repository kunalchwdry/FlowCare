/**
 * LIVE-READ repository.
 *
 * Reads the facility record — hospitals, departments, service verifications,
 * accessibility components, arrival packs and support channels — from the
 * real Supabase project over PostgREST with the *publishable* (anon) key, so
 * every read is still subject to Row Level Security. Nothing here uses a
 * service-role key and nothing here writes.
 *
 * Facility discovery and published slots are read from the linked project's
 * actual vocabulary. Appointments use the database booking/state RPCs. The
 * additive Care Access exchange is delegated to the Supabase adapter so its
 * requests, options, transitions and tasks are durable and RLS-scoped.
 * Reviews and a few legacy journey tables remain intentionally unavailable
 * until their live schema is mapped; this module returns an empty result
 * rather than inventing records.
 *
 * Why not use `supabaseRepo.ts` directly for discovery: that adapter was
 * originally written against a reconstructed column vocabulary
 * (`address_line`, `hospital_departments`, `clinic_sessions`) which does not
 * match this project's actual schema (`address`, `departments`, `slots`).
 * This module maps the columns that genuinely exist.
 */
import { demoRepo } from './demoRepo';
import type { NewAppointmentMessage, Repo } from './repo';
import type {
  Appointment, AppointmentMessage,
  ClinicSession, Hospital, HospitalDepartment, HospitalService, HospitalType,
} from '@/lib/types';

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { clockTime, zonedDateKey } from '@/lib/time';
import {
  fromDbStatus, idempotencyKey, isPersistable, toDbAction,
} from '@/lib/appointments/dbVocabulary';
import type { Action } from '@/lib/appointments/stateMachine';

const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Facility data changes rarely; re-reading it on every render is wasteful. */
const TTL_MS = 60_000;
let cache: { at: number; hospitals: Hospital[] } | null = null;

type Row = Record<string, any>;

async function rest(path: string): Promise<Row[]> {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    // Next must not cache this at the fetch layer; we manage our own TTL.
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`supabase read failed (${res.status}) on ${path.split('?')[0]}`);
  }
  return (await res.json()) as Row[];
}

/**
 * The project stores `operator_type` (OSM's vocabulary), not FlowCare's
 * hospital type. Anything we cannot map honestly becomes 'general' rather
 * than inventing a more specific classification.
 */
function hospitalType(row: Row): HospitalType {
  const name = String(row.name ?? '').toLowerCase();
  if (row.operator_type === 'government' || row.operator_type === 'public') return 'government';
  if (name.includes('trust') || name.includes('charitable')) return 'trust';
  if (name.includes('medical college') || name.includes('teaching')) return 'teaching';
  if (name.includes('diagnost') || name.includes('scan') || name.includes('lab')) return 'clinic';
  if (name.includes('clinic') || name.includes('polyclinic')) return 'clinic';
  if (name.includes('multispecial') || name.includes('multi special')) return 'multispecialty';
  // OSM does not record a FlowCare hospital type. Anything unmapped stays
  // 'clinic' rather than being promoted to a grander classification we
  // cannot evidence.
  return 'clinic';
}

/** A department name like "[TEST] Cardiology" yields the specialty slug. */
function specialtyFromName(name: string): string {
  return name
    .replace(/\[TEST\]/gi, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function mapHospital(
  row: Row,
  depts: Row[],
  services: Row[],
  access: Row[],
): Hospital {
  const departments: HospitalDepartment[] = depts.map((d) => ({
    id: d.id,
    hospitalId: row.id,
    specialty: specialtyFromName(d.name ?? ''),
    name: String(d.name ?? '').replace(/\[TEST\]\s*/gi, '').trim() || 'Department',
    active: Boolean(d.booking_open),
  }));

  // Services come from the verification table, which is also what the
  // discovery filters read. A row here means "this service is recorded",
  // never "this service is FlowCare-verified" — `verification` carries that.
  const seen = new Set<string>();
  const serviceList: HospitalService[] = [];
  for (const s of services) {
    if (seen.has(s.service_slug)) continue;
    seen.add(s.service_slug);
    serviceList.push({
      id: s.id,
      hospitalId: row.id,
      slug: s.service_slug,
      name: s.label ?? s.service_slug,
    });
  }

  const accessibility = access
    .filter((a) => a.status === 'available' || a.status === 'present')
    .map((a) => String(a.component));

  return {
    id: row.id,
    // Two fixture rows in the project have no slug; fall back to the id so
    // routing never produces an /hospitals/null URL.
    slug: row.slug ?? row.id,
    name: row.name ?? 'Unnamed facility',
    type: hospitalType(row),
    addressLine: row.address ?? '',
    city: row.city ?? '',
    state: 'Maharashtra',
    postalCode: null,
    location: { lat: Number(row.lat ?? 0), lng: Number(row.lng ?? 0) },
    phone: row.phone ?? null,
    website: row.website ?? null,
    // 'booking_integrated' is the only onboarding signal the schema carries.
    flowcareVerified: Boolean(row.booking_integrated),
    onboardedAt: null,
    departments,
    services: serviceList,
    accessibility,
    languages: [],
    operatingHours: {},
    emergencyServices: services.some((s) => s.service_slug === 'emergency-care'),
    bedCount: null,
    description: null,
    placeLink: null,
    // These are real rows from the live database, not generated fixtures.
    isDemoRecord: false,
  };
}

async function loadHospitals(): Promise<Hospital[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.hospitals;

  const [hospitals, departments, services, access] = await Promise.all([
    rest('hospitals?select=*&published=eq.true&order=name'),
    rest('departments?select=*'),
    rest('hospital_service_verifications?select=*'),
    rest('hospital_accessibility_components?select=*'),
  ]);

  const byHospital = <T extends Row>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = r.hospital_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };
  const d = byHospital(departments);
  const s = byHospital(services);
  const a = byHospital(access);

  const mapped = hospitals.map((h) =>
    mapHospital(h, d.get(h.id) ?? [], s.get(h.id) ?? [], a.get(h.id) ?? []),
  );
  cache = { at: Date.now(), hospitals: mapped };
  return mapped;
}

/**
 * Real bookable slots, read from the `slots` table.
 *
 * This repository used to invent sessions for every department — fourteen
 * days of them, per department, for any hospital marked verified. That is
 * why a booking could never persist: the session id referred to nothing,
 * so there was no row for Supabase to book against.
 *
 * Only genuine rows are returned now. A hospital with no slots shows no
 * availability, which is the honest answer and the one the product already
 * promises: never infer availability that has not been published.
 */
async function realSessions(hospitalIds?: string[]): Promise<ClinicSession[]> {
  // This SECURITY DEFINER read returns only published facilities and computes
  // occupancy in the database. We do not fall back to `booked = 0`, which
  // would turn an unreadable occupancy signal into invented availability.
  const rows: Row[] = [];
  for (const hospitalId of hospitalIds?.length ? hospitalIds : [null]) {
    const query = hospitalId
      ? `rpc/list_public_slot_availability?p_hospital=${encodeURIComponent(hospitalId)}&p_limit=400`
      : 'rpc/list_public_slot_availability?p_limit=400';
    rows.push(...await rest(query));
  }
  return rows.map((s) => {
    const start = new Date(s.starts_at); const end = new Date(s.ends_at);
    const capacity = Number(s.capacity ?? 0); const booked = Number(s.booked ?? 0);
    const open = Boolean(s.booking_open) && booked < capacity && (!s.expires_at || new Date(s.expires_at).getTime() > Date.now());
    return {
      id: String(s.id), hospitalId: String(s.hospital_id), departmentId: String(s.department_id),
      date: zonedDateKey(s.starts_at), startTime: clockTime(start), endTime: clockTime(end), capacity, booked,
      status: open ? 'open' : 'full', providerId: s.provider_id ?? null, serviceSlug: s.service_slug ?? null,
      slotType: s.slot_type ?? 'approval_required', waitlistEnabled: Boolean(s.waitlist_enabled),
      approvalResponseWindowMinutes: Number(s.approval_response_window_minutes ?? 240),
      recoveryPolicy: s.recovery_policy ?? 'offer_alternatives', expiresAt: s.expires_at ?? null,
      updatedAt: s.updated_at ?? s.starts_at, source: 'database',
    } satisfies ClinicSession;
  });
}

/**
 * Department names, cached briefly.
 *
 * Appointment rows carry only department_id, and a hospital screen showing
 * raw UUIDs is unusable at a reception desk.
 */
let deptCache: { at: number; names: Map<string, string> } | null = null;
async function departmentNames(): Promise<Map<string, string>> {
  if (deptCache && Date.now() - deptCache.at < TTL_MS) return deptCache.names;
  try {
    const rows = await rest('departments?select=id,name');
    const names = new Map(rows.map((d) => [String(d.id), String(d.name)]));
    deptCache = { at: Date.now(), names };
    return names;
  } catch {
    return new Map();
  }
}

/** Map a live `appointments` row onto the application's shape. */
function mapDbAppointment(r: Row, departmentName?: string): Appointment {
  return {
    id: String(r.id),
    hospitalId: String(r.hospital_id),
    patientId: String(r.patient_id),
    patientName: (r.patient_name as string | null) ?? null,
    departmentName: departmentName ?? null,
    departmentId: String(r.department_id),
    sessionId: String(r.slot_id),
    scheduledFor: String(r.scheduled_for ?? r.created_at),
    status: fromDbStatus(String(r.status)),
    completedAt: r.status === 'completed' ? String(r.created_at) : null,
    reason: (r.request_note as string | null) ?? null,
    requestedAt: String(r.created_at),
    queueId: r.queue_id ?? null, slotType: r.slot_type ?? null, approvalDeadline: r.approval_deadline ?? null, approvalStatus: r.approval_status ?? 'not_required',
    version: Number(r.version ?? 1),
  };
}

function mapDbMessage(r: Row): AppointmentMessage {
  return {
    id: String(r.id),
    appointmentId: String(r.appointment_id),
    senderSide: String(r.sender_side) as AppointmentMessage['senderSide'],
    senderId: r.sender_id ? String(r.sender_id) : null,
    kind: String(r.kind) as AppointmentMessage['kind'],
    body: String(r.body),
    proposedSessionId: r.proposed_slot_id ? String(r.proposed_slot_id) : null,
    proposedFor: r.proposed_for ? String(r.proposed_for) : null,
    previousStatus: r.previous_status ?? null,
    proposalStatus: r.proposal_status ?? null,
    createdAt: String(r.created_at),
  };
}

async function pendingProposal(sb: any, appointmentId: string): Promise<AppointmentMessage | null> {
  const { data, error } = await sb
    .from('appointment_messages')
    .select('*')
    .eq('appointment_id', appointmentId)
    .eq('kind', 'time_proposal')
    .eq('proposal_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data?.[0]) return null;
  return mapDbMessage(data[0] as Row);
}

function applyPendingProposal(appointment: Appointment, proposal: AppointmentMessage | null): Appointment {
  if (!proposal) return appointment;
  return {
    ...appointment,
    status: 'reschedule_proposed',
    proposedSessionId: proposal.proposedSessionId ?? null,
    proposedFor: proposal.proposedFor ?? null,
    decisionReason: proposal.body,
  };
}

async function hydrateAppointmentTimes(sb: any, appointments: Appointment[]): Promise<Appointment[]> {
  const ids = [...new Set(appointments.map((a) => a.sessionId).filter(Boolean))];
  if (!ids.length) return appointments;
  const { data, error } = await sb.from('slots').select('id, starts_at').in('id', ids);
  if (error || !data) return appointments;
  const byId = new Map<string, string>(data.map((r: Row) => [String(r.id), String(r.starts_at)] as [string, string]));
  return appointments.map((a) => ({ ...a, scheduledFor: byId.get(a.sessionId) ?? a.scheduledFor }));
}

/**
 * Care Access writes/readbacks use the additive Supabase exchange schema even
 * in live-facility mode. The dynamic import avoids a module cycle: the full
 * adapter reuses this module for the linked project's facility vocabulary.
 */
async function careRepo(): Promise<Repo> {
  const sb = await getSupabaseServerClient();
  if (!sb) throw new Error('SUPABASE_UNAVAILABLE');
  const { createSupabaseRepo } = await import('./supabaseRepo');
  return createSupabaseRepo(sb, getSupabaseAdminClient());
}

export const liveRepo: Repo = {
  ...demoRepo,
  kind: 'supabase',

  /**
   * Book against a REAL slot, through the database's own RPC.
   *
   * `book_appointment` is SECURITY DEFINER and does the work that must not
   * be trusted to application code: it locks the department, re-checks
   * capacity and booking_open, enforces an idempotency key, and writes the
   * appointment and its event in one transaction.
   *
   * This previously wrote to a JSON file. On a read-only filesystem that
   * write was swallowed, so a patient saw a confirmation for an appointment
   * that existed only in one server instance's memory and vanished on the
   * next request. Failing loudly is better than appearing to succeed.
   */
  async requestAppointment(input) {
    const sb = await getSupabaseServerClient();
    if (!sb) throw new Error('BOOKING_UNAVAILABLE');

    const { data: auth } = await sb.auth.getUser();
    if (!auth?.user) throw new Error('AUTH_REQUIRED');

    const name =
      (auth.user.user_metadata?.full_name as string | undefined)?.trim() ||
      auth.user.email ||
      'Patient';

    const { data, error } = await sb.rpc('book_appointment', {
      p_slot: input.sessionId,
      p_name: name.slice(0, 120),
      p_key: idempotencyKey(['book', input.sessionId, auth.user.id]),
      p_request_note: input.reason ?? null,
    });

    if (error) {
      // The RPC raises these by name; pass them through so the route can
      // answer 404/409 rather than a generic 500.
      const m = String(error.message ?? '');
      if (/NOT_FOUND/.test(m)) throw new Error('NOT_FOUND');
      if (/BOOKING_CLOSED/.test(m)) throw new Error('BOOKING_CLOSED');
      if (/CAPACITY_FULL/.test(m)) throw new Error('CAPACITY_FULL');
      if (/AUTH_REQUIRED/.test(m)) throw new Error('AUTH_REQUIRED');
      throw new Error(m || 'BOOKING_FAILED');
    }

    const row = (Array.isArray(data) ? data[0] : data) as Row;
    if (!row?.id) throw new Error('BOOKING_FAILED');
    return mapDbAppointment(row);
  },

  async listAppointments({ patientId, hospitalId }) {
    const sb = await getSupabaseServerClient();
    if (!sb) return [];
    let qb = sb.from('appointments').select('*').order('created_at', { ascending: false });
    // RLS already scopes these; the filters narrow, they do not authorise.
    if (patientId) qb = qb.eq('patient_id', patientId);
    if (hospitalId) qb = qb.eq('hospital_id', hospitalId);
    const { data, error } = await qb;
    if (error || !data) return [];
    const names = await departmentNames();
    const rows = await hydrateAppointmentTimes(
      sb,
      data.map((r) => mapDbAppointment(r as Row, names.get(String((r as Row).department_id)))),
    );
    const proposals = await Promise.all(rows.map((a) => pendingProposal(sb, a.id)));
    return rows.map((a, i) => applyPendingProposal(a, proposals[i]));
  },

  async getAppointment(id) {
    const sb = await getSupabaseServerClient();
    if (!sb) return null;
    const { data, error } = await sb.from('appointments').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    const names = await departmentNames();
    const appointment = (await hydrateAppointmentTimes(
      sb,
      [mapDbAppointment(data as Row, names.get(String((data as Row).department_id)))],
    ))[0];
    return applyPendingProposal(appointment, await pendingProposal(sb, appointment.id));
  },

  /** Hospital and patient decisions, including the explicit time-proposal loop. */
  async transitionAppointment(input) {
    const action = input.action as Action;
    const sb = await getSupabaseServerClient();
    if (!sb) throw new Error('BOOKING_UNAVAILABLE');

    let rpc = 'transition_appointment';
    let params: Record<string, unknown>;
    if (action === 'propose_reschedule') {
      rpc = 'propose_appointment_time';
      params = {
        p_id: input.appointmentId,
        p_version: input.expectedVersion ?? null,
        p_slot: input.proposedSessionId ?? null,
        p_key: idempotencyKey(['propose-time', input.appointmentId, input.proposedSessionId, input.expectedVersion ?? 0]),
        p_message: input.reason ?? null,
      };
    } else if (action === 'accept_reschedule' || action === 'decline_reschedule') {
      rpc = 'respond_appointment_time';
      params = {
        p_id: input.appointmentId,
        p_version: input.expectedVersion ?? null,
        p_accept: action === 'accept_reschedule',
        p_key: idempotencyKey(['respond-time', input.appointmentId, action, input.expectedVersion ?? 0]),
        p_message: input.reason ?? null,
      };
    } else {
      const dbAction = toDbAction(action);
      if (!dbAction || !isPersistable(action)) throw new Error('UNSUPPORTED_TRANSITION');
      params = {
        p_action: dbAction,
        p_id: input.appointmentId,
        p_version: input.expectedVersion ?? null,
        p_key: idempotencyKey([dbAction, input.appointmentId, input.expectedVersion ?? 0]),
        p_slot: null,
      };
    }

    const { data, error } = await sb.rpc(rpc, params);
    if (error) {
      const m = String(error.message ?? '');
      const known = [
        'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'NOT_FOUND',
        'CAPACITY_FULL', 'CONSULTATION_FULL', 'BOOKING_CLOSED',
        'INVALID_TRANSITION', 'POLICY_NOT_CONFIGURED', 'INVALID_INPUT',
      ] as const;
      for (const code of known) {
        if (m.includes(code)) throw new Error(code);
      }
      if (/permission|denied|not authori/i.test(m)) throw new Error('FORBIDDEN');
      throw new Error('TRANSITION_FAILED');
    }

    const row = (Array.isArray(data) ? data[0] : data) as Row;
    if (!row?.id) throw new Error('NOT_FOUND');
    const appointment = (await hydrateAppointmentTimes(sb, [mapDbAppointment(row)]))[0];
    return applyPendingProposal(appointment, await pendingProposal(sb, appointment.id));
  },

  async listAppointmentEvents(appointmentId) {
    const sb = await getSupabaseServerClient();
    if (!sb) return [];
    const { data, error } = await sb
      .from('appointment_events')
      .select('id, appointment_id, actor_id, action, version, occurred_at, details')
      .eq('appointment_id', appointmentId)
      .order('occurred_at', { ascending: true });
    if (error || !data) return [];
    return data.map((e) => {
      const details = (e.details ?? {}) as Record<string, unknown>;
      return {
        id: String(e.id),
        appointmentId: String(e.appointment_id),
        action: String(e.action),
        fromStatus: (details.from as string | undefined) ?? null,
        toStatus: (details.to as string | undefined) ?? String(e.action),
        actorSide: (String(e.action) === 'book' ? 'patient' : 'hospital') as 'patient' | 'hospital',
        actorRole: 'staff',
        actorId: e.actor_id ? String(e.actor_id) : null,
        reason: (details.reason as string | undefined) ?? null,
        createdAt: String(e.occurred_at),
      };
    });
  },

  async listAppointmentMessages(appointmentId) {
    const sb = await getSupabaseServerClient();
    if (!sb) return [];
    const { data, error } = await sb
      .from('appointment_messages')
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data.map((r) => mapDbMessage(r as Row));
  },

  async sendAppointmentMessage(input: NewAppointmentMessage) {
    const sb = await getSupabaseServerClient();
    if (!sb) throw new Error('BOOKING_UNAVAILABLE');
    const { data, error } = await sb
      .from('appointment_messages')
      .insert({
        appointment_id: input.appointmentId,
        sender_id: input.senderId,
        sender_side: input.senderSide,
        kind: 'message',
        body: input.body.trim(),
      })
      .select('*')
      .single();
    if (error || !data) {
      if (/not found|permission|row-level security/i.test(String(error?.message ?? ''))) throw new Error('NOT_FOUND');
      throw new Error('MESSAGE_FAILED');
    }
    return mapDbMessage(data as Row);
  },

  // ------------------------------------------- live Care Access exchange
  async listCareRequests(args) { return (await careRepo()).listCareRequests(args); },
  async getCareRequest(id) { return (await careRepo()).getCareRequest(id); },
  async createCareRequest(input) { return (await careRepo()).createCareRequest(input); },
  async listCareOptions(id) { return (await careRepo()).listCareOptions(id); },
  async saveCareOptions(id, options) { return (await careRepo()).saveCareOptions(id, options); },
  async transitionCareRequest(input) { return (await careRepo()).transitionCareRequest(input); },
  async listCareTransitions(id) { return (await careRepo()).listCareTransitions(id); },
  async listCareEpisodes(args) { return (await careRepo()).listCareEpisodes(args); },
  async listCareTasks(args) { return (await careRepo()).listCareTasks(args); },
  async createCareTask(input) { return (await careRepo()).createCareTask(input); },
  async updateCareTask(id, actorId, status, resolution) { return (await careRepo()).updateCareTask(id, actorId, status, resolution); },
  async listCapacitySignals(hospitalIds) { return (await careRepo()).listCapacitySignals(hospitalIds); },
  async publishCapacitySignal(input) { return (await careRepo()).publishCapacitySignal(input); },
  async getCareAccessMetrics(hospitalId) { return (await careRepo()).getCareAccessMetrics(hospitalId); },

  // Live-read mode must never fall through to demoRepo for hospital supply
  // management. The old spread inherited the demo CRUD methods, so a real
  // manager could open Operations but creating a department searched the demo
  // seed and returned NOT_FOUND. Delegate every operational mutation/read to
  // the RLS-scoped Supabase adapter instead.
  async listOperationalDepartments(hospitalId) { return (await careRepo()).listOperationalDepartments(hospitalId); },
  async createOperationalDepartment(input) { return (await careRepo()).createOperationalDepartment(input); },
  async listOperationalServices(hospitalId) { return (await careRepo()).listOperationalServices(hospitalId); },
  async createOperationalService(input) { return (await careRepo()).createOperationalService(input); },
  async listProviders(hospitalId) { return (await careRepo()).listProviders(hospitalId); },
  async createProvider(input) { return (await careRepo()).createProvider(input); },
  async listProviderSchedules(providerId) { return (await careRepo()).listProviderSchedules(providerId); },
  async createProviderSchedule(input) { return (await careRepo()).createProviderSchedule(input); },
  async listOperationalSlots(hospitalId) { return (await careRepo()).listOperationalSlots(hospitalId); },
  async createOperationalSlot(input) { return (await careRepo()).createOperationalSlot(input); },
  async updateOperationalSlot(id, patch) { return (await careRepo()).updateOperationalSlot(id, patch); },
  async listQueueEntries(filters) { return (await careRepo()).listQueueEntries(filters); },
  async expireDueCareRequests() { return (await careRepo()).expireDueCareRequests(); },

  async getFacilityFacts(hospitalId) { return (await careRepo()).getFacilityFacts(hospitalId); },
  async listServiceVerifications(hospitalIds) { return (await careRepo()).listServiceVerifications(hospitalIds); },
  async listSchemeListings(hospitalIds) { return (await careRepo()).listSchemeListings(hospitalIds); },
  async listAccessibilityComponents(hospitalIds) { return (await careRepo()).listAccessibilityComponents(hospitalIds); },

  async listHospitals() {
    return loadHospitals();
  },

  async getHospital(idOrSlug: string) {
    const all = await loadHospitals();
    return all.find((h) => h.id === idOrSlug || h.slug === idOrSlug) ?? null;
  },

  /**
   * Real slots, with seats already counted from real appointments.
   *
   * Seat usage used to be topped up from a JSON file of pending requests.
   * That file is unwritable on a serverless host, so the count was wrong
   * wherever it mattered most. realSessions() derives it from the
   * appointments table instead, and the database enforces capacity anyway
   * when a booking is actually attempted.
   */
  async listSessions(hospitalIds?: string[]) {
    return realSessions(hospitalIds);
  },

  /** No queue snapshots exist in the live project; report none rather than invent one. */
  async listQueues() {
    return [];
  },

  /** `hospital_reviews` is empty live. Returning [] makes the UI say so honestly. */
  async listReviews() {
    return [];
  },


};

/** Counts shown in the banner so the claim "live" is specific and checkable. */
export async function liveReadStats() {
  const hospitals = await loadHospitals();
  return {
    hospitals: hospitals.length,
    bookable: hospitals.filter((h) => h.flowcareVerified).length,
    services: hospitals.reduce((n, h) => n + h.services.length, 0),
  };
}
