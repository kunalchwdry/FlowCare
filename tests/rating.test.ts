import { describe, expect, it } from 'vitest';
import {
  RATING_CONSTANTS, aggregateHospitalRating, explainRating, isCountedReview, recencyWeight,
} from '../src/lib/discovery/rating';
import { makeReview, daysAgo } from './setup';

describe('FlowCare rating aggregation (fc-rating-v1)', () => {
  it('withholds a score below the minimum review threshold', () => {
    const reviews = Array.from({ length: RATING_CONSTANTS.MIN_PUBLISH_COUNT - 1 }, () =>
      makeReview({ ratings: { overall: 5, waiting: 5, staff: 5, appointment: 5, facility: 5 } }));
    const s = aggregateHospitalRating('h1', reviews, 3.8);
    expect(s.score).toBeNull();
    expect(s.insufficientReason).toBeTruthy();
    expect(s.reviewCount).toBe(RATING_CONSTANTS.MIN_PUBLISH_COUNT - 1);
  });

  it('publishes a score at exactly the threshold', () => {
    const reviews = Array.from({ length: RATING_CONSTANTS.MIN_PUBLISH_COUNT }, () => makeReview());
    const s = aggregateHospitalRating('h1', reviews, 3.8);
    expect(s.score).not.toBeNull();
    expect(s.insufficientReason).toBeNull();
  });

  it('counts only published, verified-visit reviews', () => {
    expect(isCountedReview(makeReview({ status: 'published' }))).toBe(true);
    expect(isCountedReview(makeReview({ status: 'pending' }))).toBe(false);
    expect(isCountedReview(makeReview({ status: 'hidden' }))).toBe(false);
    expect(isCountedReview(makeReview({ status: 'removed' }))).toBe(false);
    expect(isCountedReview(makeReview({ verifiedVisit: false }))).toBe(false);
  });

  it('excludes hidden and removed reviews from the published count', () => {
    const reviews = [
      ...Array.from({ length: 6 }, () => makeReview()),
      makeReview({ status: 'hidden', ratings: { overall: 1, waiting: 1, staff: 1, appointment: 1, facility: 1 } }),
      makeReview({ status: 'removed', ratings: { overall: 1, waiting: 1, staff: 1, appointment: 1, facility: 1 } }),
    ];
    const s = aggregateHospitalRating('h1', reviews, 3.8);
    expect(s.reviewCount).toBe(6);
    expect(s.rawMean).toBe(4);
  });

  it('is NOT a naive average — five 5-star reviews are shrunk toward the prior', () => {
    const five = Array.from({ length: 5 }, () =>
      makeReview({ ratings: { overall: 5, waiting: 5, staff: 5, appointment: 5, facility: 5 } }));
    const s = aggregateHospitalRating('h1', five, 3.8);
    expect(s.rawMean).toBe(5);
    expect(s.score!).toBeLessThan(5);
    expect(s.score!).toBeGreaterThan(3.8);
  });

  it('a hospital with many reviews converges closer to its raw mean than a thin one', () => {
    const thin = Array.from({ length: 5 }, () =>
      makeReview({ ratings: { overall: 5, waiting: 5, staff: 5, appointment: 5, facility: 5 } }));
    const thick = Array.from({ length: 200 }, () =>
      makeReview({ ratings: { overall: 5, waiting: 5, staff: 5, appointment: 5, facility: 5 } }));
    const a = aggregateHospitalRating('h1', thin, 3.8).score!;
    const b = aggregateHospitalRating('h1', thick, 3.8).score!;
    expect(b).toBeGreaterThan(a);
    expect(5 - b).toBeLessThan(5 - a);
  });

  it('weights recent reviews more heavily than old ones', () => {
    expect(recencyWeight(daysAgo(0))).toBeCloseTo(1, 2);
    expect(recencyWeight(daysAgo(540))).toBeLessThan(recencyWeight(daysAgo(0)));
    expect(recencyWeight(daysAgo(5000))).toBeGreaterThanOrEqual(RATING_CONSTANTS.RECENCY_FLOOR);
  });

  it('never returns a score outside 1..5 even with extreme input', () => {
    for (const v of [1, 5] as const) {
      const rs = Array.from({ length: 50 }, () =>
        makeReview({ ratings: { overall: v, waiting: v, staff: v, appointment: v, facility: v } }));
      const s = aggregateHospitalRating('h1', rs, 3.8).score!;
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(5);
    }
  });

  it('exposes a distribution and per-dimension means for transparency', () => {
    const rs = [
      makeReview({ ratings: { overall: 5, waiting: 3, staff: 5, appointment: 4, facility: 5 } }),
      makeReview({ ratings: { overall: 4, waiting: 2, staff: 4, appointment: 4, facility: 4 } }),
      makeReview({ ratings: { overall: 3, waiting: 1, staff: 3, appointment: 3, facility: 3 } }),
      makeReview({ ratings: { overall: 5, waiting: 4, staff: 5, appointment: 5, facility: 5 } }),
      makeReview({ ratings: { overall: 4, waiting: 2, staff: 4, appointment: 4, facility: 4 } }),
    ];
    const s = aggregateHospitalRating('h1', rs, 3.8);
    expect(Object.values(s.distribution).reduce((a, b) => a + b, 0)).toBe(5);
    expect(s.distribution['5']).toBe(2);
    // The waiting dimension is visibly worse than overall — it must not be hidden.
    expect(s.dimensionMeans!.waiting).toBeLessThan(s.dimensionMeans!.overall);
  });

  it('produces a confidence interval that narrows as reviews accumulate', () => {
    const w = (n: number) => {
      const s = aggregateHospitalRating('h1', Array.from({ length: n }, () => makeReview()), 3.8);
      return s.confidenceHigh! - s.confidenceLow!;
    };
    expect(w(100)).toBeLessThan(w(6));
  });

  it('explains its own methodology in plain language', () => {
    const s = aggregateHospitalRating('h1', Array.from({ length: 10 }, () => makeReview()), 3.8);
    const text = explainRating(s);
    expect(text.length).toBeGreaterThan(40);
    expect(text).toMatch(/verified|completed visit/i);
  });

  it('treats a hospital with zero reviews as "not enough", never as zero stars', () => {
    const s = aggregateHospitalRating('h1', [], 3.8);
    expect(s.score).toBeNull();
    expect(s.rawMean).toBeNull();
    expect(s.reviewCount).toBe(0);
  });
});
