import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { getSession } from '@/lib/auth/session';
import { createRequest, listRequests } from '@/lib/staff/accessRequests';
import { STAFF_ROLES } from '@/lib/staff/roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    email: z.string().email().max(200),
    fullName: z.string().min(2).max(80),
    hospitalId: z.string().min(1).max(100),
    requestedRole: z.enum(STAFF_ROLES),
    staffId: z.string().max(60).nullish(),
  })
  .strict();

/**
 * Submit a staff access request.
 *
 * This endpoint cannot grant a role, by construction: it writes to the
 * request queue and nothing else. Approval is a separate, authenticated,
 * administrator-only action.
 */
export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`staff-request:${clientKey(req)}`, 5);
    if (!rl.allowed) {
      return fail(429, 'Too many requests. Please wait a minute.', { retryInMs: rl.resetInMs });
    }

    const body = Body.parse(await readJson(req, 3000));

    // The hospital must exist and be published; we will not queue a request
    // against an id somebody typed into the network tab.
    const repo = await getRepo();
    const hospitals = await repo.listHospitals();
    const hospital = hospitals.find((h) => h.id === body.hospitalId || h.slug === body.hospitalId);
    if (!hospital) return fail(404, 'We could not find that hospital.');

    const { request, duplicate } = await createRequest({
      email: body.email,
      fullName: body.fullName,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      requestedRole: body.requestedRole,
      staffId: body.staffId ?? null,
    });

    return ok({
      request: {
        id: request.id,
        status: request.status,
        hospitalName: request.hospitalName,
        requestedRole: request.requestedRole,
        createdAt: request.createdAt,
      },
      duplicate,
      message:
        'Your request has been submitted. A hospital administrator must approve your access.',
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * List requests for the caller's hospital. Administrators only, and scoped
 * to their own hospital — a doctor or a receptionist gets 403, and an admin
 * at hospital A cannot read hospital B's queue.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return fail(401, 'Sign in to view access requests.');
    if (session.role !== 'admin') {
      return fail(403, 'Only a hospital administrator can review access requests.');
    }
    if (!session.hospitalId) {
      return fail(403, 'Your account is not linked to a hospital.');
    }
    const status = req.nextUrl.searchParams.get('status');
    const rows = await listRequests({
      hospitalId: session.hospitalId,
      status: status === 'pending' || status === 'approved' || status === 'rejected' ? status : undefined,
    });
    return ok({ requests: rows, count: rows.length });
  } catch (e) {
    return handleError(e);
  }
}
