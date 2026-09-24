/**
 * Presentation assembly for facility facts.
 *
 * Route handlers and server components both need the same thing: raw facts
 * turned into FactViews carrying freshness, grouped the way the UI shows
 * them, with the mandatory caveats attached. Doing that here keeps the
 * caveats impossible to forget — SCHEME_CAVEAT ships with the scheme data,
 * not with whoever remembers to render it.
 */
import {
  freshnessOf, summariseFreshness, toFactView,
  type FactField, type FreshnessSummary,
} from '@/lib/provenance';
import { buildChecklist, type ChecklistContext, type PrepChecklist } from '@/lib/journey/prep';
import {
  ACCESSIBILITY_COMPONENTS, CHARGE_CAVEAT, CHARGE_TYPES, SCHEME_CAVEAT,
  WORKFLOW_STAGES,
} from '@/lib/journey/vocab';
import type { FacilityFacts } from '@/lib/data/repo';
import type {
  AccessibilityStatus, ArrivalPack, FactView, FreshnessView, Provenance,
  WayfindingRoute,
} from '@/lib/types';

/* ------------------------------------------------------------- F2 ------ */

export interface ServiceView {
  slug: string;
  name: string;
  /** Verified AT THIS LOCATION. Drives filter eligibility. */
  verified: boolean;
  /** True when someone reported it but nobody has checked. */
  pending: boolean;
  provenance: Provenance | null;
  freshnessLabel: string;
}

export const UNVERIFIED_SERVICE_NOTE =
  'Listed, but FlowCare has not confirmed it at this location. Call before ' +
  'you travel if this is the reason you are going.';

export function buildServiceViews(
  facts: FacilityFacts,
  hospitalServices: Array<{ slug: string; name: string }>,
  now: Date = new Date(),
): ServiceView[] {
  const byslug = new Map(facts.serviceVerifications.map((v) => [v.serviceSlug, v]));
  return hospitalServices.map((svc) => {
    const v = byslug.get(svc.slug);
    const verified = Boolean(v && v.method !== 'user_reported_pending' && v.provenance.verifiedAt);
    return {
      slug: svc.slug,
      name: svc.name,
      verified,
      pending: Boolean(v && !verified),
      provenance: v?.provenance ?? null,
      freshnessLabel: v
        ? freshnessOf(v.provenance, 'services', now).label
        : 'Not confirmed by FlowCare',
    };
  });
}

/* ------------------------------------------------------------- F4 ------ */

export interface SchemeView {
  code: string;
  name: string;
  listed: boolean;
  provenance: Provenance;
  freshness: FreshnessView;
}

export interface SchemePanel {
  items: SchemeView[];
  /** Non-dismissible. Rendered whether or not any scheme is listed (R4). */
  caveat: string;
  empty: boolean;
  emptyMessage: string | null;
}

export function buildSchemePanel(facts: FacilityFacts, now: Date = new Date()): SchemePanel {
  const items = facts.schemeListings
    .filter((s) => s.listingStatus === 'listed')
    .map((s) => {
      const f = freshnessOf(s.provenance, 'schemes', now);
      return {
        code: s.schemeCode,
        name: s.schemeName,
        listed: true,
        provenance: s.provenance,
        freshness: f,
      };
    });

  return {
    items,
    caveat: SCHEME_CAVEAT,
    empty: items.length === 0,
    emptyMessage: items.length === 0
      ? 'FlowCare has no scheme listing for this hospital. That is not the ' +
        'same as "not accepted" — we simply do not know. Ask the hospital.'
      : null,
  };
}

/* ------------------------------------------------------------- F5 ------ */

export interface ChargeView {
  chargeType: string;
  label: string;
  display: string;
  provenance: Provenance;
  freshness: FreshnessView;
}

export interface ChargePanel {
  items: ChargeView[];
  caveat: string;
  empty: boolean;
  emptyMessage: string | null;
}

function formatINR(n: number): string {
  return n === 0 ? 'No charge' : `₹${n.toLocaleString('en-IN')}`;
}

