import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { loadHospitalDetail } from '@/lib/discovery/search';
import { makeExternalFetcher } from '@/lib/places/enrich';
import { summariseFlowcareReviews } from '@/lib/reviews/moderation';
import { toPublicReviews } from '@/lib/reviews/publicView';
import { explainRating } from '@/lib/discovery/rating';
import { track } from '@/lib/analytics';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const repo = await getRepo();
    const detail = await loadHospitalDetail(id, { repo, fetchExternal: makeExternalFetcher() });
    if (!detail) return fail(404, 'Hospital not found');

    const reviews = await repo.listReviews({ hospitalId: detail.hospital.id });
    track('hospital_viewed', req.headers.get('x-flowcare-session') ?? 'anon', { hospital_id: detail.hospital.id });

    return ok({
      ...detail,
      ratingExplanation: explainRating(detail.flowcareRating),
      reviews: toPublicReviews(reviews.slice(0, 20)),
      flowcareReviewSummary: summariseFlowcareReviews(reviews),
    });
  } catch (e) {
    return handleError(e);
  }
}
