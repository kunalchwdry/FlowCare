import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession, publicHandle } from '@/lib/auth/session';
import { checkReviewEligibility } from '@/lib/reviews/eligibility';
import { moderateSubmission } from '@/lib/reviews/moderation';
import { toPublicReview, toPublicReviews } from '@/lib/reviews/publicView';
import { aggregateAll, explainRating } from '@/lib/discovery/rating';
import { fail, handleError, ok, readJson, tooMany } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RatingValue = z.number().int().min(1).max(5);

const NewReviewSchema = z.object({
  appointmentId: z.string().min(1).max(120),
  ratings: z.object({
    overall: RatingValue,
    waiting: RatingValue,
    staff: RatingValue,
    appointment: RatingValue,
    facility: RatingValue,
  }),
  comment: z.string().max(1500).nullish(),
}).strict();

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const repo = await getRepo();
    const hospital = await repo.getHospital(id);
    if (!hospital) return fail(404, 'Hospital not found');

    const reviews = await repo.listReviews({ hospitalId: hospital.id });
    const summary = aggregateAll([hospital.id], reviews)[hospital.id];
    return ok({
      reviews: toPublicReviews(reviews),
      summary,
      explanation: explainRating(summary),
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to your FlowCare account to review a visit.');

    const rl = rateLimit(`review:${clientKey(req, user.id)}`, 5, 10 * 60_000);
    if (!rl.allowed) return tooMany('Too many review submissions. Please wait a few minutes.', rl.resetInMs);

    const repo = await getRepo();
    const hospital = await repo.getHospital(id);
    if (!hospital) return fail(404, 'Hospital not found');

    const body = NewReviewSchema.parse(await readJson(req, 4000));

    const [appointments, allReviews] = await Promise.all([
      repo.listAppointments({ patientId: user.id, hospitalId: hospital.id }),
      repo.listReviews({ hospitalId: hospital.id, includeNonPublished: true }),
    ]);

    const eligibility = checkReviewEligibility({
      user: { id: user.id, role: user.role, hospitalId: user.hospitalId },
      hospitalId: hospital.id,
      appointmentId: body.appointmentId,
      appointments,
      existingReviews: allReviews,
    });
    if (!eligibility.eligible) {
      return fail(403, eligibility.message, { code: eligibility.code });
    }

    const verdict = moderateSubmission(body.comment ?? null, {
      authorId: user.id,
      hospitalId: hospital.id,
      recentReviews: allReviews.slice(0, 200),
    });

    const review = await repo.createReview({
      hospitalId: hospital.id,
      authorId: user.id,
      authorHandle: publicHandle(user),
      appointmentId: body.appointmentId,
      ratings: body.ratings,
      comment: body.comment ?? null,
      status: verdict.suggestedStatus,
    });

    if (verdict.flags.length) {
      // Automation only ever routes to human review; it never removes content.
      await repo.recordModerationEvent({
        reviewId: review.id,
        actorId: null as unknown as string,
        actorRole: 'system',
        action: 'ai_flag',
        reason: verdict.flags.map((f) => `${f.code}: ${f.reason}`).join('; '),
        aiConfidence: Math.max(...verdict.flags.map((f) => f.confidence)),
        previousStatus: 'published',
        newStatus: verdict.suggestedStatus,
      });
    }

    await repo.recordAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: 'review.create',
      entity: 'hospital_review',
      entityId: review.id,
      metadata: {
        hospital_id: hospital.id,
        status: review.status,
        flags: verdict.flags.length,
        has_comment: Boolean(body.comment),
      },
    });

    return ok({
      review: toPublicReview(review),
      moderation: {
        status: review.status,
        requiresHumanReview: verdict.requiresHumanReview,
        flags: verdict.flags,
        message: verdict.requiresHumanReview
          ? 'Thanks. Your review was received and is waiting for a moderator to check it before it appears.'
          : 'Thanks. Your verified-visit review has been published.',
      },
    }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
