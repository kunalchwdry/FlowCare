/**
 * F9 — Preparation checklist.
 *
 * Tells a patient what to BRING and what to DO ADMINISTRATIVELY before a
 * visit. It must never tell them what to do medically.
 *
 * The line matters more than it looks. "Come fasting" is the single most
 * requested preparation string and it is a clinical instruction: fasting is
 * unsafe for some diabetic patients, and FlowCare does not know who is
 * diabetic (and by §9.1 must never know). So the blocklist below is enforced
 * in CI over all seed content and at the repository boundary over all
 * user-submitted corrections.
 *
 * The rule is: FlowCare carries administrative facts. Clinical instructions
 * come from the clinician, through the hospital, every time.
 */

export const PREP_METHOD_VERSION = 'fc-prep-v1';

/**
 * Patterns that make a string clinical rather than administrative.
 * Deliberately over-broad: a false positive costs one rewritten seed line,
 * a false negative ships medical advice from a directory.
 */
export const CLINICAL_BLOCKLIST: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bfast(ing|ed)?\b/i, why: 'fasting instruction' },
  { pattern: /\bnil by mouth\b/i, why: 'fasting instruction' },
  { pattern: /\bnpo\b/i, why: 'fasting instruction (NPO)' },
  { pattern: /\bempty stomach\b/i, why: 'fasting instruction' },
  { pattern: /\bdo not eat\b/i, why: 'fasting instruction' },
  { pattern: /\b(stop|skip|pause|discontinue|hold) (taking |your )?(medicine|medication|tablet|drug|dose)/i, why: 'medication change' },
  { pattern: /\bstop taking\b/i, why: 'medication change' },
  { pattern: /\btake \d/i, why: 'dosing instruction' },
  { pattern: /\b\d+\s?(mg|ml|mcg|iu|units?)\b/i, why: 'dosage' },
  { pattern: /\bdos(e|age)\b/i, why: 'dosage' },
  { pattern: /\binsulin\b/i, why: 'medication-specific instruction' },
  { pattern: /\b(warfarin|metformin|aspirin|steroid|antibiotic|painkiller)\b/i, why: 'medication-specific instruction' },
  { pattern: /\b(blood thinner|anticoagulant)\b/i, why: 'medication-specific instruction' },
  { pattern: /\bdrink \d+\s?(glass|litre|liter|ml)/i, why: 'clinical preparation' },
  { pattern: /\bfull bladder\b/i, why: 'clinical preparation' },
  { pattern: /\b(enema|laxative|bowel prep)\b/i, why: 'clinical preparation' },
  { pattern: /\bshave\b/i, why: 'clinical preparation' },
  { pattern: /\byou (may|might|could) have\b/i, why: 'implied diagnosis' },
  // Narrow forms only: "diagnostic lab" and "bring previous prescriptions" are
  // administrative facts, whereas "your diagnosis" and "we prescribe" are not.
  { pattern: /\bdiagnos(is|es|ed|ing)\b/i, why: 'clinical content' },
  { pattern: /\bsymptom\w*\b/i, why: 'clinical content' },
  { pattern: /\btreatment plan\b/i, why: 'clinical content' },
  { pattern: /\bprescrib\w*\b/i, why: 'clinical content' },
];

export interface BlocklistHit {
  why: string;
  matched: string;
}

/** Returns every reason the text is clinical. Empty array = administrative. */
export function findClinicalContent(text: string): BlocklistHit[] {
  const hits: BlocklistHit[] = [];
  for (const { pattern, why } of CLINICAL_BLOCKLIST) {
    const m = pattern.exec(text);
    if (m) hits.push({ why, matched: m[0] });
  }
  return hits;
}

export function isAdministrative(text: string): boolean {
  return findClinicalContent(text).length === 0;
}

export class ClinicalContentError extends Error {
  readonly hits: BlocklistHit[];
  constructor(hits: BlocklistHit[]) {
    super(
      `Preparation text contains clinical content and cannot be stored: ${hits
        .map((h) => `${h.why} ("${h.matched}")`)
        .join(', ')}`,
    );
    this.name = 'ClinicalContentError';
    this.hits = hits;
  }
}

/**
 * Enforcement point. Called by the seed builder, by the repository before
 * any preparation text is written, and by the correction workflow.
 */
export function assertAdministrative(text: string): void {
  const hits = findClinicalContent(text);
  if (hits.length) throw new ClinicalContentError(hits);
}

/**
 * The standing referral shown wherever preparation appears. This is the
 * feature's honest boundary, not boilerplate.
 */
export const CLINICAL_REFERRAL_NOTICE =
  'This list covers documents and payments only. If you need to know about ' +
  'eating, drinking or your medicines before this visit, ask the hospital or ' +
  'your doctor — FlowCare does not hold that information and will not guess.';

/* ---------------------------------------------------------------------- */

import type { PrepRequirement, FactView } from '@/lib/types';
import { toFactView } from '@/lib/provenance';

export interface ChecklistItem {
  code: string;
  text: string;
  appliesTo: PrepRequirement['appliesTo'];
  /** True when this item is shown because of the patient's own situation. */
  conditional: boolean;
}

export interface PrepChecklist {
  items: Array<FactView<ChecklistItem>>;
  notice: string;
  /** True when the hospital has published nothing — we say so, not guess. */
  empty: boolean;
  emptyMessage: string | null;
  version: string;
}

export interface ChecklistContext {
  firstVisit: boolean;
  usingScheme: boolean;
  isProcedure: boolean;
}

export const NO_PREP_MESSAGE =
  'This hospital has not published what to bring. Bring a government photo ' +
  'ID and any previous reports, and call ahead if you are using a scheme.';

/**
 * Assemble a checklist. Filtering is by the `appliesTo` enum only — no
 * inference about the patient beyond the three booleans they chose.
 */
export function buildChecklist(
  requirements: PrepRequirement[],
  context: ChecklistContext,
  now: Date = new Date(),
): PrepChecklist {
  const relevant = requirements.filter((r) => {
    if (r.appliesTo === 'all') return true;
    if (r.appliesTo === 'first_visit') return context.firstVisit;
    if (r.appliesTo === 'scheme_patients') return context.usingScheme;
    if (r.appliesTo === 'procedure') return context.isProcedure;
    return false;
  });

  const items = relevant.map((r) =>
    toFactView<ChecklistItem>(
      {
        code: r.code,
        text: r.text,
        appliesTo: r.appliesTo,
        conditional: r.appliesTo !== 'all',
      },
      r.provenance,
      'prep',
      now,
    ),
  );

  return {
    items,
    notice: CLINICAL_REFERRAL_NOTICE,
    empty: items.length === 0,
    emptyMessage: items.length === 0 ? NO_PREP_MESSAGE : null,
    version: PREP_METHOD_VERSION,
  };
}
