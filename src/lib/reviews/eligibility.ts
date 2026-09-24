/**
 * Who may leave a FlowCare review.
 *
 * A FlowCare review is a *verified-visit* review. The eligibility rules below
 * are what make the "Verified FlowCare visit" badge meaningful, so they are
 * enforced in three places: here (application), in the API route, and in the
 * database (unique constraint + RLS policy in migration 0002).
 */
import type { Appointment, HospitalReview } from '@/lib/types';
import type { Role } from '@/lib/auth/session';

export const REVIEW_RULES = {
  /** A visit can be reviewed for this long after completion. */
  REVIEW_WINDOW_DAYS: 180,
  /** Reviews a single author may submit across the platform per day. */
  MAX_REVIEWS_PER_AUTHOR_PER_DAY: 3,
} as const;

export type IneligibleCode =
  | 'not_authenticated'
  | 'staff_conflict_of_interest'
  | 'no_completed_visit'
  | 'appointment_not_found'
  | 'appointment_not_yours'
  | 'appointment_wrong_hospital'
  | 'appointment_not_completed'
  | 'review_window_expired'
  | 'already_reviewed'
  | 'daily_limit_reached';

export interface EligibilityResult {
  eligible: boolean;
  code: IneligibleCode | null;
  message: string;
  /** Appointments this user could still review at this hospital. */
  eligibleAppointments: Appointment[];
}

export interface EligibilityInput {
  user: { id: string; role: Role; hospitalId: string | null } | null;
  hospitalId: string;
  appointmentId?: string;
  appointments: Appointment[];
  existingReviews: HospitalReview[];
  now?: Date;
}

export function checkReviewEligibility(input: EligibilityInput): EligibilityResult {
  const now = input.now ?? new Date();
  const deny = (code: IneligibleCode, message: string): EligibilityResult => ({
    eligible: false, code, message, eligibleAppointments: [],
  });

  if (!input.user) return deny('not_authenticated', 'Sign in to your FlowCare account to review a visit.');

  // Staff and admins attached to a hospital cannot review that hospital.
  if (input.user.role !== 'patient') {
    if (input.user.role === 'admin' || input.user.hospitalId === input.hospitalId) {
      return deny('staff_conflict_of_interest', 'Staff and administrator accounts cannot review a hospital they are associated with.');
    }
  }

  const reviewedAppointmentIds = new Set(
    input.existingReviews.filter((r) => r.authorId === input.user!.id).map((r) => r.appointmentId),
  );

  const windowStart = new Date(now.getTime() - REVIEW_RULES.REVIEW_WINDOW_DAYS * 86_400_000);

  const mine = input.appointments.filter((a) => a.patientId === input.user!.id && a.hospitalId === input.hospitalId);
  const eligibleAppointments = mine.filter(
    (a) =>
      a.status === 'completed' &&
      a.completedAt !== null &&
      new Date(a.completedAt) >= windowStart &&
      new Date(a.completedAt) <= now &&
      !reviewedAppointmentIds.has(a.id),
  );

  // Daily submission cap (anti-manipulation).
  const dayStart = new Date(now.getTime() - 86_400_000);
  const todayCount = input.existingReviews.filter(
    (r) => r.authorId === input.user!.id && new Date(r.createdAt) >= dayStart,
  ).length;
  if (todayCount >= REVIEW_RULES.MAX_REVIEWS_PER_AUTHOR_PER_DAY) {
    return deny('daily_limit_reached', 'You have reached the daily limit for review submissions. Please try again tomorrow.');
  }

  if (input.appointmentId) {
    const appt = input.appointments.find((a) => a.id === input.appointmentId);
    if (!appt) return deny('appointment_not_found', 'That visit could not be found.');
    if (appt.patientId !== input.user.id) return deny('appointment_not_yours', 'You can only review your own visits.');
    if (appt.hospitalId !== input.hospitalId) return deny('appointment_wrong_hospital', 'That visit belongs to a different hospital.');
    if (appt.status !== 'completed' || !appt.completedAt) {
      return deny('appointment_not_completed', 'You can review a visit once it has been marked completed by the hospital.');
    }
    if (new Date(appt.completedAt) < windowStart) {
      return deny('review_window_expired', `Visits can be reviewed within ${REVIEW_RULES.REVIEW_WINDOW_DAYS} days of the appointment.`);
    }
    if (reviewedAppointmentIds.has(appt.id)) {
      return deny('already_reviewed', 'You have already reviewed this visit.');
    }
    return { eligible: true, code: null, message: 'Eligible to review this completed visit.', eligibleAppointments: [appt] };
  }

  if (eligibleAppointments.length === 0) {
    // Distinguish "you never came here" from "you came and already reviewed it".
    // Collapsing both into no_completed_visit told returning patients something
    // that was simply untrue.
    const hadCompletedVisit = mine.some(
      (a) => a.status === 'completed' && a.completedAt !== null && new Date(a.completedAt) >= windowStart,
    );
    if (hadCompletedVisit) {
      return deny('already_reviewed', 'You have already reviewed your completed visit(s) at this hospital.');
    }
    return deny('no_completed_visit', 'Only patients with a completed FlowCare visit at this hospital can leave a review.');
  }

  return {
    eligible: true,
    code: null,
    message: `You have ${eligibleAppointments.length} completed visit(s) you can review.`,
    eligibleAppointments,
  };
}
