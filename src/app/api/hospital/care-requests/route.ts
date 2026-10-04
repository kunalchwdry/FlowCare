import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { hospitalActorFromSession } from '@/lib/auth/hospital';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor) return fail(401, 'Sign in to the hospital portal.');
    const includePhone = req.nextUrl.searchParams.get('includePhone') === '1' && actor.permissions.includes('queue:manage');
    const repo = await getRepo();
    const requests = await repo.listCareRequests({ hospitalId: actor.hospitalId });
    const rows = await Promise.all(requests.map(async (request) => ({
      request: { ...request, patientPhone: includePhone ? request.patientPhone ?? null : null },
      options: await repo.listCareOptions(request.id),
      transitions: await repo.listCareTransitions(request.id),
      tasks: await repo.listCareTasks({ hospitalId: actor.hospitalId, careRequestId: request.id }),
    })));
    return ok({ requests: rows, metrics: await repo.getCareAccessMetrics(actor.hospitalId), phoneVisibility: includePhone ? 'authorized' : 'masked' });
  } catch (e) { return handleError(e); }
}
