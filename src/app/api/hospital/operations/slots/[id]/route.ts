import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { hospitalActorFromSession } from '@/lib/auth/hospital';
import { fail, handleError, ok, readJson } from '@/lib/http';
import type { NewOperationalSlot } from '@/lib/operations/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor) return fail(401, 'Sign in to the hospital portal.');
    if (!actor.permissions.includes('slots:manage') && !actor.permissions.includes('structure:manage')) return fail(403, 'Your hospital permission does not allow slot management.');
    const { id } = await ctx.params;
    const body = await readJson<Record<string, unknown>>(req);
    const repo = await getRepo();
    const slot = (await repo.listOperationalSlots(actor.hospitalId)).find((row) => row.id === id);
    if (!slot) return fail(404, 'Slot not found.');
    const updated = await repo.updateOperationalSlot(id, {
      bookingOpen: body.bookingOpen == null ? undefined : Boolean(body.bookingOpen),
      capacity: body.capacity == null ? undefined : Number(body.capacity),
      slotType: body.slotType as NewOperationalSlot['slotType'] | undefined,
      waitlistEnabled: body.waitlistEnabled == null ? undefined : Boolean(body.waitlistEnabled),
      approvalResponseWindowMinutes: body.approvalResponseWindowMinutes == null ? undefined : Number(body.approvalResponseWindowMinutes),
      recoveryPolicy: body.recoveryPolicy as NewOperationalSlot['recoveryPolicy'] | undefined,
      expiresAt: body.expiresAt == null ? undefined : String(body.expiresAt),
    });
    return ok({ slot: updated });
  } catch (e) { return handleError(e); }
}
