import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to manage your visit history.');
    const { id } = await ctx.params;
    const repo = await getRepo();
    await repo.deleteVisitRecord(user.id, id);
    await repo.recordAuditEvent({
      actorId: user.id, actorRole: user.role, action: 'visit_record.delete',
      entity: 'visit_record', entityId: id, metadata: {},
    });
    return ok({ removed: true });
  } catch (e) {
    return handleError(e);
  }
}
