import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const configured = process.env.CRON_SECRET;
  const authorization = req.headers.get('authorization');
  const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7) : req.headers.get('x-cron-secret');
  if (!configured || provided !== configured) return fail(401, 'Cron authorization required.');
  try {
    const repo = await getRepo();
    const expired = await repo.expireDueCareRequests();
    return ok({ expired, source: repo.kind, ranAt: new Date().toISOString() });
  } catch (e) { return handleError(e); }
}
