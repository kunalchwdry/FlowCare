/**
 * FlowCare rating aggregation.  Method id: `fc-rating-v1`.
 * -------------------------------------------------------------------------
 * WHY NOT A PLAIN AVERAGE
 * Peer-reviewed work on physician/hospital rating sites repeatedly finds that
 * online provider ratings are based on very few reviews, are positively
 * skewed, and correlate poorly with large internal patient-experience surveys
 * until roughly 15+ reviews accumulate (Okike et al., J Gen Intern Med 2019;
 * Daskivich et al., JMIR 2018; Hong et al., JMIR 2019 systematic review).
 * A naive mean of 2 reviews therefore communicates precision that does not
 * exist. See docs/research/05-rating-reliability.md.
 *
 * THE MODEL (fully documented, deliberately simple, no hidden tuning)
 *   1. Only `published` reviews from verified FlowCare visits are counted.
 *   2. Each review gets a recency weight  w = max(FLOOR, 0.5 ^ (ageDays / HALF_LIFE_DAYS)).
 *   3. Score = Bayesian shrinkage toward the platform prior:
 *          score = (PRIOR_WEIGHT * priorMean + Σ wᵢrᵢ) / (PRIOR_WEIGHT + Σ wᵢ)
 *      i.e. a hospital with few reviews sits near the platform average and
 *      moves toward its own mean only as evidence accumulates.
 *   4. If reviewCount < MIN_PUBLISH_COUNT we publish NO score at all and the
 *      UI renders "Not enough FlowCare reviews yet".
 *   5. We always expose `rawMean`, `reviewCount`, the full star distribution
 *      and a confidence interval next to the score, so the shrinkage is
 *      visible rather than hidden.
 *
 * The prior mean is the platform-wide weighted mean, NOT a flattering
 * constant, so the model cannot be used to inflate a hospital above the
 * population it belongs to.
 */
import type {
  FlowCareRatingBreakdown,
  FlowCareRatingSummary,
  HospitalReview,
} from '@/lib/types';

export const RATING_METHOD_VERSION = 'fc-rating-v1';

export const RATING_CONSTANTS = {
  /** Below this many published reviews we publish no score. */
  MIN_PUBLISH_COUNT: 5,
  /** Equivalent number of "prior" reviews pulling toward the platform mean. */
  PRIOR_WEIGHT: 8,
  /** Used only when the platform has no reviews at all yet. */
  FALLBACK_PRIOR_MEAN: 3.8,
  /** A review's weight halves every N days... */
  HALF_LIFE_DAYS: 540,
  /** ...but never drops below this, so old reviews are never erased. */
  RECENCY_FLOOR: 0.35,
  /** z for the reported interval. */
  Z: 1.96,
} as const;

const DIMENSIONS: (keyof FlowCareRatingBreakdown)[] = [
  'overall', 'waiting', 'staff', 'appointment', 'facility',
];

export function isCountedReview(r: HospitalReview): boolean {
  // Two independent conditions, both required: the review must be published
  // AND it must be attached to a verified completed visit. The second guard
  // matters because a future import path could insert rows that bypass the
  // eligibility check in the route handler.
  return r.status === 'published' && r.verifiedVisit === true;
}

export function recencyWeight(createdAt: string, now: Date = new Date()): number {
  const ageMs = now.getTime() - new Date(createdAt).getTime();
  const ageDays = Math.max(0, ageMs / 86_400_000);
  const w = Math.pow(0.5, ageDays / RATING_CONSTANTS.HALF_LIFE_DAYS);
  return Math.max(RATING_CONSTANTS.RECENCY_FLOOR, Math.min(1, w));
}

