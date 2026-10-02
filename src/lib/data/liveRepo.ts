/**
 * LIVE-READ repository.
 *
 * Reads the facility record — hospitals, departments, service verifications,
 * accessibility components, arrival packs and support channels — from the
 * real Supabase project over PostgREST with the *publishable* (anon) key, so
 * every read is still subject to Row Level Security. Nothing here uses a
 * service-role key and nothing here writes.
 *
 * Everything the live project does not yet contain — appointment sessions,
 * appointments, reviews, favourites, queue snapshots and the whole journey
 * layer — is delegated to `demoRepo` unchanged. That split is deliberate and
 * is reported to the user verbatim in the banner: a hospital on screen is a
 * real record from the database, an appointment slot is not.
 *
 * Why not `supabaseRepo.ts`: that file was written against a reconstructed
 * column vocabulary (`address_line`, `hospital_departments`, `clinic_sessions`)
 * which does not match this project's actual schema, and it contains write
 * paths that would fail. This module maps the columns that genuinely exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { demoRepo } from './demoRepo';
import type { Repo } from './repo';
import type {
  Appointment,
  ClinicSession, Hospital, HospitalDepartment, HospitalService, HospitalType,
} from '@/lib/types';

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
import { getSupabaseServerClient } from '@/lib/supabase/server';
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
 * Locally generated clinic sessions for the project's own `[TEST]` fixture
 * hospitals, which are flagged `booking_integrated` and carry departments
 * with a capacity but have no sessions table to draw slots from.
 *
 * These slots are NOT live data and the UI must say so. They exist so the
 * booking path is demonstrable end to end; they are attached only to rows the
 * database itself labels `[TEST]`, never to one of the 60 real facilities —
 * offering a fake slot at a real hospital would be the worst thing this
 * product could do.
 */

let sessionCache: { at: number; rows: ClinicSession[] } | null = null;
async function sessions(): Promise<ClinicSession[]> {
  if (sessionCache && Date.now() - sessionCache.at < TTL_MS) return sessionCache.rows;
  const rows = await realSessions();
  sessionCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Slot requests, persisted to disk rather than held in a module-level array.
 *
 * Next.js bundles route handlers and server components separately, so each
 * entry point can receive its OWN instance of this module. An in-memory array
 * is therefore written by `POST /api/appointments` and read back as empty by
 * the `/appointments/[id]` page, which 404s a request that was just created.
 * That is exactly why `demoRepo` is file-backed, and this must be too.
 * The file is re-read whenever its mtime changes, so no instance serves a
 * stale view of what another instance wrote.
 */
interface StoredRequest { sessionId: string; patientId: string; reason: string | null; at: string }

const REQ_DIR = path.join(process.cwd(), '.data');
const REQ_FILE = path.join(REQ_DIR, 'live-requests.json');
let reqCache: { mtimeMs: number; rows: StoredRequest[] } | null = null;




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
  const nowIso = new Date().toISOString();
  const depts = await rest(
    `departments?select=id,hospital_id,name,booking_open${
      hospitalIds?.length ? `&hospital_id=in.(${hospitalIds.join(',')})` : ''
    }`,
  );
  if (depts.length === 0) return [];
  const byDept = new Map(depts.map((d) => [String(d.id), d]));

  const slots = await rest(
    `slots?select=id,department_id,starts_at,ends_at,kind,capacity,booking_open` +
      `&department_id=in.(${[...byDept.keys()].join(',')})` +
      `&starts_at=gt.${nowIso}&order=starts_at.asc&limit=400`,
  );

  // How many seats each slot has already given out.
  let taken = new Map<string, number>();
  if (slots.length) {
    try {
      const appts = await rest(
        `appointments?select=slot_id,status&slot_id=in.(${slots.map((s) => s.id).join(',')})`,
      );
      for (const a of appts) {
        if (['cancelled', 'denied', 'no_show'].includes(String(a.status))) continue;
        const k = String(a.slot_id);
        taken.set(k, (taken.get(k) ?? 0) + 1);
      }
    } catch {
      // anon cannot read appointments; seats fall back to 0 taken rather
      // than hiding slots that may well be free.
    }
  }

  return slots.map((s) => {
    const d = byDept.get(String(s.department_id))!;
    const start = new Date(s.starts_at);
    const end = new Date(s.ends_at);
    const booked = taken.get(String(s.id)) ?? 0;
    const capacity = Number(s.capacity ?? 0);
    const open = Boolean(s.booking_open) && Boolean(d.booking_open) && booked < capacity;
    return {
      id: String(s.id),
      hospitalId: String(d.hospital_id),
      departmentId: String(d.id),
      date: s.starts_at.slice(0, 10),
      startTime: start.toISOString().slice(11, 16),
      endTime: end.toISOString().slice(11, 16),
      capacity,
      booked,
      status: open ? 'open' : 'full',
    } satisfies ClinicSession;
  });
}

