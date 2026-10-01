/**
 * Staff access requests.
 *
 * The rule this module exists to enforce: **signing up never grants a role.**
 * A staff registration only creates a *request*. Somebody who already holds
 * an administrator role at that hospital has to approve it before the
 * account can see any patient or queue data.
 *
 * Storage is file-backed here for the same reason bookings are (see
 * .data/live-requests.json): this deployment has read-only database
 * credentials, so a write must not silently vanish. The equivalent table,
 * with RLS and SECURITY DEFINER approval RPCs, ships in migration 0009 and
 * is what a credentialed deployment uses instead.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RequestStatus, StaffAccessRequest, StaffRole } from '@/lib/staff/roles';

export type { RequestStatus, StaffAccessRequest, StaffRole } from '@/lib/staff/roles';
export { STAFF_ROLES, STAFF_ROLE_LABELS } from '@/lib/staff/roles';

const FILE = path.join(process.cwd(), '.data', 'staff-requests.json');

/**
 * Requests submitted while the filesystem is unwritable.
 *
 * Serverless hosts mount a read-only filesystem apart from an ephemeral
 * /tmp, so the write below throws and used to surface as a 500 — the
 * submitter was told "Something went wrong" for an operation that had in
 * fact been accepted and validated. Holding the row in module scope keeps it
 * readable for the life of the instance, which is enough for an
 * administrator to see and act on it in the same session.
 *
 * This is a fallback, not a store: it does not survive a cold start, and
 * `storageIsDurable()` reports that honestly so callers can say so rather
 * than implying the request is safely filed.
 */
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
    // Merge so a request accepted after the filesystem went read-only is not
    // hidden by an older on-disk snapshot.
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
    // EROFS / EACCES on a serverless host. Keep the data for this instance
    // rather than throwing: the caller has already validated and authorised
    // the change, and a 500 here would lose it silently either way.
    filesystemWritable = false;
    volatileRows = rows;
  }
}

export async function listRequests(filter?: { hospitalId?: string; status?: RequestStatus }) {
  const rows = await readAll();
  return rows
    .filter((r) => (filter?.hospitalId ? r.hospitalId === filter.hospitalId : true))
    .filter((r) => (filter?.status ? r.status === filter.status : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findByEmail(email: string): Promise<StaffAccessRequest | null> {
  const rows = await readAll();
  const norm = email.trim().toLowerCase();
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
  const rows = await readAll();
  const email = input.email.trim().toLowerCase();

  // One open request per person per hospital. Re-submitting returns the
  // existing one rather than queueing a second copy for the administrator.
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
  const rows = await readAll();
  const row = rows.find((r) => r.id === input.id);
  if (!row) return null;
  if (row.status !== 'pending') return row; // decisions are not re-run
  row.status = input.status;
  row.decidedAt = new Date().toISOString();
  row.decidedBy = input.decidedBy;
  row.note = input.note ?? null;
  await writeAll(rows);
  return row;
}
