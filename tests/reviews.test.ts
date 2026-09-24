import { describe, expect, it } from 'vitest';
import { REVIEW_RULES, checkReviewEligibility } from '../src/lib/reviews/eligibility';
import { moderateSubmission, similarity, summariseFlowcareReviews } from '../src/lib/reviews/moderation';
import { makeReview, daysAgo } from './setup';
import type { Appointment } from '../src/lib/types';

const patient = { id: 'user-1', role: 'patient' as const, hospitalId: null };

function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1', hospitalId: 'h1', patientId: 'user-1', departmentId: 'h1:dept:cardiology',
    sessionId: null, scheduledFor: daysAgo(10), status: 'completed', completedAt: daysAgo(10),
    ...over,
  } as Appointment;
}

describe('review eligibility', () => {
  it('denies an anonymous visitor', () => {
    const r = checkReviewEligibility({ user: null, hospitalId: 'h1', appointments: [], existingReviews: [] });
    expect(r.eligible).toBe(false);
    expect(r.code).toBe('not_authenticated');
  });

  it('denies a signed-in patient with no completed visit', () => {
    const r = checkReviewEligibility({
      user: patient, hospitalId: 'h1',
      appointments: [appt({ status: 'booked', completedAt: null })],
      existingReviews: [],
    });
    expect(r.eligible).toBe(false);
    expect(r.code).toBe('no_completed_visit');
  });

  it('denies a completed visit at a DIFFERENT hospital', () => {
    const r = checkReviewEligibility({
      user: patient, hospitalId: 'h1',
      appointments: [appt({ hospitalId: 'h2' })],
      existingReviews: [],
    });
    expect(r.eligible).toBe(false);
  });

  it('denies an appointment belonging to another patient', () => {
    const r = checkReviewEligibility({
      user: patient, hospitalId: 'h1',
      appointments: [appt({ patientId: 'user-999' })],
      existingReviews: [],
    });
    expect(r.eligible).toBe(false);
  });

  it('allows a patient with a recent completed visit', () => {
    const r = checkReviewEligibility({
      user: patient, hospitalId: 'h1', appointments: [appt()], existingReviews: [],
    });
    expect(r.eligible).toBe(true);
    expect(r.eligibleAppointments.length).toBe(1);
  });

  it('denies a visit older than the review window', () => {
    const r = checkReviewEligibility({
      user: patient, hospitalId: 'h1',
      appointments: [appt({ completedAt: daysAgo(REVIEW_RULES.REVIEW_WINDOW_DAYS + 5) })],
      existingReviews: [],
    });
    expect(r.eligible).toBe(false);
  });

  it('denies a duplicate review for the same appointment', () => {
    const r = checkReviewEligibility({
      user: patient, hospitalId: 'h1',
      appointments: [appt()],
      existingReviews: [makeReview({ hospitalId: 'h1', authorId: 'user-1', appointmentId: 'appt-1' })],
    });
    expect(r.eligible).toBe(false);
    expect(r.code).toBe('already_reviewed');
  });

  it('denies staff reviewing their own hospital (conflict of interest)', () => {
    const r = checkReviewEligibility({
      user: { id: 's1', role: 'staff', hospitalId: 'h1' }, hospitalId: 'h1',
      appointments: [appt({ patientId: 's1' })], existingReviews: [],
    });
    expect(r.eligible).toBe(false);
    expect(r.code).toBe('staff_conflict_of_interest');
  });

  it('enforces a per-author daily cap', () => {
    const today = new Date().toISOString();
    const recent = Array.from({ length: REVIEW_RULES.MAX_REVIEWS_PER_AUTHOR_PER_DAY }, (_, i) =>
      makeReview({ hospitalId: `other-${i}`, authorId: 'user-1', appointmentId: `other-appt-${i}`, createdAt: today }));
    const r = checkReviewEligibility({
      user: patient, hospitalId: 'h1', appointments: [appt()], existingReviews: recent,
    });
    expect(r.eligible).toBe(false);
    expect(r.code).toBe('daily_limit_reached');
  });

  it('never leaks another patient\'s appointments into eligibleAppointments', () => {
    const r = checkReviewEligibility({
      user: patient, hospitalId: 'h1',
      appointments: [appt(), appt({ id: 'appt-x', patientId: 'user-999' })],
      existingReviews: [],
    });
    expect(r.eligibleAppointments.every((a) => a.patientId === 'user-1')).toBe(true);
  });
});

