import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { hospitalActorFromSession, can } from '@/lib/auth/hospital';
import { fail, handleError, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  serviceSlug: z.string().trim().max(120).nullable().optional(),
  available: z.boolean().nullable().optional(),
  queueWaitMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  waitingCount: z.number().int().min(0).max(100000).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();

export async function GET() {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor) return fail(401, 'Sign in to the hospital portal.');
    const repo = await getRepo();
    return ok({ signals: await repo.listCapacitySignals([actor.hospitalId]) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor || !can(actor, 'queue:manage') && !can(actor, 'facts:manage')) return fail(403, 'Capacity publishing permission required.');
    const body = Body.parse(await readJson(req, 2000));
    const repo = await getRepo();
    const signal = await repo.publishCapacitySignal({
      hospitalId: actor.hospitalId, serviceSlug: body.serviceSlug ?? null, available: body.available ?? null,
      queueWaitMinutes: body.queueWaitMinutes ?? null, waitingCount: body.waitingCount ?? null,
      note: body.note ?? null, source: 'hospital_published', expiresAt: body.expiresAt ?? null,
    });
    return ok({ signal }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
