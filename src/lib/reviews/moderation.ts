/**
 * Review quality + safety heuristics.
 *
 * DESIGN RULE: nothing here deletes or hides content on its own. The output is
 * always `flag -> reason -> confidence -> human review`. The strongest
 * automated action is routing a submission to `pending` so a human moderator
 * sees it before it is published.
 */
import type { HospitalReview } from '@/lib/types';

export interface ModerationFlag {
  code: string;
  reason: string;
  /** 0..1, heuristic confidence. Never used to auto-remove. */
  confidence: number;
}

export interface ModerationVerdict {
  flags: ModerationFlag[];
  /** 'published' or 'pending' only — automation never emits 'removed'. */
  suggestedStatus: 'published' | 'pending';
  requiresHumanReview: boolean;
}

const URL_RE = /(https?:\/\/|www\.)\S+/i;
const PHONE_RE = /(?:\+?\d[\d\s-]{8,}\d)/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const ABUSE_RE = /\b(idiot|stupid|scam|fraud|thief|useless bastards?|kill (him|her|them))\b/i;
/** Clinical claims we must not host as if verified. Flag for a human, never auto-publish. */
const CLINICAL_CLAIM_RE = /\b(misdiagnos\w*|malpractice|negligen\w*|wrong (medicine|dose|surgery)|died|death due to)\b/i;

export function normaliseForComparison(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Jaccard similarity on token sets — cheap, deterministic, explainable. */
export function similarity(a: string, b: string): number {
  const ta = new Set(normaliseForComparison(a).split(' ').filter(Boolean));
  const tb = new Set(normaliseForComparison(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

export function moderateSubmission(
  comment: string | null,
  context: { authorId: string; hospitalId: string; recentReviews: HospitalReview[] },
): ModerationVerdict {
  const flags: ModerationFlag[] = [];
  const text = (comment ?? '').trim();

  if (text.length > 0) {
    if (URL_RE.test(text)) flags.push({ code: 'contains_url', reason: 'Comment contains a link', confidence: 0.9 });
    if (PHONE_RE.test(text)) flags.push({ code: 'contains_phone', reason: 'Comment contains a phone number', confidence: 0.8 });
    if (EMAIL_RE.test(text)) flags.push({ code: 'contains_email', reason: 'Comment contains an email address', confidence: 0.8 });
    if (ABUSE_RE.test(text)) flags.push({ code: 'possible_abuse', reason: 'Comment may contain abusive language', confidence: 0.6 });
    if (CLINICAL_CLAIM_RE.test(text)) {
      flags.push({ code: 'clinical_allegation', reason: 'Comment contains a clinical allegation that needs human review', confidence: 0.7 });
    }
    if (text.length > 40 && /(.)\1{6,}/.test(text)) {
      flags.push({ code: 'repeated_characters', reason: 'Comment contains long character repetition', confidence: 0.7 });
    }
    const letters = text.replace(/[^A-Za-z]/g, '');
    if (letters.length > 20 && letters === letters.toUpperCase()) {
      flags.push({ code: 'all_caps', reason: 'Comment is entirely upper case', confidence: 0.4 });
    }

    for (const prev of context.recentReviews) {
      if (!prev.comment) continue;
      const sim = similarity(text, prev.comment);
      if (sim >= 0.85) {
        flags.push({
          code: prev.authorId === context.authorId ? 'duplicate_self' : 'duplicate_other',
          reason: prev.authorId === context.authorId
            ? 'Nearly identical to another review by the same author'
            : 'Nearly identical to an existing review from a different author',
          confidence: Math.min(0.95, sim),
        });
        break;
      }
    }
  }

  const requiresHumanReview = flags.some((f) => f.confidence >= 0.6);
  return {
    flags,
    suggestedStatus: requiresHumanReview ? 'pending' : 'published',
    requiresHumanReview,
  };
}

/** Summary of FlowCare reviews — computed from our own data, never by an LLM. */
export function summariseFlowcareReviews(reviews: HospitalReview[]): {
  available: boolean;
  reason: string | null;
  positives: Array<{ theme: string; count: number }>;
  negatives: Array<{ theme: string; count: number }>;
  basedOn: number;
} {
  const MIN = 8;
  const published = reviews.filter((r) => r.status === 'published');
  if (published.length < MIN) {
    return {
      available: false,
      reason: `A FlowCare review summary appears once there are at least ${MIN} verified reviews (currently ${published.length}).`,
      positives: [], negatives: [], basedOn: published.length,
    };
  }
  const dims: Array<[keyof HospitalReview['ratings'], string]> = [
    ['waiting', 'Waiting experience'],
    ['staff', 'Staff experience'],
    ['appointment', 'Appointment experience'],
    ['facility', 'Facility experience'],
  ];
  const positives: Array<{ theme: string; count: number }> = [];
  const negatives: Array<{ theme: string; count: number }> = [];
  for (const [key, theme] of dims) {
    const high = published.filter((r) => r.ratings[key] >= 4).length;
    const low = published.filter((r) => r.ratings[key] <= 2).length;
    if (high / published.length >= 0.6) positives.push({ theme, count: high });
    if (low / published.length >= 0.25) negatives.push({ theme, count: low });
  }
  return { available: true, reason: null, positives, negatives, basedOn: published.length };
}
