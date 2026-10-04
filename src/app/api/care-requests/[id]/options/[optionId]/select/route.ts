import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok } from '@/lib/http';
import { CareAccessTransitionError } from '@/lib/careAccess/stateMachine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Selecting an option immediately branches by the database-backed slot type:
 * instant books, approval_required creates an approval queue entry, and
 * waitlist creates a waitlist entry. The client never chooses a status.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string; optionId: string }> }) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to choose a care option.');
    const { id, optionId } = await ctx.params;
    const repo = await getRepo();
    const current = await repo.getCareRequest(id);
    if (!current || current.patientId !== user.id) return fail(404, 'Care journey not found.');
    const option = (await repo.listCareOptions(id)).find((row) => row.id === optionId && row.eligible);
    if (!option) return fail(404, 'That care option is no longer available.');

    const selected = await repo.transitionCareRequest({
      careRequestId: id, action: 'select_option', actor: 'patient', actorId: user.id, actorRole: user.role,
      expectedVersion: current.version, optionId,
    });

    let result = selected;
    const slotType = option.slotType ?? 'approval_required';
    if (slotType === 'instant') {
      if (!option.sessionId) return fail(409, 'This option no longer has a bookable slot.');
      const appointment = await repo.requestAppointment({ patientId: user.id, sessionId: option.sessionId });
      result = await repo.transitionCareRequest({
        careRequestId: id, action: 'book', actor: 'patient', actorId: user.id, actorRole: user.role,
        expectedVersion: selected.version, appointmentId: appointment.id, optionId,
        metadata: { optionId, slotType: 'instant' },
      });
    } else if (slotType === 'waitlist') {
      result = await repo.transitionCareRequest({
        careRequestId: id, action: 'join_waitlist', actor: 'patient', actorId: user.id, actorRole: user.role,
        expectedVersion: selected.version, optionId, metadata: { optionId, slotType: 'waitlist' },
      });
    } else {
      result = await repo.transitionCareRequest({
        careRequestId: id, action: 'request_approval', actor: 'patient', actorId: user.id, actorRole: user.role,
        expectedVersion: selected.version, optionId, metadata: { optionId, slotType: 'approval_required' },
      });
    }
    return ok({ request: result, options: await repo.listCareOptions(id), transitions: await repo.listCareTransitions(id) });
  } catch (e) {
    if (e instanceof CareAccessTransitionError) return fail(e.code === 'VERSION_CONFLICT' ? 409 : 422, e.message, { code: e.code });
    if (e instanceof Error && ['OPTION_NOT_FOUND', 'BOOKING_CLOSED', 'CAPACITY_FULL', 'WAITLIST_REQUIRED'].includes(e.message)) return fail(409, 'That option is no longer available.');
    return handleError(e);
  }
}
