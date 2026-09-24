/**
 * F18 — Per-field provenance and freshness.
 *
 * Generalises the discipline already proven in discovery/availability.ts to
 * every fact in the product. Nine other features consume this module.
 *
 * Doctrine (docs/research/03-review-and-plan.md §10.1 R3):
 *  - `verifiedAt: null` renders as "not verified". It must NEVER render fresh.
 *  - Google-sourced fields render as "live" and carry no verification date,
 *    because FlowCare did not verify them and does not store them.
 *  - "Verified" means a person checked on that date. It does not mean
 *    "guaranteed". The methodology page says so in those words.
 *  - There is deliberately NO aggregate trust score for a facility. Collapsing
 *    freshness into a badge would recreate the composite-quality problem the
 *    rating work avoids.
 */
import type {
  FactView, FreshnessState, FreshnessView, Provenance, SourceType,
} from '@/lib/types';

export const PROVENANCE_METHOD_VERSION = 'fc-provenance-v1';

/** Every fact type FlowCare tracks freshness for. */
export const FACT_FIELDS = [
  'phone', 'address', 'hours', 'services', 'schemes', 'charges',
  'accessibility', 'languages', 'arrival', 'routes', 'prep', 'arrival_guidance',
  'late_policy',
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

/**
 * Time-to-live per field, in days. Beyond `ttl` a fact is "ageing"; beyond
 * `2 × ttl` it is "stale" and is shown with an explicit caution.
 *
 * These numbers are a starting position, not measured truth. Experiment E1
 * (repeat secret-shopper audit at 6 and 12 months) exists to replace them with
 * an observed decay rate. Documented in docs/research/sources.md Appendix B.
 */
export const FACT_TTL_DAYS: Record<FactField, number> = {
  phone: 90,
  address: 180,
  hours: 180,
  services: 180,
  schemes: 90,
  charges: 180,
  accessibility: 365,
  languages: 365,
  arrival: 365,
  routes: 365,
  prep: 180,
  arrival_guidance: 180,
  late_policy: 365,
};

const SOURCE_LABELS: Record<SourceType, string> = {
  flowcare_field_check: 'FlowCare field check',
  hospital_confirmed: 'Hospital confirmed',
  hospital_published: 'Hospital published',
  official_registry: 'Official registry',
  user_reported_pending: 'Reported by a user — being checked',
  google_live: 'Google',
};

export function sourceLabel(source: SourceType): string {
  return SOURCE_LABELS[source];
}

/** Is this fact one FlowCare itself stands behind? Drives UI treatment. */
export function isFlowcareVerified(p: Provenance): boolean {
  return (
    p.verifiedAt !== null &&
    (p.source === 'flowcare_field_check' ||
      p.source === 'hospital_confirmed' ||
      p.source === 'hospital_published' ||
      p.source === 'official_registry')
  );
}

const DATE_FMT = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
});

export function formatVerifiedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown date';
  return DATE_FMT.format(d);
}

export function ageInDays(iso: string, now: Date = new Date()): number {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

/**
 * The single freshness computation for the whole product.
 *
 * Google content short-circuits to `live`: we fetched it this request and we
 * do not store it, so a verification date would be a lie.
 */
export function freshnessOf(
  provenance: Provenance,
  field: FactField,
  now: Date = new Date(),
): FreshnessView {
  const ttlDays = FACT_TTL_DAYS[field];

  if (provenance.source === 'google_live') {
    return {
      state: 'live',
      ageDays: 0,
      ttlDays,
      label: 'Google · live',
      caution: null,
    };
  }

  if (!provenance.verifiedAt) {
    return {
      state: 'unverified',
      ageDays: null,
      ttlDays,
      label: `${sourceLabel(provenance.source)} · not verified`,
      caution: 'nobody has checked this',
    };
  }

  const ageDays = ageInDays(provenance.verifiedAt, now);
  const when = formatVerifiedDate(provenance.verifiedAt);
  const base = `${sourceLabel(provenance.source)} · ${when}`;

  let state: FreshnessState;
  let caution: string | null;
  if (ageDays <= ttlDays) {
    state = 'fresh';
    caution = null;
  } else if (ageDays <= ttlDays * 2) {
    state = 'ageing';
    caution = 'checked a while ago';
  } else {
    state = 'stale';
    caution = 'may be out of date';
  }

  return { state, ageDays, ttlDays, label: base, caution };
}

export function toFactView<T>(
  value: T,
  provenance: Provenance,
  field: FactField,
  now: Date = new Date(),
): FactView<T> {
  return { value, provenance, freshness: freshnessOf(provenance, field, now) };
}

/** Convenience constructor so seed/repo code stays readable. */
export function provenance(
  source: SourceType,
  verifiedAt: string | null,
  opts: { sourceUrl?: string | null; verifiedByRole?: string | null } = {},
): Provenance {
  return {
    source,
    verifiedAt,
    sourceUrl: opts.sourceUrl ?? null,
    verifiedByRole: opts.verifiedByRole ?? null,
  };
}

export const UNVERIFIED: Provenance = {
  source: 'user_reported_pending',
  verifiedAt: null,
  sourceUrl: null,
  verifiedByRole: null,
};

/**
 * A facility-level summary — counts only, never a score.
 * Explicitly NOT a "trust rating": see the doctrine note at the top.
 */
export interface FreshnessSummary {
  total: number;
  fresh: number;
  ageing: number;
  stale: number;
  unverified: number;
  /** Median age in days across verified facts, or null when none are verified. */
  medianAgeDays: number | null;
  /** Most recent verification across all facts. */
  lastCheckedAt: string | null;
}

export function summariseFreshness(
  items: Array<{ provenance: Provenance; field: FactField }>,
  now: Date = new Date(),
): FreshnessSummary {
  const summary: FreshnessSummary = {
    total: items.length, fresh: 0, ageing: 0, stale: 0, unverified: 0,
    medianAgeDays: null, lastCheckedAt: null,
  };
  const ages: number[] = [];

  for (const item of items) {
    const f = freshnessOf(item.provenance, item.field, now);
    if (f.state === 'fresh' || f.state === 'live') summary.fresh += 1;
    else if (f.state === 'ageing') summary.ageing += 1;
    else if (f.state === 'stale') summary.stale += 1;
    else summary.unverified += 1;

    if (item.provenance.verifiedAt) {
      ages.push(ageInDays(item.provenance.verifiedAt, now));
      if (!summary.lastCheckedAt || item.provenance.verifiedAt > summary.lastCheckedAt) {
        summary.lastCheckedAt = item.provenance.verifiedAt;
      }
    }
  }

  if (ages.length) {
    ages.sort((a, b) => a - b);
    const mid = Math.floor(ages.length / 2);
    summary.medianAgeDays = ages.length % 2
      ? ages[mid]
      : (ages[mid - 1] + ages[mid]) / 2;
  }

  return summary;
}

/**
 * The metric recommended in docs/research/03-review-and-plan.md §14.6:
 * "median age of the facts a patient sees before they decide".
 */
export function medianFactAgeDays(
  items: Array<{ provenance: Provenance; field: FactField }>,
  now: Date = new Date(),
): number | null {
  return summariseFreshness(items, now).medianAgeDays;
}