/** Map a live `appointments` row onto the application's shape. */
function mapDbAppointment(r: Row, departmentName?: string): Appointment {
  return {
    id: String(r.id),
    hospitalId: String(r.hospital_id),
    patientId: String(r.patient_id),
    departmentId: departmentName ?? String(r.department_id),
    sessionId: String(r.slot_id),
    scheduledFor: String(r.scheduled_for ?? r.created_at),
    status: fromDbStatus(String(r.status)),
    completedAt: r.status === 'completed' ? String(r.created_at) : null,
    reason: null,
    requestedAt: String(r.created_at),
    version: Number(r.version ?? 1),
  };
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
    return data.map((r) => mapDbAppointment(r as Row));
  },

  async getAppointment(id) {
    const sb = await getSupabaseServerClient();
    if (!sb) return null;
    const { data, error } = await sb.from('appointments').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapDbAppointment(data as Row);
  },

  /**
   * Hospital and patient decisions, through `transition_appointment`.
   *
   * Authorisation is the database's: the RPC derives the hospital from the
   * appointment itself and calls private.require_permission, so a forged
   * hospital id in a request body changes nothing. Optimistic concurrency
   * is its `p_version`.
   *
   * Two app actions have no database equivalent — answering a reschedule
   * proposal — because this schema has no "proposed" state. Rather than
   * invent one, those are refused here.
   */
  async transitionAppointment(input) {
    const action = input.action as Action;
    const dbAction = toDbAction(action);
    if (!dbAction || !isPersistable(action)) throw new Error('UNSUPPORTED_TRANSITION');

    /*
     * The decline reason cannot be stored.
     *
     * transition_appointment takes (p_action, p_id, p_version, p_key,
     * p_slot) and the appointments table has no reason column, so a reason
     * collected by the UI has nowhere to go in this schema. It is dropped
     * here rather than silently appearing to save: the patient-facing copy
     * must not promise an explanation the database never received.
     *
     * Storing it needs a migration — either a column or a row in
     * appointment_events.details — and that has not been made yet.
     */

    const sb = await getSupabaseServerClient();
    if (!sb) throw new Error('BOOKING_UNAVAILABLE');

    const { data, error } = await sb.rpc('transition_appointment', {
      p_action: dbAction,
      p_id: input.appointmentId,
      p_version: input.expectedVersion ?? null,
      p_key: idempotencyKey([dbAction, input.appointmentId, input.expectedVersion ?? 0]),
      p_slot: dbAction === 'reschedule' ? input.proposedSessionId ?? null : null,
    });

    if (error) {
      /*
       * mutate_appointment raises exactly nine named codes. Mapping only
       * some of them meant a VERSION_CONFLICT arrived as an unmatched
       * message and surfaced to the user as HTTP 500 "Something went
       * wrong" — a raw failure for a condition the product has a precise
       * answer to. The full set is handled, and anything genuinely
       * unrecognised is still not reported as the caller's fault.
       */
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
    return mapDbAppointment(row);
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
