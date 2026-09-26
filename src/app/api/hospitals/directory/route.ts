import { getRepo } from '@/lib/data';
import { handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Flat hospital list for pickers (staff registration, filters).
 *
 * Deliberately minimal: identity and location only. Anything richer belongs
 * to /api/hospitals/search, which carries the provenance envelope.
 */
export async function GET() {
  try {
    const repo = await getRepo();
    const hospitals = await repo.listHospitals();
    const items = hospitals
      .map((h) => ({ id: h.id, slug: h.slug, name: h.name, city: h.city ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return ok({ hospitals: items, count: items.length });
  } catch (e) {
    return handleError(e);
  }
}
