import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import type { Repo } from '@/lib/data';
import { hospitalActorFromSession } from '@/lib/auth/hospital';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { CareAccessTransitionError } from '@/lib/careAccess/stateMachine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  action: z.enum(['acknowledge', 'request_info', 'accept', 'approve', 'reject', 'redirect', 'offer_slot', 'request_recovery', 'offer_recovery', 'reschedule', 'cancel', 'arrive', 'no_show', 'complete', 'open_follow_up', 'close']),
  reason: z.string().trim().max(280).optional(),
  optionId: z.string().max(160).optional(),
  expectedVersion: z.number().int().positive().optional(),
}).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor) return fail(401, 'Sign in to the hospital portal.');
    const { id } = await ctx.params;
    const body = Body.parse(await readJson(req, 2000));
    const repo = await getRepo();
    const current = await repo.getCareRequest(id);
    if (!current || current.selectedHospitalId !== actor.hospitalId) return fail(404, 'Care request not found.');
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) return fail(409, 'This care request changed. Reload before trying again.', { code: 'VERSION_CONFLICT' });

    /* An appointment is still the booking/arrival source of truth. Care
       Access records the cross-provider journey, but these operational actions
       must pass through the existing appointment state machine first. */
    if (current.appointmentId && ['accept', 'arrive', 'complete', 'no_show', 'cancel'].includes(body.action)) {
      let appointment = await repo.getAppointment(current.appointmentId);
      if (!appointment) return fail(409, 'The linked appointment is no longer available.');
      const move = async (action: Parameters<Repo['transitionAppointment']>[0]['action'], reason?: string) => {
        appointment = await repo.transitionAppointment({ appointmentId: appointment!.id, action, actor: 'hospital', actorId: actor.user.id, actorRole: actor.user.role, permissions: actor.permissions, hospitalId: actor.hospitalId, expectedVersion: appointment!.version, reason: reason ?? null });
      };
      if (body.action === 'accept') {
        if (appointment.status === 'requested') await move('accept');
        if (appointment.status !== 'booked') return fail(409, 'The linked appointment is not ready to confirm.');
      } else if (body.action === 'arrive') {
        if (appointment.status === 'requested') await move('accept');
        if (appointment.status === 'booked') await move('check_in');
        if (!['checked_in', 'in_progress'].includes(appointment.status)) return fail(409, 'The linked appointment is not ready to record arrival.');
      } else if (body.action === 'complete') {
        if (appointment.status === 'checked_in') await move('start');
        if (appointment.status === 'in_progress') await move('complete');
        if (appointment.status !== 'completed') return fail(409, 'The linked appointment is not ready to record completion.');
      } else if (body.action === 'no_show') {
        if (!['booked', 'checked_in'].includes(appointment.status)) return fail(409, 'Only a booked or checked-in appointment can be marked not attended.');
        await move('no_show', body.reason);
      } else if (body.action === 'cancel') {
        if (!['requested', 'booked', 'reschedule_proposed'].includes(appointment.status)) return fail(409, 'The linked appointment cannot be cancelled in its current state.');
        await move('cancel', body.reason);
      }
    }

    let request = await repo.transitionCareRequest({
      careRequestId: id, action: body.action, actor: 'hospital', actorId: actor.user.id, actorRole: actor.user.role,
      expectedVersion: body.expectedVersion ?? current.version, reason: body.reason ?? null, optionId: body.optionId ?? current.selectedOptionId,
      metadata: { hospitalId: actor.hospitalId, appointmentId: current.appointmentId },
    });

    // Hospital acceptance has now confirmed the linked appointment. Only at
    // this point may the Care Access journey become BOOKED.
    if (body.action === 'accept' && request.appointmentId) {
      const confirmed = await repo.getAppointment(request.appointmentId);
      if (confirmed?.status === 'booked') {
        request = await repo.transitionCareRequest({
          careRequestId: id, action: 'confirm_booking', actor: 'system', actorId: actor.user.id, actorRole: 'system',
          expectedVersion: request.version, optionId: request.selectedOptionId, appointmentId: confirmed.id,
          metadata: { hospitalId: actor.hospitalId, patientId: request.patientId, confirmation: 'hospital_accepted' },
        });
      }
    }

    if (body.action === 'complete' && request.episodeId) {
      await repo.createCareTask({ careRequestId: id, episodeId: request.episodeId, patientId: request.patientId,
        hospitalId: actor.hospitalId, ownerType: 'patient', ownerId: request.patientId, taskType: 'follow_up',
        title: 'Confirm whether a follow-up appointment is needed', description: 'This is an administrative follow-up task. Ask the care team if another visit is required.' });
      await repo.transitionCareRequest({ careRequestId: id, action: 'open_follow_up', actor: 'system', actorId: actor.user.id, actorRole: 'system', expectedVersion: request.version, metadata: { hospitalId: actor.hospitalId, appointmentId: request.appointmentId, patientId: request.patientId } });
    }
    return ok({ request: await repo.getCareRequest(id), transitions: await repo.listCareTransitions(id), tasks: await repo.listCareTasks({ hospitalId: actor.hospitalId, careRequestId: id }) });
  } catch (e) {
    if (e instanceof CareAccessTransitionError) return fail(e.code === 'VERSION_CONFLICT' ? 409 : 422, e.message, { code: e.code });
    return handleError(e);
  }
}
