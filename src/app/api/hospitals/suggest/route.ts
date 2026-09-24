import { NextRequest } from 'next/server';
import { suggestQueries } from '@/lib/ai/fallback';
import { getRepo } from '@/lib/data';
import { handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Search suggestions built from FlowCare's own taxonomy plus hospital names.
 * No LLM and no Google call: this must be instant and free.
 */
export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 80);
    if (q.trim().length < 1) return ok({ suggestions: [] });

    const taxonomy = suggestQueries(q, 6);
    const repo = await getRepo();
    const hospitals = await repo.listHospitals();
    const needle = q.toLowerCase();
    const nameHits = hospitals
      .filter((h) => h.name.toLowerCase().includes(needle) || h.addressLine.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((h) => ({ label: h.name, href: `/hospitals/${h.slug}`, kind: 'Hospital' }));

    return ok({ suggestions: [...nameHits, ...taxonomy].slice(0, 10) });
  } catch (e) {
    return handleError(e);
  }
}
