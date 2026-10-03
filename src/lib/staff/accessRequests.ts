/**
 * Staff access requests.
 *
 * Production requests live in Supabase so a request submitted on one Vercel
 * instance is visible to a hospital administrator on another. The JSON store
 * remains only for the local/demo repository, where it makes the flow easy to
 * exercise without a database migration.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDemoMode } from '@/lib/env';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { RequestStatus, StaffAccessRequest, StaffRole } from '@/lib/staff/roles';

export type { RequestStatus, StaffAccessRequest, StaffRole } from '@/lib/staff/roles';
export { STAFF_ROLES, STAFF_ROLE_LABELS } from '@/lib/staff/roles';

const FILE = path.join(process.cwd(), '.data', 'staff-requests.json');

function isUuid(value: string | null | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function dbRow(row: Record<string, unknown>, hospitalName: string): StaffAccessRequest {
  return {
    id: String(row.id),
    email: String(row.email ?? ''),
    fullName: String(row.full_name ?? ''),
    hospitalId: String(row.hospital_id),
    hospitalName,
    requestedRole: row.requested_role as StaffRole,
    staffId: (row.staff_id as string | null) ?? null,
    status: row.status as RequestStatus,
    createdAt: String(row.created_at),
    decidedAt: (row.decided_at as string | null) ?? null,
    decidedBy: (row.decided_by as string | null) ?? null,
    note: (row.note as string | null) ?? null,
  };
}

async function dbHospitalName(sb: NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>, hospitalId: string): Promise<string> {
  const { data } = await sb.from('hospitals').select('name').eq('id', hospitalId).maybeSingle();
  return String(data?.name ?? 'Your hospital');
}

async function persistentClient(hospitalId?: string) {
  if (isDemoMode() || (hospitalId && !isUuid(hospitalId))) return null;
  return getSupabaseServerClient();
}

let volatileRows: StaffAccessRequest[] = [];
let filesystemWritable: boolean | null = null;

export function storageIsDurable(): boolean {
  return filesystemWritable !== false;
}

async function readAll(): Promise<StaffAccessRequest[]> {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const onDisk = Array.isArray(parsed) ? (parsed as StaffAccessRequest[]) : [];
    const seen = new Set(onDisk.map((r) => r.id));
    return [...onDisk, ...volatileRows.filter((r) => !seen.has(r.id))];
  } catch {
    return [...volatileRows];
  }
}

async function writeAll(rows: StaffAccessRequest[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(rows, null, 2), 'utf8');
    filesystemWritable = true;
  } catch {
    filesystemWritable = false;
    volatileRows = rows;
  }
}

export async function listRequests(filter?: { hospitalId?: string; status?: RequestStatus }): Promise<StaffAccessRequest[]> {
  const sb = await persistentClient(filter?.hospitalId);
  if (sb && filter?.hospitalId && isUuid(filter.hospitalId)) {
    const hospitalName = await dbHospitalName(sb, filter.hospitalId);
    let query = sb
      .from('staff_access_requests')
      .select('id,hospital_id,email,full_name,requested_role,staff_id,status,created_at,decided_at,decided_by,note')
      .eq('hospital_id', filter.hospitalId)
      .order('created_at', { ascending: false });
    if (filter.status) query = query.eq('status', filter.status);
    const { data, error } = await query;
    if (!error && data) return data.map((row) => dbRow(row as Record<string, unknown>, hospitalName));
    // Keep the hospital portal usable while an operator is applying the
    // additive migration. The API will still explain that submissions are
    // unavailable; a missing queue must not take down the whole staff page.
    if (process.env.NODE_ENV === 'production') return [];
  }

  const rows = await readAll();
  return rows
    .filter((r) => (filter?.hospitalId ? r.hospitalId === filter.hospitalId : true))
    .filter((r) => (filter?.status ? r.status === filter.status : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findByEmail(email: string): Promise<StaffAccessRequest | null> {
  const norm = email.trim().toLowerCase();
  const sb = await persistentClient();
  if (sb) {
    const { data, error } = await sb
      .from('staff_access_requests')
      .select('id,hospital_id,email,full_name,requested_role,staff_id,status,created_at,decided_at,decided_by,note')
      .eq('email', norm)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      return dbRow(data as Record<string, unknown>, await dbHospitalName(sb, String(data.hospital_id)));
    }
    if (error && process.env.NODE_ENV === 'production') return null;
  }
  const rows = await readAll();
  return rows.find((r) => r.email === norm) ?? null;
}

export async function createRequest(input: {
  email: string;
  fullName: string;
  hospitalId: string;
  hospitalName: string;
  requestedRole: StaffRole;
  staffId?: string | null;
}): Promise<{ request: StaffAccessRequest; duplicate: boolean }> {
  const email = input.email.trim().toLowerCase();
  const sb = await persistentClient(input.hospitalId);
  if (sb && isUuid(input.hospitalId)) {
    const { data, error } = await sb.rpc('submit_staff_access_request', {
      p_hospital_id: input.hospitalId,
      p_email: email,
      p_full_name: input.fullName,
      p_requested_role: input.requestedRole,
      p_staff_id: input.staffId ?? null,
    });
    if (!error && data) {
      const result = data as { id: string; status: RequestStatus; duplicate?: boolean; created_at: string };
      return {
        request: {
          id: result.id,
          email,
          fullName: input.fullName.trim(),
          hospitalId: input.hospitalId,
          hospitalName: input.hospitalName,
          requestedRole: input.requestedRole,
          staffId: input.staffId?.trim() || null,
          status: result.status,
          createdAt: result.created_at,
          decidedAt: null,
          decidedBy: null,
          note: null,
        },
        duplicate: Boolean(result.duplicate),
      };
    }
    if (process.env.NODE_ENV === 'production') throw new Error('STAFF_REQUEST_STORE_UNAVAILABLE');
  }

  const rows = await readAll();
  const existing = rows.find(
    (r) => r.email === email && r.hospitalId === input.hospitalId && r.status === 'pending',
  );
  if (existing) return { request: existing, duplicate: true };

  const request: StaffAccessRequest = {
    id: `sar_${randomUUID()}`,
    email,
    fullName: input.fullName.trim(),
    hospitalId: input.hospitalId,
    hospitalName: input.hospitalName,
    requestedRole: input.requestedRole,
    staffId: input.staffId?.trim() || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    note: null,
  };
  rows.push(request);
  await writeAll(rows);
  return { request, duplicate: false };
}

export async function decideRequest(input: {
  id: string;
  status: Extract<RequestStatus, 'approved' | 'rejected'>;
  decidedBy: string;
  note?: string | null;
}): Promise<StaffAccessRequest | null> {
  const sb = await persistentClient();
  if (sb && isUuid(input.id)) {
    const { data, error } = await sb.rpc('decide_staff_access_request', {
      p_request_id: input.id,
      p_decision: input.status,
      p_note: input.note ?? null,
    });
    if (!error && data) {
      const result = data as { id: string; status: RequestStatus; decided_at: string | null; decided_by: string | null; note: string | null };
      const { data: row } = await sb
        .from('staff_access_requests')
        .select('id,hospital_id,email,full_name,requested_role,staff_id,created_at')
        .eq('id', result.id)
        .maybeSingle();
      if (row) {
        return {
          id: result.id,
          email: String(row.email),
          fullName: String(row.full_name),
          hospitalId: String(row.hospital_id),
          hospitalName: await dbHospitalName(sb, String(row.hospital_id)),
          requestedRole: row.requested_role as StaffRole,
          staffId: (row.staff_id as string | null) ?? null,
          status: result.status,
          createdAt: String(row.created_at),
          decidedAt: result.decided_at,
          decidedBy: result.decided_by,
          note: result.note,
        };
      }
    }
    if (process.env.NODE_ENV === 'production') throw new Error('STAFF_REQUEST_STORE_UNAVAILABLE');
  }

  const rows = await readAll();
  const row = rows.find((r) => r.id === input.id);
  if (!row) return null;
  if (row.status !== 'pending') return row;
  row.status = input.status;
  row.decidedAt = new Date().toISOString();
  row.decidedBy = input.decidedBy;
  row.note = input.note ?? null;
  await writeAll(rows);
  return row;
}
