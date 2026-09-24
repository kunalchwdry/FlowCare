import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { requireRole } from '@/lib/auth/session';
import { track } from '@/lib/analytics';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { ReviewSchema } from '@/lib/journey/corrections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** F17 review queue. Admin only, checked before any data is read. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireRole('admin');
    const status = req.nextUrl.searchParams.get('status') as
      | 'pending' | 'confirmed' | 'rejected' | 'duplicate' | null;

    const repo = await getRepo();
    const corrections = await repo.listCorrections(status ? { status } : {});
    const hospitals = await repo.listHospitals();
    const byId = new Map(hospitals.map((h) => [h.id, h]));

    return ok({
      reviewerId: user.id,
      corrections: corrections.map((c) => ({
        ...c,
        hospitalName: byId.get(c.hospitalId)?.name ?? null,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Record a human decision. This is the ONLY path by which a correction
 * becomes `confirmed`; there is no automatic promotion anywhere in the
 * codebase, and `assertReviewed()` guards any consumer that acts on one.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireRole('admin');
    const input = ReviewSchema.parse(await readJson(req, 2000));

    const repo = await getRepo();
    const existing = await repo.getCorrection(input.correctionId);
    if (!existing) return fail(404, 'Correction not found');

    const updated = await repo.reviewCorrection({
      correctionId: input.correctionId,
      reviewerUserId: user.id,
      decision: input.decision,
      outcome: input.outcome ?? null,
    });

    track('correction_reviewed', req.headers.get('x-flowcare-session') ?? 'anon', {
      hospital_id: updated.hospitalId,
      field_code: updated.fieldCode,
      decision: input.decision,
    });

    await repo.recordAuditEvent({
      actorId: user.id, actorRole: user.role, action: 'correction.review',
      entity: 'facility_correction', entityId: updated.id,
      metadata: {
        hospital_id: updated.hospitalId,
        field_code: updated.fieldCode,
        decision: input.decision,
        previous_status: existing.status,
      },
    });

    return ok({ correction: updated });
  } catch (e) {
    return handleError(e);
  }
}
