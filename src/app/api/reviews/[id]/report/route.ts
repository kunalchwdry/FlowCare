import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson, tooMany } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT_REASONS = [
  'not_my_experience', 'offensive', 'spam_or_advertising',
  'personal_information', 'factually_wrong', 'other',
] as const;

const Body = z.object({
  reason: z.enum(REPORT_REASONS),
  detail: z.string().max(600).nullish(),
}).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to report a review.');

    const rl = rateLimit(`report:${clientKey(req, user.id)}`, 10, 60 * 60_000);
    if (!rl.allowed) return tooMany('Too many reports submitted. Please try again later.', rl.resetInMs);

    const body = Body.parse(await readJson(req, 2000));
    const repo = await getRepo();
    const review = await repo.getReview(id);
    if (!review) return fail(404, 'Review not found');

    const report = await repo.createReport({
      reviewId: review.id, reporterId: user.id, reason: body.reason, detail: body.detail ?? null,
    });

    // Reporting NEVER hides content by itself; it queues a human decision.
    await repo.recordModerationEvent({
      reviewId: review.id,
      actorId: user.id,
      actorRole: user.role,
      action: 'flag',
      reason: `Reported by a user: ${body.reason}`,
      aiConfidence: null,
      previousStatus: review.status,
      newStatus: review.status,
    });
    await repo.recordAuditEvent({
      actorId: user.id, actorRole: user.role, action: 'review.report',
      entity: 'hospital_review', entityId: review.id,
      metadata: { reason: body.reason, hospital_id: review.hospitalId },
    });

    return ok({
      report: { id: report.id, status: report.status },
      message: 'Thanks. A FlowCare moderator will review this. The review stays visible until a person makes a decision.',
    }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
