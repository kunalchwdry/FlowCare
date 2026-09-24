/**
 * F17 — Correction workflow.
 *
 * Problem P22 with numbers: S01 (CMS Round 3, 10,504 locations) found 48.74%
 * of directory entries carried at least one inaccuracy, and 41.05% of
 * deficiencies were "provider should not be listed at this location". A
 * directory with no repair path decays to that state. Patients are the only
 * party who reliably notice.
 *
 * HARD CONSTRAINT (docs/research/03-review-and-plan.md §10.1 R17):
 * A user report NEVER changes what other users see. It is a signal that
 * triggers a check. Publication requires a human decision, and that rule is
 * enforced at the repository layer, not merely in the UI — see
 * `assertReviewed()` below, which every write path calls.
 *
 * This mirrors the review-moderation stance already in lib/reviews: the
 * system may flag, a person decides.
 */
import { z } from 'zod';
import { CORRECTION_FIELDS, EVIDENCE_KIND_CODES } from '@/lib/journey/vocab';
import { findClinicalContent } from '@/lib/journey/prep';
import type { FacilityCorrection } from '@/lib/types';

export const CORRECTIONS_METHOD_VERSION = 'fc-corrections-v1';

/** Reports per user per day, across all hospitals. Mirrors review limits. */
export const MAX_CORRECTIONS_PER_DAY = 5;
/** A repeat report on the same hospital+field within this window is a dupe. */
export const DUPLICATE_WINDOW_DAYS = 30;

export const CorrectionSubmissionSchema = z
  .object({
    hospitalId: z.string().min(1).max(120),
    fieldCode: z.enum(CORRECTION_FIELDS),
    claimedValue: z.string().trim().max(300).optional(),
    evidenceKind: z.enum(
      EVIDENCE_KIND_CODES as unknown as [string, ...string[]],
    ),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type CorrectionSubmission = z.infer<typeof CorrectionSubmissionSchema>;

export interface ValidationProblem {
  code: string;
  message: string;
}

/**
 * Content rules beyond shape. Returns problems rather than throwing so the
 * API can report all of them at once.
 */
export function validateSubmission(
  input: CorrectionSubmission,
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const text = [input.claimedValue, input.note].filter(Boolean).join(' ');

  // A correction to preparation content is still preparation content.
  if (input.fieldCode === 'prep' && text) {
    const hits = findClinicalContent(text);
    if (hits.length) {
      problems.push({
        code: 'clinical_content',
        message:
          'This looks like medical advice (' +
          hits.map((h) => h.why).join(', ') +
          '). FlowCare only carries documents and payment information. ' +
          'Please ask the hospital about anything medical.',
      });
    }
  }

  // §9.1: no clinical free text anywhere in the product.
  if (text) {
    const hits = findClinicalContent(text);
    if (hits.length && input.fieldCode !== 'prep') {
      problems.push({
        code: 'clinical_content',
        message:
          'Please remove medical details from this report. FlowCare stores ' +
          'facility information only, never health information.',
      });
    }
  }

  if (!input.claimedValue && !input.note) {
    problems.push({
      code: 'empty',
      message: 'Tell us what is wrong, or what the correct detail is.',
    });
  }

  return problems;
}

/**
 * Duplicate detection. Same user + same hospital + same field inside the
 * window is a duplicate; so is an identical claimed value from anyone.
 */
export function findDuplicate(
  candidate: { hospitalId: string; fieldCode: string; reportedByUserId: string; claimedValue: string | null },
  existing: FacilityCorrection[],
  now: Date = new Date(),
): FacilityCorrection | null {
  const cutoff = now.getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000;
  const norm = (v: string | null) => (v ?? '').trim().toLowerCase();

  for (const e of existing) {
    if (e.hospitalId !== candidate.hospitalId) continue;
    if (e.fieldCode !== candidate.fieldCode) continue;
    if (new Date(e.createdAt).getTime() < cutoff) continue;
    if (e.status === 'rejected') continue;

    if (e.reportedByUserId === candidate.reportedByUserId) return e;
    if (norm(e.claimedValue) && norm(e.claimedValue) === norm(candidate.claimedValue)) return e;
  }
  return null;
}

export function countRecentByUser(
  userId: string,
  existing: FacilityCorrection[],
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - 86_400_000;
  return existing.filter(
    (c) => c.reportedByUserId === userId && new Date(c.createdAt).getTime() >= cutoff,
  ).length;
}

/* ------------------------------- review ------------------------------- */

export const REVIEW_DECISIONS = ['confirmed', 'rejected', 'duplicate'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const ReviewSchema = z
  .object({
    correctionId: z.string().min(1).max(120),
    decision: z.enum(REVIEW_DECISIONS),
    outcome: z.string().trim().max(300).optional(),
  })
  .strict();

export class UnreviewedPublicationError extends Error {
  constructor(correctionId: string) {
    super(
      `Correction ${correctionId} cannot change published facts: it has not ` +
        `been reviewed by a person. This is a hard invariant (F17 R17).`,
    );
    this.name = 'UnreviewedPublicationError';
  }
}

/**
 * The repository-layer guard. Any code path that would let a correction
 * affect what other users see must call this first.
 */
export function assertReviewed(correction: FacilityCorrection): void {
  if (correction.status !== 'confirmed' || !correction.reviewedByUserId) {
    throw new UnreviewedPublicationError(correction.id);
  }
}

/** What the reporter is told at submit time. No promises about timing. */
export const SUBMISSION_ACKNOWLEDGEMENT =
  'Thanks — this goes to a person to check. It will not change what other ' +
  'people see until someone has confirmed it.';

/** Status as shown to the reporter on their own report. */
export const STATUS_LABELS: Record<FacilityCorrection['status'], string> = {
  pending: 'Waiting to be checked',
  confirmed: 'Checked and updated',
  rejected: 'Checked — no change made',
  duplicate: 'Already reported',
};
