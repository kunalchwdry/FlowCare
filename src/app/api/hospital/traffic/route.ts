import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { hospitalActorFromSession } from '@/lib/auth/hospital';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Hospital refresh endpoint. The hospital id comes from the authenticated
 * membership, never from a query string or request body.
 */
export async function GET(_req: NextRequest) {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor) return fail(401, 'Sign in to the hospital portal.');
    if (!actor.permissions.includes('queue:read')) return fail(403, 'Your hospital permission does not allow queue access.');
    const repo = await getRepo();
    const traffic = await repo.listPatientTraffic([actor.hospitalId], { detailed: true });
    return ok({ traffic, updatedAt: new Date().toISOString() });
  } catch (e) {
    return handleError(e);
  }
}
