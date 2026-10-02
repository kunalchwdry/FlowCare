/**
 * Hospital claims — "this is my hospital, give us the portal".
 *
 * Deliberately separate from a staff access request. A staff request asks an
 * administrator who already exists to let somebody in. A *claim* is made when
 * nobody holds the hospital yet, so there is no one inside to approve it —
 * which is exactly why it cannot be self-service.
 *
 * The rule this module exists to enforce: **a claim grants nothing.** It
 * records an intent and a contact, and stops. Control of a hospital's
 * published information and its patients' appointments is not something an
 * email address should be able to take by typing a name into a form. A human
 * at FlowCare verifies the claimant against the facility before any
 * membership is created.
 *
 * Storage mirrors lib/staff/accessRequests: file-backed, degrading to module
 * scope on a read-only filesystem rather than throwing a 500 at somebody
 * whose submission was perfectly valid.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type ClaimStatus = 'pending' | 'verifying' | 'approved' | 'rejected';

/** Where the hospital stands in FlowCare today. Shown to the claimant. */
export type IntegrationState = 'discovery_only' | 'partially_integrated' | 'booking_enabled';

export interface HospitalClaim {
  id: string;
  /** Set when claiming a facility FlowCare already lists. */
  hospitalId: string | null;
  /** Set when the facility is not listed and has to be added first. */
  proposedName: string | null;
  proposedCity: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  /** Claimant's stated position. Self-asserted — it proves nothing on its own. */
  statedRole: string;
  /** How they say the claim can be checked: a website, a letterhead, a desk number. */
  evidenceNote: string | null;
  status: ClaimStatus;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

const FILE = path.join(process.cwd(), '.data', 'hospital-claims.json');

let volatileRows: HospitalClaim[] = [];
let filesystemWritable: boolean | null = null;

export function storageIsDurable(): boolean {
  return filesystemWritable !== false;
}

async function readAll(): Promise<HospitalClaim[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, 'utf8'));
    const onDisk: HospitalClaim[] = Array.isArray(parsed) ? parsed : [];
    const seen = new Set(onDisk.map((r) => r.id));
    return [...onDisk, ...volatileRows.filter((r) => !seen.has(r.id))];
  } catch {
    return [...volatileRows];
  }
}

async function writeAll(rows: HospitalClaim[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(rows, null, 2), 'utf8');
    filesystemWritable = true;
  } catch {
    filesystemWritable = false;
    volatileRows = rows;
  }
}

export async function listClaims(filter?: { status?: ClaimStatus }): Promise<HospitalClaim[]> {
  const rows = await readAll();
  return rows
    .filter((r) => (filter?.status ? r.status === filter.status : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Record a claim.
 *
 * Returns the existing row when the same person has already claimed the same
 * facility, so a double submit reads as "we have this" rather than silently
 * queueing a second one for a reviewer to deduplicate.
 */
export async function createClaim(input: {
  hospitalId?: string | null;
  proposedName?: string | null;
  proposedCity?: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  statedRole: string;
  evidenceNote?: string | null;
}): Promise<{ claim: HospitalClaim; duplicate: boolean }> {
  const rows = await readAll();
  const email = input.contactEmail.trim().toLowerCase();

  const existing = rows.find(
    (r) =>
      r.contactEmail === email &&
      r.status !== 'rejected' &&
      (input.hospitalId
        ? r.hospitalId === input.hospitalId
        : (r.proposedName ?? '').toLowerCase() === (input.proposedName ?? '').trim().toLowerCase()),
  );
  if (existing) return { claim: existing, duplicate: true };

  const claim: HospitalClaim = {
    id: `hcl_${randomUUID()}`,
    hospitalId: input.hospitalId ?? null,
    proposedName: input.proposedName?.trim() || null,
    proposedCity: input.proposedCity?.trim() || null,
    contactName: input.contactName.trim(),
    contactEmail: email,
    contactPhone: input.contactPhone?.trim() || null,
    statedRole: input.statedRole.trim(),
    evidenceNote: input.evidenceNote?.trim() || null,
    // Always 'pending'. There is no input to this function that can produce
    // any other starting state, which is what makes the guarantee checkable.
    status: 'pending',
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decisionNote: null,
  };

  rows.push(claim);
  await writeAll(rows);
  return { claim, duplicate: false };
}

/**
 * How integrated a hospital is, from data rather than assertion.
 *
 * A hospital is only ever described as bookable when sessions actually exist
 * for it. Being present in the database means it was imported, nothing more,
 * and saying otherwise is how a directory starts promising appointments it
 * cannot deliver.
 */
export function integrationState(opts: {
  hasDepartments: boolean;
  hasOpenSessions: boolean;
  hasActiveStaff: boolean;
}): { state: IntegrationState; label: string; detail: string } {
  if (opts.hasOpenSessions && opts.hasActiveStaff) {
    return {
      state: 'booking_enabled',
      label: 'Booking enabled',
      detail: 'This hospital manages appointment requests through FlowCare.',
    };
  }
  if (opts.hasDepartments || opts.hasActiveStaff) {
    return {
      state: 'partially_integrated',
      label: 'Partially integrated',
      detail: 'Some information is maintained here, but appointments are not yet managed in FlowCare.',
    };
  }
  return {
    state: 'discovery_only',
    label: 'Discovery only',
    detail: 'Listed so people can find it. Appointments are not handled through FlowCare.',
  };
}
