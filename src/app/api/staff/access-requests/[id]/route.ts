import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { getSession } from '@/lib/auth/session';
import { getRepo } from '@/lib/data';
import { decideRequest, listRequests } from '@/lib/staff/accessRequests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(280).nullish(),
  })
  .strict();

/**
 * Approve or reject a staff access request.
 *
 * Three checks have to pass, and all three are server-side:
 *   1. the caller is signed in,
 *   2. the caller holds the administrator role on their own account,
 *   3. the request belongs to the caller's own hospital.
 *
 * Check 3 fails as 404, not 403, so this endpoint cannot be used to probe
 * which request ids exist at other hospitals. Every decision is written to
 * the audit log against the identity of the person who made it.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;

    const session = await getSession();
    if (!session) return fail(401, 'Sign in to continue.');
    if (session.role !== 'admin') {
      return fail(403, 'Only a hospital administrator can decide access requests.');
    }
    if (!session.hospitalId) {
      return fail(403, 'Your administrator account is not linked to a hospital.');
    }

    const body = Body.parse(await readJson(req, 1000));

    const mine = await listRequests({ hospitalId: session.hospitalId });
    const target = mine.find((r) => r.id === id);
    if (!target) return fail(404, 'We could not find that request.');
    if (target.status !== 'pending') {
      return fail(409, 'That request has already been decided.');
    }

    const updated = await decideRequest({
      id,
      status: body.decision,
      decidedBy: session.id,
      note: body.note ?? null,
    });

    const repo = await getRepo();
    await repo
      .recordAuditEvent({
        actorId: session.id,
        actorRole: session.role,
        action: `staff_access.${body.decision}`,
        entity: 'staff_access_request',
        entityId: id,
        // No free-text and no patient content: role and hospital only.
        metadata: {
          hospitalId: session.hospitalId,
          requestedRole: target.requestedRole,
        },
      })
      .catch(() => undefined);

    return ok({
      request: updated,
      message:
        body.decision === 'approved'
          ? 'Access approved.'
          : 'Request rejected. They keep their patient account and see no staff data.',
    });
  } catch (e) {
    return handleError(e);
  }
}
