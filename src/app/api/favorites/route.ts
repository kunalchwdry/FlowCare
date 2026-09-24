import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { track } from '@/lib/analytics';
import { fail, handleError, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ hospitalId: z.string().min(1).max(120), note: z.string().max(280).nullish() }).strict();

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to see your saved hospitals.');
    const repo = await getRepo();
    // Scoped by user id here AND by RLS in the database.
    const favorites = await repo.listFavorites(user.id);
    const hospitals = await repo.listHospitals();
    const byId = new Map(hospitals.map((h) => [h.id, h]));
    return ok({
      favorites: favorites
        .map((f) => ({ ...f, hospital: byId.get(f.hospitalId) ?? null }))
        .filter((f) => f.hospital !== null),
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to save hospitals.');
    const { hospitalId, note } = Body.parse(await readJson(req, 2000));

    const repo = await getRepo();
    const hospital = await repo.getHospital(hospitalId);
    if (!hospital) return fail(404, 'Hospital not found');

    const fav = await repo.addFavorite(user.id, hospital.id, note ?? null);
    track('favorite_added', req.headers.get('x-flowcare-session') ?? 'anon', { hospital_id: hospital.id });
    await repo.recordAuditEvent({
      actorId: user.id, actorRole: user.role, action: 'favorite.add',
      entity: 'hospital_favorite', entityId: hospital.id, metadata: { hospital_id: hospital.id },
    });
    return ok({ favorite: fav }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to manage saved hospitals.');
    const hospitalId = req.nextUrl.searchParams.get('hospitalId');
    if (!hospitalId) return fail(400, 'hospitalId is required');

    const repo = await getRepo();
    await repo.removeFavorite(user.id, hospitalId);
    track('favorite_removed', req.headers.get('x-flowcare-session') ?? 'anon', { hospital_id: hospitalId });
    await repo.recordAuditEvent({
      actorId: user.id, actorRole: user.role, action: 'favorite.remove',
      entity: 'hospital_favorite', entityId: hospitalId, metadata: { hospital_id: hospitalId },
    });
    return ok({ removed: true });
  } catch (e) {
    return handleError(e);
  }
}
