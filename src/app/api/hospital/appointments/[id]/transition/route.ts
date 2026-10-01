import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { hospitalActorFromSession } from '@/lib/auth/hospital';
import { ACTIONS, TransitionError } from '@/lib/appointments/stateMachine';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    action: z.enum(ACTIONS),
    reason: z.string().max(280).optional(),
    proposedSessionId: z.string().max(120).optional(),
    /** Caller's view of the row. Omitted means "I have not read it". */
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

/**
 * The hospital side of the appointment loop.
 *
 * Everything here is decided on the server. The browser names an action and
 * the id it is acting on; it never sends a status. Three independent checks
 * have to pass before anything is written:
 *
 *   1. the caller is staff with an active membership  (session)
 *   2. the appointment belongs to *their* hospital    (repo, scoped write)
 *   3. the move is legal from the current status, and
 *      they hold the permission it needs              (state machine)
 *
 * A cross-hospital id fails as 404 rather than 403. A 403 would confirm the
 * row exists, which is all somebody needs to enumerate another hospital's
 * appointments one id at a time.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor) return fail(401, 'Sign in to the hospital portal to manage appointments.');

    const rl = rateLimit(`hosp-transition:${clientKey(req)}`, 60);
    if (!rl.allowed) {
      return fail(429, 'Too many changes at once. Please wait a moment.', { retryInMs: rl.resetInMs });
    }

    const { id } = await ctx.params;
    const body = Body.parse(await readJson(req, 2000));
    const repo = await getRepo();

    const appointment = await repo.transitionAppointment({
      appointmentId: id,
      action: body.action,
      actor: 'hospital',
      actorId: actor.user.id,
      actorRole: actor.user.role,
      permissions: actor.permissions,
      expectedVersion: body.expectedVersion,
      reason: body.reason ?? null,
      proposedSessionId: body.proposedSessionId ?? null,
      // Scopes the write to the caller's own hospital.
      hospitalId: actor.hospitalId,
    });

    await repo.recordAuditEvent({
      actorId: actor.user.id,
      actorRole: actor.user.role,
      action: `appointment.${body.action}`,
      entity: 'appointment',
      entityId: appointment.id,
      // No patient free text: the reason is stored on the row, not duplicated
      // into the audit metadata where it would be harder to redact later.
      metadata: {
        hospitalId: actor.hospitalId,
        toStatus: appointment.status,
        version: appointment.version ?? 1,
        hadReason: Boolean(body.reason),
      },
    });

    const events = await repo.listAppointmentEvents(appointment.id);
    return ok({ appointment, events });
  } catch (e) {
    if (e instanceof TransitionError) {
      const status = e.code === 'FORBIDDEN' ? 403 : e.code === 'VERSION_CONFLICT' ? 409 : 422;
      return fail(status, e.message, { code: e.code });
    }
    if (e instanceof Error) {
      if (e.message === 'NOT_FOUND') return fail(404, 'That appointment could not be found.');
      if (e.message === 'CAPACITY_FULL') {
        return fail(409, 'That session is now full. Choose another time.', { code: 'CAPACITY_FULL' });
      }
    }
    return handleError(e);
  }
}
