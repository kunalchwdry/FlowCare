import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { handleError, ok } from '@/lib/http';
import { rateLimit, clientKey } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public traffic refresh endpoint. The repository/RPC decides what is
 * public; hospital ids are only a filter and never an authorisation claim.
 */
export async function GET(req: NextRequest) {
  try {
    const rl = rateLimit(`traffic:${clientKey(req)}`, 60);
    if (!rl.allowed) return new Response('Too many requests', { status: 429 });

    const raw = req.nextUrl.searchParams.get('hospitalIds') ?? '';
    const hospitalIds = raw.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 100);
    const repo = await getRepo();
    const traffic = await repo.listPatientTraffic(hospitalIds.length ? hospitalIds : undefined);
    return ok({ traffic, updatedAt: new Date().toISOString() });
  } catch (e) {
    return handleError(e);
  }
}
