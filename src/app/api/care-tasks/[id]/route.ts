import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { hospitalActorFromSession } from '@/lib/auth/hospital';
import { fail, handleError, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']),
  resolution: z.string().trim().max(1000).nullable().optional(),
}).strict();

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to update a care task.');
    const { id } = await ctx.params;
    const body = Body.parse(await readJson(req, 2000));
    const actor = await hospitalActorFromSession();
    const actorId = actor?.hospitalId ?? user.id;
    const repo = await getRepo();
    const task = await repo.updateCareTask(id, actorId, body.status, body.resolution ?? null);
    return ok({ task });
  } catch (e) {
    return handleError(e);
  }
}
