import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getSession();
    if (!user?.flowcareReviewer) return fail(403, 'Reviewer access required.');
    const repo = await getRepo();
    return ok({ metrics: await repo.getCareAccessMetrics() });
  } catch (e) {
    return handleError(e);
  }
}
