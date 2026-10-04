import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { CareAccessTransitionError } from '@/lib/careAccess/stateMachine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  action: z.enum(['book', 'remind', 'reschedule', 'request_reschedule', 'cancel', 'arrive', 'no_show', 'complete', 'open_follow_up', 'close', 'provide_info']),
  reason: z.string().trim().max(280).optional(),
  expectedVersion: z.number().int().positive().optional(),
  appointmentId: z.string().min(1).max(160).optional(),
}).strict();

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to see this care journey.');
    const { id } = await ctx.params;
    const repo = await getRepo();
    const request = await repo.getCareRequest(id);
    if (!request || (request.patientId !== user.id && request.selectedHospitalId !== user.hospitalId)) {
      return fail(404, 'Care journey not found.');
    }
    return ok({
      request,
      options: await repo.listCareOptions(id),
      transitions: await repo.listCareTransitions(id),
      tasks: await repo.listCareTasks({ careRequestId: id, patientId: request.patientId }),
      episodes: await repo.listCareEpisodes({ patientId: request.patientId }),
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to update a care journey.');
    const { id } = await ctx.params;
    const body = Body.parse(await readJson(req, 2000));
    const repo = await getRepo();
    const current = await repo.getCareRequest(id);
    if (!current || current.patientId !== user.id) return fail(404, 'Care journey not found.');
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) return fail(409, 'This care request changed. Reload before trying again.', { code: 'VERSION_CONFLICT' });

    let appointmentId = body.appointmentId ?? null;
    if (body.action === 'book') {
      const option = (await repo.listCareOptions(id)).find((o) => o.id === current.selectedOptionId);
      if (!option?.sessionId) return fail(409, 'This option has no current slot. Choose another option or ask the hospital for a slot.');
      const appointment = await repo.requestAppointment({ patientId: user.id, sessionId: option.sessionId, reason: 'Care Access Exchange booking request' });
      appointmentId = appointment.id;
    }

    const request = await repo.transitionCareRequest({
      careRequestId: id, action: body.action, actor: 'patient', actorId: user.id, actorRole: user.role,
      expectedVersion: body.expectedVersion ?? current.version, reason: body.reason ?? null, appointmentId,
    });
    return ok({ request, transitions: await repo.listCareTransitions(id) });
  } catch (e) {
    if (e instanceof CareAccessTransitionError) return fail(e.code === 'VERSION_CONFLICT' ? 409 : 422, e.message, { code: e.code });
    if (e instanceof Error && ['NOT_FOUND', 'OPTION_NOT_FOUND', 'CAPACITY_FULL', 'BOOKING_CLOSED'].includes(e.message)) {
      return fail(e.message === 'NOT_FOUND' ? 404 : 409, e.message.replaceAll('_', ' ').toLowerCase(), { code: e.message });
    }
    return handleError(e);
  }
}
