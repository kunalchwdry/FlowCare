import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { TransitionError } from '@/lib/appointments/stateMachine';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The patient's half of the loop.
 *
 * Deliberately a much smaller surface than the hospital route: a patient may
 * only respond to a proposal the hospital made, or cancel their own
 * appointment. They cannot confirm their own request — that is the whole
 * point of the request/confirm split, and allowing it here would reintroduce
 * the fake confirmation this work exists to remove.
 */
const Body = z
  .object({
    action: z.enum(['accept_reschedule', 'decline_reschedule', 'cancel']),
    reason: z.string().max(280).optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to manage your appointments.');

    const rl = rateLimit(`apt-respond:${clientKey(req)}`, 30);
    if (!rl.allowed) {
      return fail(429, 'Too many changes at once. Please wait a moment.', { retryInMs: rl.resetInMs });
    }

    const { id } = await ctx.params;
    const body = Body.parse(await readJson(req, 1500));
    const repo = await getRepo();

    const appointment = await repo.transitionAppointment({
      appointmentId: id,
      action: body.action,
      actor: 'patient',
      actorId: user.id,
      actorRole: 'patient',
      expectedVersion: body.expectedVersion,
      reason: body.reason ?? null,
    });

    await repo.recordAuditEvent({
      actorId: user.id,
      actorRole: 'patient',
      action: `appointment.${body.action}`,
      entity: 'appointment',
      entityId: appointment.id,
      metadata: { toStatus: appointment.status, version: appointment.version ?? 1 },
    });

    const events = await repo.listAppointmentEvents(appointment.id);
    return ok({ appointment, events });
  } catch (e) {
    if (e instanceof TransitionError) {
      const status = e.code === 'VERSION_CONFLICT' ? 409 : e.code === 'FORBIDDEN' ? 403 : 422;
      return fail(status, e.message, { code: e.code });
    }
    if (e instanceof Error) {
      // Cross-patient reads and genuinely missing rows are indistinguishable
      // on purpose — see the hospital route for the same reasoning.
      if (e.message === 'NOT_FOUND') return fail(404, 'That appointment could not be found.');
      if (e.message === 'CAPACITY_FULL') {
        return fail(409, 'That time has just filled up. Ask the hospital for another.', { code: 'CAPACITY_FULL' });
      }
    }
    return handleError(e);
  }
}