describe('moderation', () => {
  const ctx = (recentReviews: ReturnType<typeof makeReview>[] = []) =>
    ({ authorId: 'user-1', hospitalId: 'h1', recentReviews });

  it('publishes an ordinary review', () => {
    const v = moderateSubmission('Reception was quick and the doctor explained things clearly.', ctx([]));
    expect(v.suggestedStatus).toBe('published');
  });

  it('routes a review containing a phone number to human review', () => {
    const v = moderateSubmission('Call me on 9876543210 for details', ctx([]));
    expect(v.suggestedStatus).toBe('pending');
    expect(v.flags.some((f) => /phone/i.test(f.code))).toBe(true);
  });

  it('routes a review containing a URL or email to human review', () => {
    expect(moderateSubmission('visit http://spam.example for cheap meds', ctx([])).suggestedStatus).toBe('pending');
    expect(moderateSubmission('mail me at a@b.com', ctx([])).suggestedStatus).toBe('pending');
  });

  it('flags a clinical allegation for human review rather than deleting it', () => {
    const v = moderateSubmission('The doctor here committed malpractice and killed my relative', ctx([]));
    expect(v.suggestedStatus).toBe('pending');
    expect(v.flags.some((f) => f.code === 'clinical_allegation')).toBe(true);
  });

  it('NEVER auto-removes or auto-hides — automation can only suggest pending or published', () => {
    const nasty = [
      'aaaaaaaaaaaaaaaaaaaaaaa', 'THIS PLACE IS THE ABSOLUTE WORST EVER AND I HATE IT',
      'call 9999999999 http://x.example a@b.com malpractice', 'idiots',
    ];
    for (const comment of nasty) {
      const v = moderateSubmission(comment, ctx([]));
      expect(['published', 'pending']).toContain(v.suggestedStatus);
    }
  });

  it('detects a near-duplicate of the same author\'s earlier review', () => {
    const comment = 'The waiting area was crowded but the staff were polite and efficient throughout.';
    const prior = [makeReview({ hospitalId: 'h1', authorId: 'user-1', comment })];
    const v = moderateSubmission(comment + ' Really.', ctx(prior));
    expect(v.flags.some((f) => f.code.startsWith('duplicate'))).toBe(true);
  });

  it('does not flag two genuinely different reviews as duplicates', () => {
    const prior = [makeReview({ hospitalId: 'h1', authorId: 'user-2', comment: 'Parking was impossible on a Monday morning.' })];
    const v = moderateSubmission('The physiotherapy department ran exactly on time.', ctx(prior));
    expect(v.flags.some((f) => f.code.startsWith('duplicate'))).toBe(false);
  });

  it('similarity is symmetric and bounded', () => {
    const a = 'the staff were kind and the wait was short';
    const b = 'the wait was short and the staff were kind';
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 6);
    expect(similarity(a, a)).toBe(1);
    expect(similarity(a, 'completely unrelated words here')).toBeLessThan(0.5);
  });

  it('attaches a machine-readable reason and confidence to every flag', () => {
    const v = moderateSubmission('ring 9876543210', ctx([]));
    for (const f of v.flags) {
      expect(typeof f.code).toBe('string');
      expect(f.reason.length).toBeGreaterThan(3);
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('withholds a review-theme summary below the minimum sample', () => {
    const s = summariseFlowcareReviews(Array.from({ length: 3 }, () => makeReview()));
    expect(s.available).toBe(false);
    expect(s.reason).toBeTruthy();
  });

  it('produces a theme summary from counts only, once there are enough reviews', () => {
    const rs = Array.from({ length: 12 }, () =>
      makeReview({ ratings: { overall: 5, waiting: 1, staff: 5, appointment: 4, facility: 4 } }));
    const s = summariseFlowcareReviews(rs);
    expect(s.available).toBe(true);
    expect(s.basedOn).toBe(12);
    expect(s.negatives.some((n) => /wait/i.test(n.theme))).toBe(true);
    // Counts must be real counts, not percentages or invented scores.
    for (const item of [...s.positives, ...s.negatives]) {
      expect(Number.isInteger(item.count)).toBe(true);
      expect(item.count).toBeLessThanOrEqual(12);
    }
  });
});
