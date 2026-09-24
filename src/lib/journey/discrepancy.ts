import 'server-only';

/**
 * F16 — Cross-source discrepancy detector.
 *
 * Problem P23: when FlowCare's phone number and Google's phone number
 * disagree, today the patient discovers it by calling a dead line. S05 found
 * Google was the most accurate single source, so a disagreement is real
 * signal — but acting on it has a legal shape.
 *
 * THE CONSTRAINT THAT DEFINES THIS MODULE
 * Google Maps Service Terms §14.3 forbids warehousing Google content. A
 * discrepancy record that stored Google's phone number would be exactly that.
 * So we store a SALTED ONE-WAY FINGERPRINT of each side and nothing else:
 * enough to know "these differ" and "this is still the same disagreement as
 * last week", never enough to reconstruct the Google value.
 *
 * SHIPPING STATE: dark by default. `discrepancyDetectionConfigured()` requires
 * both an explicit flag and an operator-supplied salt. The open question
 * recorded in docs/research/03-review-and-plan.md §10.1 R16 — whether a
 * salted hash of Google content is itself "content" under §14.3 — has not
 * been answered by counsel. Until it is, this runs only where an operator
 * has consciously turned it on.
 */
import { createHash } from 'node:crypto';
import { env, discrepancyDetectionConfigured } from '@/lib/env';
import type { FieldDiscrepancy } from '@/lib/types';

export const DISCREPANCY_METHOD_VERSION = 'fc-discrepancy-v1';

/**
 * Fields we are willing to fingerprint. Restricted to short, factual,
 * non-creative values. Names, editorial summaries, review text and photos
 * are excluded: they are the fields most plausibly "content" rather than
 * fact, and we gain least from comparing them.
 */
export const HASHABLE_FIELDS = ['phone', 'address', 'hours'] as const;
export type HashableField = (typeof HASHABLE_FIELDS)[number];

export class UnhashableFieldError extends Error {
  constructor(field: string) {
    super(
      `Field "${field}" may not be fingerprinted for discrepancy detection. ` +
        `Allowed: ${HASHABLE_FIELDS.join(', ')}.`,
    );
    this.name = 'UnhashableFieldError';
  }
}

/** Gate required before any Google-derived value is fingerprinted. */
export function assertHashable(field: string): asserts field is HashableField {
  if (!(HASHABLE_FIELDS as readonly string[]).includes(field)) {
    throw new UnhashableFieldError(field);
  }
}

/**
 * Normalise before hashing so that cosmetic differences do not read as
 * disagreements. "+91 20 1234 5678" and "02012345678" are the same number.
 */
export function normaliseForComparison(field: HashableField, value: string): string {
  const v = value.trim().toLowerCase();
  if (field === 'phone') {
    const digits = v.replace(/\D/g, '');
    // Compare the national significant number: drop 91/0 trunk prefixes.
    return digits.replace(/^(?:91|0)(?=\d{10}$)/, '');
  }
  if (field === 'address') {
    return v
      .replace(/[.,#\-/]/g, ' ')
      .replace(/\b(road|rd)\b/g, 'rd')
      .replace(/\b(street|st)\b/g, 'st')
      .replace(/\b(near|opp|opposite|behind)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return v.replace(/\s+/g, ' ');
}

/** Salted SHA-256, truncated. One-way and not reversible by dictionary attack. */
export function fingerprint(field: HashableField, value: string): string {
  const salt = env.discrepancySalt();
  if (!salt) {
    throw new Error('FLOWCARE_DISCREPANCY_SALT is not set; refusing to fingerprint.');
  }
  return createHash('sha256')
    .update(`${salt}:${field}:${normaliseForComparison(field, value)}`)
    .digest('hex')
    .slice(0, 32);
}

export interface DetectionInput {
  hospitalId: string;
  field: string;
  flowcareValue: string | null;
  externalValue: string | null;
}

export interface DetectionResult {
  ran: boolean;
  skippedReason: string | null;
  discrepancy: FieldDiscrepancy | null;
}

/**
 * Compare one field. Returns `ran: false` rather than throwing when the
 * feature is off, so callers can call it unconditionally.
 */
export function detect(input: DetectionInput, now: Date = new Date()): DetectionResult {
  if (!discrepancyDetectionConfigured()) {
    return { ran: false, skippedReason: 'feature_disabled', discrepancy: null };
  }
  if (!(HASHABLE_FIELDS as readonly string[]).includes(input.field)) {
    return { ran: false, skippedReason: 'field_not_hashable', discrepancy: null };
  }
  if (!input.flowcareValue || !input.externalValue) {
    return { ran: false, skippedReason: 'missing_value', discrepancy: null };
  }

  const field = input.field as HashableField;
  const a = fingerprint(field, input.flowcareValue);
  const b = fingerprint(field, input.externalValue);

  if (a === b) return { ran: true, skippedReason: null, discrepancy: null };

  return {
    ran: true,
    skippedReason: null,
    discrepancy: {
      hospitalId: input.hospitalId,
      fieldCode: field,
      flowcareValueHash: a,
      externalValueHash: b,
      detectedAt: now.toISOString(),
      status: 'open',
    },
  };
}

/**
 * What the patient sees. Never "Google says X" — we do not store X, and
 * asserting which side is right would be a claim we cannot support.
 */
export const DISCREPANCY_NOTICE =
  'Another source lists different details for this hospital. FlowCare cannot ' +
  'tell which is correct, so please call before you travel.';

export function describeDiscrepancy(d: FieldDiscrepancy): string {
  const noun: Record<string, string> = {
    phone: 'phone number',
    address: 'address',
    hours: 'opening hours',
  };
  return `The ${noun[d.fieldCode] ?? d.fieldCode} we hold does not match another source.`;
}
