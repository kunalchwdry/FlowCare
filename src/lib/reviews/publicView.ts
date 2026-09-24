import type { HospitalReview } from '@/lib/types';

/**
 * The shape of a review that may leave the server for an unauthenticated
 * reader. `authorId` and `appointmentId` are internal identifiers: exposing
 * them would let anyone correlate a person with the hospital they attended,
 * which is exactly the kind of health-adjacent inference FlowCare must not
 * enable. They are stripped here, in one place, for every route.
 */
export interface PublicReview {
  id: string;
  hospitalId: string;
  authorHandle: string;
  ratings: HospitalReview['ratings'];
  comment: string | null;
  createdAt: string;
  status: HospitalReview['status'];
  verifiedVisit: true;
  helpfulCount: number;
}

export function toPublicReview(r: HospitalReview): PublicReview {
  return {
    id: r.id,
    hospitalId: r.hospitalId,
    authorHandle: r.authorHandle,
    ratings: r.ratings,
    comment: r.comment,
    createdAt: r.createdAt,
    status: r.status,
    verifiedVisit: true,
    helpfulCount: r.helpfulCount,
  };
}

export const toPublicReviews = (rs: HospitalReview[]): PublicReview[] => rs.map(toPublicReview);
