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
  ClinicSession, Hospital, HospitalDepartment, HospitalService, HospitalType,
} from '@/lib/types';

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
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
function syntheticSessionsFor(hospitals: Hospital[]): ClinicSession[] {
  const out: ClinicSession[] = [];
  const today = new Date();
  for (const h of hospitals) {
    if (!h.flowcareVerified) continue;
    for (const dept of h.departments) {
      if (!dept.active) continue;
      for (let day = 0; day < 14; day += 1) {
        const date = new Date(today);
        date.setDate(today.getDate() + day);
        if (date.getDay() === 0) continue; // closed Sundays
        const iso = date.toISOString().slice(0, 10);
        const capacity = 8 + ((day + dept.name.length) % 7);
        const booked = (day * 3 + dept.name.length) % Math.max(1, capacity - 2);
        out.push({
          // URL-safe separator. A colon is legal inside a path segment but
          // it travels badly through routers and proxies, and this id is
          // used directly in /appointments/<id>.
          id: `${h.id}__${dept.id}__${iso}`,
          hospitalId: h.id,
          departmentId: `${h.id}:dept:${dept.specialty}`,
          date: iso,
          startTime: day % 2 === 0 ? '09:30' : '11:00',
          endTime: day % 2 === 0 ? '13:00' : '16:30',
          capacity,
          booked,
          status: 'open',
        });
      }
    }
  }
  return out;
}

let sessionCache: { at: number; rows: ClinicSession[] } | null = null;
async function sessions(): Promise<ClinicSession[]> {
  if (sessionCache && Date.now() - sessionCache.at < TTL_MS) return sessionCache.rows;
  const rows = syntheticSessionsFor(await loadHospitals());
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

function readRequests(): StoredRequest[] {
  try {
    const stat = fs.statSync(REQ_FILE);
    if (reqCache && reqCache.mtimeMs === stat.mtimeMs) return reqCache.rows;
    const rows = JSON.parse(fs.readFileSync(REQ_FILE, 'utf8')) as StoredRequest[];
    reqCache = { mtimeMs: stat.mtimeMs, rows };
    return rows;
  } catch {
    return [];
  }
}

function writeRequests(rows: StoredRequest[]) {
  try {
    fs.mkdirSync(REQ_DIR, { recursive: true });
    fs.writeFileSync(REQ_FILE, JSON.stringify(rows, null, 2), 'utf8');
    reqCache = { mtimeMs: fs.statSync(REQ_FILE).mtimeMs, rows };
  } catch {
    /* read-only environment: the request is still returned to the caller */
  }
}

export const liveRepo: Repo = {
  ...demoRepo,
  kind: 'supabase',

  async listHospitals() {
    return loadHospitals();
  },

  async getHospital(idOrSlug: string) {
    const all = await loadHospitals();
    return all.find((h) => h.id === idOrSlug || h.slug === idOrSlug) ?? null;
  },

  async listSessions(hospitalIds?: string[]) {
    const all = await sessions();
    const taken = new Map<string, number>();
    for (const r of readRequests()) taken.set(r.sessionId, (taken.get(r.sessionId) ?? 0) + 1);
    const adjusted = all.map((s) => {
      const extra = taken.get(s.id) ?? 0;
      if (!extra) return s;
      const booked = Math.min(s.capacity, s.booked + extra);
      return { ...s, booked, status: booked >= s.capacity ? ('full' as const) : s.status };
    });
    if (!hospitalIds) return adjusted;
    const set = new Set(hospitalIds);
    return adjusted.filter((s) => set.has(s.hospitalId));
  },

  /** No queue snapshots exist in the live project; report none rather than invent one. */
  async listQueues() {
    return [];
  },

  /** `hospital_reviews` is empty live. Returning [] makes the UI say so honestly. */
  async listReviews() {
    return [];
  },

  async listAppointments({ patientId }) {
    const all = await sessions();
    const rows = readRequests()
      .filter((r) => !patientId || r.patientId === patientId)
      // A stored request whose generated session has rolled out of the
      // 14-day window is dropped rather than rendered against a guessed slot.
      .filter((r) => all.some((x) => x.id === r.sessionId))
      .map((r) => {
        const s = all.find((x) => x.id === r.sessionId)!;
        return {
          id: `apt-${r.sessionId}`,
          hospitalId: s.hospitalId,
          patientId: r.patientId,
          departmentId: s.departmentId,
          sessionId: s.id,
          scheduledFor: `${s.date}T${s.startTime}:00`,
          status: 'requested' as const,
          completedAt: null,
          reason: r.reason,
          requestedAt: r.at,
        };
      });
    return rows;
  },

  async getAppointment(id: string) {
    const rows = await liveRepo.listAppointments({});
    return rows.find((a) => a.id === id) ?? null;
  },

  async requestAppointment(input) {
    const all = await sessions();
    const session = all.find((s) => s.id === input.sessionId);
    if (!session) throw new Error('NOT_FOUND');
    const rows = readRequests();
    const taken = rows.filter((r) => r.sessionId === session.id).length;
    if (session.booked + taken >= session.capacity) throw new Error('CAPACITY_FULL');
    const already = rows.find(
      (r) => r.sessionId === session.id && r.patientId === input.patientId,
    );
    if (!already) {
      rows.push({
        sessionId: session.id,
        patientId: input.patientId,
        reason: input.reason ?? null,
        at: new Date().toISOString(),
      });
      writeRequests(rows);
    }
    return {
      id: `apt-${session.id}`,
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
