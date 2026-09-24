import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { VISIT_RETENTION_MONTHS, visitRetentionCutoff } from '@/lib/journey/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * F19 — Visit continuity record.
 *
 * WHERE and WHEN only. There is no field for why the visit happened, what
 * was found, or what was advised: that would make FlowCare a health record
 * without any of the obligations of one (§9.1).
 *
 * Retention is 24 months, enforced on every read so it cannot be forgotten
 * by a missing cron job.
 */
const Body = z
  .object({
    hospitalId: z.string().min(1).max(120),
    departmentId: z.string().min(1).max(200).nullish(),
    visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    careContextId: z.string().min(1).max(120).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to see your visit history.');
    const repo = await getRepo();

    // Enforce retention at read time, not only on a schedule.
    const purged = await repo.purgeVisitRecords(user.id, visitRetentionCutoff());

    const visits = await repo.listVisitRecords(user.id);
    const hospitals = await repo.listHospitals();
    const byId = new Map(hospitals.map((h) => [h.id, h]));

    return ok({
      visits: visits.map((v) => ({
        ...v,
        hospitalName: byId.get(v.hospitalId)?.name ?? null,
      })),
      retentionMonths: VISIT_RETENTION_MONTHS,
      purged,
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to record a visit.');
    const input = Body.parse(await readJson(req, 2000));

    const repo = await getRepo();
    const hospital = await repo.getHospital(input.hospitalId);
    if (!hospital) return fail(404, 'Hospital not found');

    if (input.careContextId) {
      const contexts = await repo.listCareContexts(user.id);
      if (!contexts.some((c) => c.id === input.careContextId)) {
        return fail(404, 'Care context not found');
      }
    }

    const visit = await repo.createVisitRecord({
      ownerUserId: user.id,
      careContextId: input.careContextId ?? null,
      hospitalId: hospital.id,
      departmentId: input.departmentId ?? null,
      visitDate: input.visitDate,
    });

    await repo.recordAuditEvent({
      actorId: user.id, actorRole: user.role, action: 'visit_record.create',
      entity: 'visit_record', entityId: visit.id,
      metadata: { hospital_id: hospital.id },
    });

    return ok({ visit }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
