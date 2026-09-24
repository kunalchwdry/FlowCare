/**
 * Transparent preference matching.  Method id: `fc-match-v1`.
 * -------------------------------------------------------------------------
 * This is a DISCOVERY preference score, not a quality or clinical score.
 * Rules we hold ourselves to:
 *  - Every criterion comes from something the patient explicitly selected.
 *  - Every criterion's weight, sub-score and evidence string is returned to
 *    the UI, so "92% match" can always be expanded into its arithmetic.
 *  - No hidden clinical risk modelling, no inferred health attributes.
 *  - A percentage is only rendered when at least two criteria were supplied
 *    (`displayable`), otherwise a single filter would trivially produce 100%.
 *  - We never call a hospital "best" or "recommended for your condition".
 */
import type {
  DiscoveryResult, MatchCriterionContribution, MatchExplanation,
} from '@/lib/types';
import type { DiscoveryFilters } from './filters';
import { label } from './filters';

export const MATCH_METHOD_VERSION = 'fc-match-v1';

export const MATCH_WEIGHTS = {
  specialty: 30,
  availability: 22,
  distance: 20,
  flowcareRating: 12,
  googleRating: 6,
  services: 4,
  accessibility: 3,
  language: 3,
} as const;

export interface MatchPreference {
  prioritise?: Array<'distance' | 'rating' | 'availability' | 'review_count' | 'accessibility' | 'language'>;
}

const PRIORITY_BOOST = 1.6;

function boosted(base: number, keys: string[], pref?: MatchPreference): number {
  if (!pref?.prioritise?.length) return base;
  return pref.prioritise.some((p) => keys.includes(p)) ? base * PRIORITY_BOOST : base;
}

export function computeMatch(
  result: Omit<DiscoveryResult, 'match'>,
  filters: DiscoveryFilters,
  pref?: MatchPreference,
): MatchExplanation {
  const criteria: MatchCriterionContribution[] = [];
  const push = (c: MatchCriterionContribution) => criteria.push(c);

  const { hospital, distanceKm, availability, flowcareRating, external } = result;

  if (filters.specialties?.length) {
    const have = new Set(hospital.departments.filter((d) => d.active).map((d) => d.specialty));
    const matched = filters.specialties.filter((s) => have.has(s));
    const score = matched.length / filters.specialties.length;
    push({
      criterion: 'specialty',
      label: 'Departments you selected',
      weight: MATCH_WEIGHTS.specialty,
      score,
      contribution: MATCH_WEIGHTS.specialty * score,
      evidence: matched.length
        ? `${matched.map(label).join(', ')} available here`
        : `None of ${filters.specialties.map(label).join(', ')} listed`,
    });
  }

  if (filters.availability?.length || filters.availableWithinDays) {
    const score =
      availability.state === 'available' ? 1
      : availability.state === 'limited' ? 0.6
      : availability.state === 'unknown' ? 0.2
      : 0;
    const w = boosted(MATCH_WEIGHTS.availability, ['availability'], pref);
    push({
      criterion: 'availability',
      label: 'Appointment availability',
      weight: w,
      score,
      contribution: w * score,
      evidence:
        availability.state === 'unknown'
          ? 'FlowCare has no session data for this hospital'
          : `${label(availability.state)}${availability.nextAvailableDate ? ` — next slot ${availability.nextAvailableDate}` : ''} (checked ${new Date(availability.computedAt).toLocaleString()})`,
    });
  }

  if (filters.near && distanceKm !== null) {
    const radius = filters.radiusKm ?? 15;
    const score = Math.max(0, 1 - distanceKm / Math.max(radius, 1));
    const w = boosted(MATCH_WEIGHTS.distance, ['distance'], pref);
    push({
      criterion: 'distance',
      label: 'Closeness to your location',
      weight: w,
      score,
      contribution: w * score,
      evidence: `${distanceKm.toFixed(1)} km straight-line from your search point (within your ${radius} km preference)`,
    });
  }

  if (filters.minFlowcareRating !== undefined) {
    const s = flowcareRating.score;
    const score = s === null ? 0.25 : Math.max(0, Math.min(1, (s - filters.minFlowcareRating) / (5 - filters.minFlowcareRating + 0.001)));
    const w = boosted(MATCH_WEIGHTS.flowcareRating, ['rating', 'review_count'], pref);
    push({
      criterion: 'flowcareRating',
      label: 'FlowCare verified-visit rating',
      weight: w,
      score: s === null ? 0.25 : score,
      contribution: w * (s === null ? 0.25 : score),
      evidence: s === null
        ? flowcareRating.insufficientReason ?? 'Not enough FlowCare reviews yet'
        : `${s.toFixed(1)} from ${flowcareRating.reviewCount} verified visits`,
    });
  }

  if (filters.minGoogleRating !== undefined) {
    const g = external.data?.rating;
    const score = g === undefined ? 0.25 : Math.max(0, Math.min(1, (g - filters.minGoogleRating) / (5 - filters.minGoogleRating + 0.001)));
    const w = boosted(MATCH_WEIGHTS.googleRating, ['rating'], pref);
    push({
      criterion: 'googleRating',
      label: 'Google rating',
      weight: w,
      score,
      contribution: w * score,
      evidence: g === undefined
        ? 'No Google rating retrieved for this hospital'
        : `${g.toFixed(1)} ★ on Google from ${external.data?.userRatingCount ?? 0} ratings`,
    });
  }

  if (filters.services?.length) {
    const have = new Set(hospital.services.map((s) => s.slug));
    const matched = filters.services.filter((s) => have.has(s));
    const score = matched.length / filters.services.length;
    push({
      criterion: 'services',
      label: 'Services you selected',
      weight: MATCH_WEIGHTS.services,
      score,
      contribution: MATCH_WEIGHTS.services * score,
      evidence: matched.length ? `${matched.map(label).join(', ')} on site` : 'None of the selected services listed',
    });
  }

  if (filters.accessibility?.length) {
    const have = new Set(hospital.accessibility);
    const matched = filters.accessibility.filter((a) => have.has(a));
    const score = matched.length / filters.accessibility.length;
    const w = boosted(MATCH_WEIGHTS.accessibility, ['accessibility'], pref);
    push({
      criterion: 'accessibility',
      label: 'Accessibility features',
      weight: w,
      score,
      contribution: w * score,
      evidence: matched.length ? matched.map(label).join(', ') : 'Selected accessibility features not recorded',
    });
  }

  if (filters.languages?.length) {
    const have = new Set(hospital.languages);
    const matched = filters.languages.filter((l) => have.has(l));
    const score = matched.length / filters.languages.length;
    const w = boosted(MATCH_WEIGHTS.language, ['language'], pref);
    push({
      criterion: 'language',
      label: 'Language support',
      weight: w,
      score,
      contribution: w * score,
      evidence: matched.length ? `Staff support ${matched.map(label).join(', ')}` : 'Selected languages not recorded',
    });
  }

  const totalWeight = criteria.reduce((a, c) => a + c.weight, 0);
  const totalContribution = criteria.reduce((a, c) => a + c.contribution, 0);
  const percent = totalWeight === 0 ? 0 : Math.round((totalContribution / totalWeight) * 100);

  const displayable = criteria.length >= 2;
  const selected = criteria.map((c) => c.label.toLowerCase());
  const summary = displayable
    ? `Matched because you selected ${selected.slice(0, -1).join(', ')}${selected.length > 1 ? ' and ' : ''}${selected.at(-1)}.`
    : 'Add more preferences to see a preference match score.';

  return { percent, displayable, criteria, summary, methodVersion: MATCH_METHOD_VERSION };
}