export function buildChargePanel(facts: FacilityFacts, now: Date = new Date()): ChargePanel {
  const labels = new Map(CHARGE_TYPES.map((c) => [c.code as string, c.label]));
  const items = facts.charges.map((c) => {
    const f = freshnessOf(c.provenance, 'charges', now);
    return {
      chargeType: c.chargeType,
      label: labels.get(c.chargeType) ?? c.chargeType,
      display: c.amountMin === c.amountMax
        ? formatINR(c.amountMin)
        : `${formatINR(c.amountMin)} – ${formatINR(c.amountMax)}`,
      provenance: c.provenance,
      freshness: f,
    };
  });

  return {
    items,
    caveat: CHARGE_CAVEAT,
    empty: items.length === 0,
    emptyMessage: items.length === 0
      ? 'This hospital has not published its OPD charges. FlowCare does not ' +
        'estimate prices, so there is nothing to show here.'
      : null,
  };
}

/* ------------------------------------------------------------- F7 ------ */

export interface AccessibilityView {
  code: string;
  label: string;
  question: string;
  status: AccessibilityStatus;
  statusLabel: string;
  standardReference: string | null;
  note: string | null;
  freshness: FreshnessView;
}

export interface AccessibilityPanel {
  items: AccessibilityView[];
  /**
   * Counts, NOT a score. Collapsing eleven components into "78% accessible"
   * is precisely the false-boolean problem this feature exists to fix (R7).
   */
  counts: Record<AccessibilityStatus, number>;
  assessed: boolean;
  notAssessedMessage: string | null;
}

const STATUS_LABELS: Record<AccessibilityStatus, string> = {
  meets_standard: 'Meets the standard',
  present_below_standard: 'Present, but below standard',
  not_present: 'Not present',
  not_assessed: 'Not assessed',
};

export function buildAccessibilityPanel(
  facts: FacilityFacts,
  now: Date = new Date(),
): AccessibilityPanel {
  const meta = new Map(ACCESSIBILITY_COMPONENTS.map((c) => [c.code as string, c]));
  const items = facts.accessibilityComponents.map((c) => {
    const f = freshnessOf(c.provenance, 'accessibility', now);
    const m = meta.get(c.componentCode);
    return {
      code: c.componentCode,
      label: m?.label ?? c.componentCode,
      question: m?.question ?? '',
      status: c.status,
      statusLabel: STATUS_LABELS[c.status],
      standardReference: c.standardReference,
      note: c.note,
      freshness: f,
    };
  });

  const counts: Record<AccessibilityStatus, number> = {
    meets_standard: 0, present_below_standard: 0, not_present: 0, not_assessed: 0,
  };
  for (const i of items) counts[i.status] += 1;

  const assessed = items.length > 0 && counts.not_assessed < items.length;

  return {
    items,
    counts,
    assessed,
    notAssessedMessage: assessed
      ? null
      : 'Nobody has assessed accessibility at this hospital yet. FlowCare ' +
        'will not guess from a generic "wheelchair accessible" label.',
  };
}

/* ------------------------------------------------------------- F8 ------ */

export interface LanguageStageView {
  stage: string;
  stageLabel: string;
  languages: string[];
  freshness: FreshnessView;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', hi: 'Hindi', mr: 'Marathi', gu: 'Gujarati',
  ta: 'Tamil', te: 'Telugu', kn: 'Kannada', bn: 'Bengali', ur: 'Urdu',
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

export interface LanguagePanel {
  stages: LanguageStageView[];
  /**
   * The point of F8: highlight where support DROPS relative to consultation,
   * because that gap is where the visit actually fails (P9).
   */
  gapWarning: string | null;
}

export function buildLanguagePanel(
  facts: FacilityFacts,
  now: Date = new Date(),
): LanguagePanel {
  const labels = new Map(WORKFLOW_STAGES.map((s) => [s.code as string, s.label]));
  const order = WORKFLOW_STAGES.map((s) => s.code as string);

  const stages = [...facts.languageSupport]
    .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage))
    .map((l) => {
      const f = freshnessOf(l.provenance, 'languages', now);
      return {
        stage: l.stage,
        stageLabel: labels.get(l.stage) ?? l.stage,
        languages: l.languages,
        freshness: f,
      };
    });

  const consultation = stages.find((s) => s.stage === 'consultation');
  const counter = stages.find((s) => s.stage === 'registration-counter');

  let gapWarning: string | null = null;
  if (consultation && counter) {
    const missing = consultation.languages.filter((l) => !counter.languages.includes(l));
    if (missing.length) {
      gapWarning =
        `${missing.map(languageName).join(' and ')} ${missing.length > 1 ? 'are' : 'is'} ` +
        'spoken in consultation but not reported at the registration counter, ' +
        'which is where your visit starts.';
    }
  }

  return { stages, gapWarning };
}

