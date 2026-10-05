import { getRepo } from '@/lib/data';
import { hospitalActorFromSession } from '@/lib/auth/hospital';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Relationship-scoped hospital read. The browser supplies an appointment id, never a patient id. */
export async function GET(_req: Request, ctx: { params: Promise<{ appointmentId: string }> }) {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor) return fail(401, 'Sign in to the hospital portal to view patient context.');
    if (!actor.permissions.includes('appointments:read')) return fail(403, 'You do not have permission to view patient context.');

    const { appointmentId } = await ctx.params;
    const repo = await getRepo();
    const appointment = await repo.getAppointment(appointmentId);
    if (!appointment || appointment.hospitalId !== actor.hospitalId) {
      return fail(404, 'That appointment could not be found.');
    }
    const profile = await repo.getHospitalPatientProfile(appointment.id, actor.hospitalId);
    if (!profile) return fail(404, 'That appointment could not be found.');
    return ok({ profile });
  } catch (e) {
    return handleError(e);
  }
}
