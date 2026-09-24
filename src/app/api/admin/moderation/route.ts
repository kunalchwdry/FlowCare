import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Action = z.object({
  reviewId: z.string().min(1).max(120),
  action: z.enum(['hide', 'restore', 'remove', 'publish', 'dismiss_report']),
  reason: z.string().min(3).max(400),
  reportId: z.string().max(120).nullish(),
}).strict();

const NEXT_STATUS = {
  hide: 'hidden', restore: 'published', remove: 'removed',
  publish: 'published', dismiss_report: null,
} as const;

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in required');
    if (user.role !== 'admin') return fail(403, 'Moderation is restricted to FlowCare administrators.');

    const repo = await getRepo();
    const [reports, events, pending] = await Promise.all([
      repo.listReports(),
      repo.listModerationEvents(),
      repo.listReviews({ includeNonPublished: true }),
    ]);

    const queue = pending.filter((r) => r.status === 'pending' || r.status === 'flagged');
    const reviewById = new Map(pending.map((r) => [r.id, r]));

    return ok({
      queue,
      reports: reports.map((rep) => ({ ...rep, review: reviewById.get(rep.reviewId) ?? null })),
      events: events.slice(0, 100),
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in required');
    if (user.role !== 'admin') return fail(403, 'Moderation is restricted to FlowCare administrators.');

    const body = Action.parse(await readJson(req, 3000));
    const repo = await getRepo();
    const review = await repo.getReview(body.reviewId);
    if (!review) return fail(404, 'Review not found');

    const next = NEXT_STATUS[body.action];
    const previousStatus = review.status;

    if (next) await repo.setReviewStatus(review.id, next);
    if (body.reportId) await repo.setReportStatus(body.reportId, body.action === 'dismiss_report' ? 'dismissed' : 'actioned');

    const event = await repo.recordModerationEvent({
      reviewId: review.id,
      actorId: user.id,
      actorRole: user.role,
      action: body.action === 'publish' ? 'restore' : body.action === 'dismiss_report' ? 'dismiss_report' : body.action,
      reason: body.reason,
      aiConfidence: null,
      previousStatus,
      newStatus: next ?? previousStatus,
    });

    await repo.recordAuditEvent({
      actorId: user.id, actorRole: user.role, action: `moderation.${body.action}`,
      entity: 'hospital_review', entityId: review.id,
      metadata: { previous_status: previousStatus, new_status: next ?? previousStatus },
    });

    return ok({ event, status: next ?? previousStatus });
  } catch (e) {
    return handleError(e);
  }
}