/* ------------------------------------------- F10 / F13 / F14 ----------- */

export interface ArrivalPanel {
  pack: FactView<ArrivalPack> | null;
  routes: Array<FactView<WayfindingRoute>>;
  /** Locales we actually have steps for. */
  availableLocales: string[];
  emptyMessage: string | null;
  /** F13 — never a predicted wait, only observed process facts (R13). */
  timingNotice: string;
}

export const TIMING_NOTICE =
  'FlowCare does not predict how long you will wait. Anything shown here ' +
  'describes the hospital\u2019s process, not your queue on the day.';

export function buildArrivalPanel(facts: FacilityFacts, now: Date = new Date()): ArrivalPanel {
  const pack = facts.arrivalPack
    ? toFactView(facts.arrivalPack, facts.arrivalPack.provenance, 'arrival', now)
    : null;
  const routes = facts.routes.map((r) => toFactView(r, r.provenance, 'routes', now));

  return {
    pack,
    routes,
    availableLocales: Array.from(new Set(routes.map((r) => r.value.locale))),
    emptyMessage: pack
      ? null
      : 'FlowCare has not mapped arrival at this hospital yet. Call ahead and ' +
        'ask which gate to use and where to register.',
    timingNotice: TIMING_NOTICE,
  };
}

/* ----------------------------------------------------- whole facility -- */

export interface FacilityFactsView {
  hospitalId: string;
  services: ServiceView[];
  schemes: SchemePanel;
  charges: ChargePanel;
  accessibility: AccessibilityPanel;
  languages: LanguagePanel;
  arrival: ArrivalPanel;
  prep: PrepChecklist;
  freshness: FreshnessSummary;
}

/** Everything the profile needs, with freshness computed once. */
export function buildFacilityFactsView(
  facts: FacilityFacts,
  hospitalServices: Array<{ slug: string; name: string }>,
  prepContext: ChecklistContext,
  now: Date = new Date(),
): FacilityFactsView {
  const forSummary: Array<{ provenance: Provenance; field: FactField }> = [
    ...facts.serviceVerifications.map((v) => ({ provenance: v.provenance, field: 'services' as const })),
    ...facts.schemeListings.map((v) => ({ provenance: v.provenance, field: 'schemes' as const })),
    ...facts.charges.map((v) => ({ provenance: v.provenance, field: 'charges' as const })),
    ...facts.accessibilityComponents.map((v) => ({ provenance: v.provenance, field: 'accessibility' as const })),
    ...facts.languageSupport.map((v) => ({ provenance: v.provenance, field: 'languages' as const })),
    ...facts.prepRequirements.map((v) => ({ provenance: v.provenance, field: 'prep' as const })),
    ...(facts.arrivalPack ? [{ provenance: facts.arrivalPack.provenance, field: 'arrival' as const }] : []),
  ];

  return {
    hospitalId: facts.hospitalId,
    services: buildServiceViews(facts, hospitalServices, now),
    schemes: buildSchemePanel(facts, now),
    charges: buildChargePanel(facts, now),
    accessibility: buildAccessibilityPanel(facts, now),
    languages: buildLanguagePanel(facts, now),
    arrival: buildArrivalPanel(facts, now),
    prep: buildChecklist(facts.prepRequirements, prepContext, now),
    freshness: summariseFreshness(forSummary, now),
  };
}
