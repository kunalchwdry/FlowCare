import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { hospitalActorFromSession } from '@/lib/auth/hospital';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Queue data is operationally scoped and defaults to masked contact data. */
export async function GET(req: NextRequest) {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor) return fail(401, 'Sign in to the hospital portal.');
    if (!actor.permissions.includes('queue:read')) return fail(403, 'Your hospital permission does not allow queue access.');
    const includePhone = req.nextUrl.searchParams.get('includePhone') === '1' && actor.permissions.includes('queue:manage');
    const repo = await getRepo();
    const result = await repo.listQueueEntries({ hospitalId: actor.hospitalId, departmentId: req.nextUrl.searchParams.get('departmentId') ?? undefined });
    const requests = await repo.listCareRequests({ hospitalId: actor.hospitalId });
    const phones = new Map(requests.map((r) => [r.id, r.patientPhone ?? null]));
    const entries = result.entries.map((entry) => ({
      ...entry,
      patientPhone: includePhone ? phones.get(entry.careRequestId ?? '') ?? null : null,
      phoneVisibility: includePhone ? 'authorized' : 'masked',
    }));
    return ok({ ...result, entries, phoneVisibility: includePhone ? 'authorized' : 'masked', updatedAt: new Date().toISOString() });
  } catch (e) { return handleError(e); }
}
