import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Patient-owned read. There is deliberately no write verb for this resource. */
export async function GET() {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to see your reliability summary.');
    if (user.role !== 'patient') return fail(403, 'This summary is available in the patient portal.');
    const repo = await getRepo();
    const [reliability, visits] = await Promise.all([
      repo.getPatientReliability(user.id),
      repo.listVerifiedVisits(user.id),
    ]);
    return ok({ reliability, visits });
  } catch (e) {
    return handleError(e);
  }
}