/** Weighted platform-wide mean used as the shrinkage prior. */
export function computePriorMean(allReviews: HospitalReview[], now: Date = new Date()): number {
  const counted = allReviews.filter(isCountedReview);
  if (counted.length === 0) return RATING_CONSTANTS.FALLBACK_PRIOR_MEAN;
  let num = 0;
  let den = 0;
  for (const r of counted) {
    const w = recencyWeight(r.createdAt, now);
    num += w * r.ratings.overall;
    den += w;
  }
  return den === 0 ? RATING_CONSTANTS.FALLBACK_PRIOR_MEAN : num / den;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function aggregateHospitalRating(
  hospitalId: string,
  reviews: HospitalReview[],
  priorMean: number,
  now: Date = new Date(),
): FlowCareRatingSummary {
  const counted = reviews.filter((r) => r.hospitalId === hospitalId && isCountedReview(r));

  const distribution: FlowCareRatingSummary['distribution'] = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const r of counted) {
    const bucket = String(Math.min(5, Math.max(1, Math.round(r.ratings.overall)))) as keyof typeof distribution;
    distribution[bucket] += 1;
  }

  if (counted.length === 0) {
    return {
      hospitalId,
      score: null,
      reviewCount: 0,
      rawMean: null,
      distribution,
      dimensionMeans: null,
      confidenceLow: null,
      confidenceHigh: null,
      insufficientReason: 'No FlowCare reviews yet',
      methodVersion: RATING_METHOD_VERSION,
    };
  }

  const rawMean = counted.reduce((a, r) => a + r.ratings.overall, 0) / counted.length;

  const dimensionMeans = DIMENSIONS.reduce((acc, d) => {
    acc[d] = round(counted.reduce((a, r) => a + r.ratings[d], 0) / counted.length, 2);
    return acc;
  }, {} as FlowCareRatingBreakdown);

  if (counted.length < RATING_CONSTANTS.MIN_PUBLISH_COUNT) {
    return {
      hospitalId,
      score: null,
      reviewCount: counted.length,
      rawMean: round(rawMean),
      distribution,
      dimensionMeans,
      confidenceLow: null,
      confidenceHigh: null,
      insufficientReason: `Not enough FlowCare reviews yet (${counted.length} of ${RATING_CONSTANTS.MIN_PUBLISH_COUNT} needed)`,
      methodVersion: RATING_METHOD_VERSION,
    };
  }

  let wSum = 0;
  let wxSum = 0;
  for (const r of counted) {
    const w = recencyWeight(r.createdAt, now);
    wSum += w;
    wxSum += w * r.ratings.overall;
  }

  const score = (RATING_CONSTANTS.PRIOR_WEIGHT * priorMean + wxSum) / (RATING_CONSTANTS.PRIOR_WEIGHT + wSum);

  // Weighted variance -> standard error on the effective sample size.
  const weightedMean = wxSum / wSum;
  let varNum = 0;
  for (const r of counted) {
    const w = recencyWeight(r.createdAt, now);
    varNum += w * (r.ratings.overall - weightedMean) ** 2;
  }
  const variance = wSum > 0 ? varNum / wSum : 0;
  const effectiveN = wSum + RATING_CONSTANTS.PRIOR_WEIGHT;
  const se = Math.sqrt(Math.max(variance, 0.01) / effectiveN);
  const margin = RATING_CONSTANTS.Z * se;

  return {
    hospitalId,
    score: round(score),
    reviewCount: counted.length,
    rawMean: round(rawMean),
    distribution,
    dimensionMeans,
    confidenceLow: round(Math.max(1, score - margin)),
    confidenceHigh: round(Math.min(5, score + margin)),
    insufficientReason: null,
    methodVersion: RATING_METHOD_VERSION,
  };
}

/** Convenience: aggregate every hospital in one pass with a shared prior. */
export function aggregateAll(
  hospitalIds: string[],
  reviews: HospitalReview[],
  now: Date = new Date(),
): Record<string, FlowCareRatingSummary> {
  const prior = computePriorMean(reviews, now);
  const out: Record<string, FlowCareRatingSummary> = {};
  for (const id of hospitalIds) out[id] = aggregateHospitalRating(id, reviews, prior, now);
  return out;
}

/** Human-readable explanation string for the UI "How is this calculated?" popover. */
export function explainRating(summary: FlowCareRatingSummary): string {
  if (summary.score === null) {
    return `${summary.insufficientReason}. FlowCare publishes a score only after ${RATING_CONSTANTS.MIN_PUBLISH_COUNT} verified-visit reviews, because averages of very few reviews are statistically unreliable.`;
  }
  return (
    `${summary.score.toFixed(1)} from ${summary.reviewCount} verified-visit reviews. ` +
    `Raw average is ${summary.rawMean?.toFixed(2)}; the published score shrinks it toward the FlowCare platform average ` +
    `with a weight equal to ${RATING_CONSTANTS.PRIOR_WEIGHT} reviews, and weights recent reviews more heavily ` +
    `(half-life ${RATING_CONSTANTS.HALF_LIFE_DAYS} days, floor ${RATING_CONSTANTS.RECENCY_FLOOR}). ` +
    `Plausible range ${summary.confidenceLow?.toFixed(1)}–${summary.confidenceHigh?.toFixed(1)}. Method ${summary.methodVersion}.`
  );
}
