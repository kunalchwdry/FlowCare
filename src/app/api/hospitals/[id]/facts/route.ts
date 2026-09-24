import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { track } from '@/lib/analytics';
import { fail, handleError, ok } from '@/lib/http';
import { buildFacilityFactsView } from '@/lib/journey/factsView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Every fact FlowCare holds about one facility, each carrying its own
 * provenance and freshness (F18). Public: this is directory data.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const repo = await getRepo();
    const hospital = await repo.getHospital(id);
    if (!hospital) return fail(404, 'Hospital not found');

    const sp = req.nextUrl.searchParams;
    const facts = await repo.getFacilityFacts(hospital.id);

    const view = buildFacilityFactsView(
      facts,
      hospital.services.map((s) => ({ slug: s.slug, name: s.name })),
      {
        firstVisit: sp.get('firstVisit') !== 'false',
        usingScheme: sp.get('scheme') === 'true',
        isProcedure: sp.get('procedure') === 'true',
      },
    );

    track('facility_facts_viewed', req.headers.get('x-flowcare-session') ?? 'anon', {
      hospital_id: hospital.id,
      fact_count: view.freshness.total,
      stale_count: view.freshness.stale,
    });

    return ok({ hospitalId: hospital.id, facts: view });
  } catch (e) {
    return handleError(e);
  }
}
