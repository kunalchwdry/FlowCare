import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { checkReviewEligibility } from '@/lib/reviews/eligibility';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const repo = await getRepo();
    const hospital = await repo.getHospital(id);
    if (!hospital) return fail(404, 'Hospital not found');

    const user = await getSession();
    const [appointments, existingReviews] = await Promise.all([
      user ? repo.listAppointments({ patientId: user.id, hospitalId: hospital.id }) : Promise.resolve([]),
      repo.listReviews({ hospitalId: hospital.id, includeNonPublished: true }),
    ]);

    const result = checkReviewEligibility({
      user: user ? { id: user.id, role: user.role, hospitalId: user.hospitalId } : null,
      hospitalId: hospital.id,
      appointments,
      existingReviews,
    });

    return ok({
      eligible: result.eligible,
      code: result.code,
      message: result.message,
      // Only ids + dates; no clinical content.
      eligibleAppointments: result.eligibleAppointments.map((a) => ({
        id: a.id, scheduledFor: a.scheduledFor, completedAt: a.completedAt, departmentId: a.departmentId,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
