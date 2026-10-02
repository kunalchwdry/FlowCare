/**
 * Reads for the hospital portal.
 *
 * Every function here takes the hospital id from the caller's membership —
 * resolved server-side — and never from a query string, a body or a header.
 * There is no parameter a browser can set that widens the scope.
 *
 * Where a table has nothing in it the functions return an empty array, not
 * a placeholder. A page is expected to say "nothing yet" rather than invent
 * a number, because this product is read by people deciding where to seek
 * care and a fabricated figure is worse than a blank.
 */
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { Appointment, AppointmentEvent, HospitalReview } from '@/lib/types';

export interface StaffMember {
  userId: string;
  email: string | null;
  status: 'pending' | 'active' | 'revoked';
  permissions: string[];
  role: 'admin' | 'staff';
  approvedBy: string | null;
  updatedAt: string | null;
  version: number;
}

export interface MembershipEvent {
  id: string;
  action: string;
  subjectId: string | null;
  actorId: string | null;
  occurredAt: string;
  details: Record<string, unknown> | null;
}

/**
 * Staff at this hospital.
 *
 * RLS on `memberships` is
 * `user_id = private.actor() OR private.allowed(hospital_id,'memberships:manage')`,
 * so this returns the full roster only for someone who holds that
 * permission, and just their own row otherwise. The filter below is belt
 * and braces — the database is what actually enforces it.
 */
export async function listStaff(hospitalId: string): Promise<StaffMember[]> {
  const sb = await getSupabaseServerClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('memberships')
    .select('user_id, status, permissions, approved_by, updated_at, version')
    .eq('hospital_id', hospitalId)
    .order('status', { ascending: true });
  if (error || !data) return [];

  return data.map((m) => {
    const permissions = (m.permissions as string[] | null) ?? [];
    return {
      userId: m.user_id as string,
      // auth.users is not readable over PostgREST, so there is no email to
      // show. Inventing one, or showing a name from elsewhere, would be
      // guessing at who a user id belongs to.
      email: null,
      status: (m.status as StaffMember['status']) ?? 'pending',
      permissions,
      role: permissions.includes('memberships:manage') ? 'admin' : 'staff',
      approvedBy: (m.approved_by as string | null) ?? null,
      updatedAt: (m.updated_at as string | null) ?? null,
      version: (m.version as number | null) ?? 1,
    };
  });
}

export async function listMembershipEvents(hospitalId: string): Promise<MembershipEvent[]> {
  const sb = await getSupabaseServerClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('membership_events')
    .select('id, action, subject_id, actor_id, occurred_at, details')
    .eq('hospital_id', hospitalId)
    .order('occurred_at', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map((e) => ({
    id: String(e.id),
    action: e.action as string,
    subjectId: (e.subject_id as string | null) ?? null,
    actorId: (e.actor_id as string | null) ?? null,
    occurredAt: e.occurred_at as string,
    details: (e.details as Record<string, unknown> | null) ?? null,
  }));
}

/** The queue is today's appointments in an operational state — not a separate system. */
export const QUEUE_STATES = ['booked', 'checked_in', 'in_progress'] as const;

export function todaysQueue(appointments: Appointment[], now = new Date()): Appointment[] {
  const today = now.toISOString().slice(0, 10);
  return appointments
    .filter((a) => (a.scheduledFor ?? '').slice(0, 10) === today)
    .filter((a) => (QUEUE_STATES as readonly string[]).includes(a.status))
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
}

export interface PatientSummary {
  patientId: string;
  appointments: Appointment[];
  first: string;
  last: string;
  completed: number;
  upcoming: number;
}

/**
 * Patients, strictly in the context of THIS hospital's appointments.
 *
 * Deliberately not a patient record. Staff see the visits a patient has had
 * here and nothing else — no other hospital's appointments, no care
 * partners, no follow-ups, no stored AI keys. Those belong to the patient,
 * and working at a hospital is not authority to read them.
 */
export function summarisePatients(appointments: Appointment[]): PatientSummary[] {
  const by = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const list = by.get(a.patientId) ?? [];
    list.push(a);
    by.set(a.patientId, list);
  }
  return [...by.entries()]
    .map(([patientId, list]) => {
      const sorted = [...list].sort((x, y) => x.scheduledFor.localeCompare(y.scheduledFor));
      return {
        patientId,
        appointments: sorted,
        first: sorted[0]?.scheduledFor ?? '',
        last: sorted.at(-1)?.scheduledFor ?? '',
        completed: list.filter((a) => a.status === 'completed').length,
        upcoming: list.filter((a) => ['requested', 'booked', 'checked_in'].includes(a.status)).length,
      };
    })
    .sort((a, b) => b.last.localeCompare(a.last));
}

export interface ReviewStats {
  count: number;
  /** null when there is nothing to average — distinct from an average of 0. */
  overall: number | null;
  waiting: number | null;
  staff: number | null;
  appointment: number | null;
  facility: number | null;
}

export function summariseReviews(reviews: HospitalReview[]): ReviewStats {
  const published = reviews.filter((r) => r.status === 'published');
  const avg = (pick: (r: HospitalReview) => number | null | undefined) => {
    const xs = published.map(pick).filter((n): n is number => typeof n === 'number');
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  };
  return {
    count: published.length,
    overall: avg((r) => r.ratings?.overall),
    waiting: avg((r) => r.ratings?.waiting),
    staff: avg((r) => r.ratings?.staff),
    appointment: avg((r) => r.ratings?.appointment),
    facility: avg((r) => r.ratings?.facility),
  };
}

export interface Funnel {
  requested: number;
  confirmed: number;
  checkedIn: number;
  completed: number;
}

/**
 * The appointment funnel, counted from events rather than current status.
 *
 * An appointment that has been completed also passed through confirmed and
 * checked in; counting only its present status would show a drop-off that
 * never happened.
 */
export function buildFunnel(appointments: Appointment[], events: AppointmentEvent[]): Funnel {
  const reached = (actions: string[]) =>
    new Set(events.filter((e) => actions.includes(e.action)).map((e) => e.appointmentId)).size;
  return {
    requested: appointments.length,
    confirmed: reached(['accept', 'accept_reschedule']),
    checkedIn: reached(['check_in']),
    completed: reached(['complete']),
  };
}

/** Demand by department, from real rows only. */
export function demandByDepartment(appointments: Appointment[]): { id: string; count: number }[] {
  const m = new Map<string, number>();
  for (const a of appointments) m.set(a.departmentId, (m.get(a.departmentId) ?? 0) + 1);
  return [...m.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
}

/** Demand by hour of day, for spotting busy periods. Empty when there is nothing. */
export function demandByHour(appointments: Appointment[]): { hour: number; count: number }[] {
  const m = new Map<number, number>();
  for (const a of appointments) {
    const h = new Date(a.scheduledFor).getHours();
    if (Number.isFinite(h)) m.set(h, (m.get(h) ?? 0) + 1);
  }
  return [...m.entries()].map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour - b.hour);
}
