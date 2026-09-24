import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Patch = z.object({ status: z.enum(['open', 'done', 'dismissed']) }).strict();

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to update reminders.');
    const { id } = await ctx.params;
    const { status } = Patch.parse(await readJson(req, 1000));

    const repo = await getRepo();
    const mine = await repo.listFollowUpTasks(user.id);
    if (!mine.some((t) => t.id === id)) return fail(404, 'Reminder not found');

    await repo.setFollowUpStatus(user.id, id, status);
    return ok({ updated: true, status });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to manage reminders.');
    const { id } = await ctx.params;
    const repo = await getRepo();
    await repo.deleteFollowUpTask(user.id, id);
    return ok({ removed: true });
  } catch (e) {
    return handleError(e);
  }
}
