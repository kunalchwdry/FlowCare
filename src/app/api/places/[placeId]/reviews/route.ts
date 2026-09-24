import { NextRequest } from 'next/server';
import { placeDetails } from '@/lib/places/client';
import { handleError, ok } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Google reviews + review summary, loaded lazily on user action because this
 * field mask triggers the Enterprise + Atmosphere SKU.
 *
 * Attribution obligations handled by the caller UI:
 *  - "Google Maps" attribution beside the content
 *  - each review shows its author attribution and links to Google Maps
 *  - AI review summaries show Google's own disclosure text
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ placeId: string }> }) {
  try {
    const rl = rateLimit(`greviews:${clientKey(req)}`, 20);
    if (!rl.allowed) return ok({ status: 'error', message: 'Too many requests. Try again shortly.', reviews: [] });

    const { placeId } = await ctx.params;
    const res = await placeDetails(placeId, 'reviews');

    if (res.status !== 'ok' || !res.data) {
      return ok({ status: res.status, message: res.message ?? null, reviews: [], reviewSummary: null });
    }

    return ok({
      status: 'ok',
      googleMapsUri: res.data.googleMapsUri ?? null,
      reviews: (res.data.reviews ?? []).map((r) => ({
        rating: r.rating ?? null,
        text: r.text?.text ?? null,
        relativeTime: r.relativePublishTimeDescription ?? null,
        author: r.authorAttribution?.displayName ?? null,
        authorUri: r.authorAttribution?.uri ?? null,
        authorPhotoUri: r.authorAttribution?.photoUri ?? null,
        flagContentUri: r.flagContentUri ?? null,
      })),
      reviewSummary: res.data.reviewSummary
        ? {
            text: res.data.reviewSummary.text?.text ?? null,
            disclosure: res.data.reviewSummary.disclosureText?.text ?? null,
            reviewsUri: res.data.reviewSummary.reviewsUri ?? null,
            flagContentUri: res.data.reviewSummary.flagContentUri ?? null,
          }
        : null,
      fetchedAt: res.data.fetchedAt,
      attribution: {
        provider: 'Google Maps',
        notice: 'Ratings, reviews and review summaries below are provided by Google and are not verified by FlowCare.',
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
