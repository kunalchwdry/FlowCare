import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { track } from '@/lib/analytics';
import { fail, handleError, ok, readJson, tooMany } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import {
  CorrectionSubmissionSchema, MAX_CORRECTIONS_PER_DAY, SUBMISSION_ACKNOWLEDGEMENT,
  countRecentByUser, findDuplicate, validateSubmission,
} from '@/lib/journey/corrections';
import type { FacilityCorrection } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A reporter sees only their own reports. */
export async function GET() {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to see your reports.');
    const repo = await getRepo();
    return ok({ corrections: await repo.listCorrections({ reportedByUserId: user.id }) });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * F17 — report something wrong.
 *
 * The submission NEVER changes what other users see. It is stored as
 * `pending` and waits for a human decision (R17). We tell the reporter that
 * in those words rather than implying the fix is live.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to report a problem.');

    const limit = rateLimit(`corrections:${clientKey(req, user.id)}`, 10);
    if (!limit.allowed) return tooMany('Too many reports. Please wait a moment.', limit.resetInMs);

    const input = CorrectionSubmissionSchema.parse(await readJson(req, 4000));

    const problems = validateSubmission(input);
    if (problems.length) {
      return fail(400, problems[0].message, { problems });
    }

    const repo = await getRepo();
    const hospital = await repo.getHospital(input.hospitalId);
    if (!hospital) return fail(404, 'Hospital not found');

    const existing = await repo.listCorrections({ hospitalId: hospital.id });

    const mineToday = countRecentByUser(user.id, await repo.listCorrections({ reportedByUserId: user.id }));
    if (mineToday >= MAX_CORRECTIONS_PER_DAY) {
      return fail(429, `You can send up to ${MAX_CORRECTIONS_PER_DAY} reports a day.`);
    }

    const duplicate = findDuplicate(
      {
        hospitalId: hospital.id,
        fieldCode: input.fieldCode,
        reportedByUserId: user.id,
        claimedValue: input.claimedValue ?? null,
      },
      existing,
    );

    const created = await repo.createCorrection({
      hospitalId: hospital.id,
      fieldCode: input.fieldCode,
      reportedByUserId: user.id,
      claimedValue: input.claimedValue ?? null,
      evidenceKind: input.evidenceKind as FacilityCorrection['evidenceKind'],
      note: input.note ?? null,
      status: duplicate ? 'duplicate' : 'pending',
    });

    track('correction_submitted', req.headers.get('x-flowcare-session') ?? 'anon', {
      hospital_id: hospital.id,
      field_code: input.fieldCode,
      duplicate: Boolean(duplicate),
    });

    await repo.recordAuditEvent({
      actorId: user.id, actorRole: user.role, action: 'correction.submit',
      entity: 'facility_correction', entityId: created.id,
      metadata: {
        hospital_id: hospital.id,
        field_code: input.fieldCode,
        evidence_kind: input.evidenceKind,
        duplicate_of: duplicate?.id ?? null,
      },
    });

    return ok(
      {
        correction: created,
        acknowledgement: duplicate
          ? 'Thanks — someone has already reported this, so it is already in the queue.'
          : SUBMISSION_ACKNOWLEDGEMENT,
        published: false,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}
