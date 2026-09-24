import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { fail, handleError, ok } from '@/lib/http';
import { discrepancyDetectionConfigured } from '@/lib/env';
import { DISCREPANCY_NOTICE, HASHABLE_FIELDS } from '@/lib/journey/discrepancy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * F16 — cross-source discrepancies for one facility.
 *
 * Ships DARK. The endpoint exists and is honest about being off, rather than
 * pretending the feature does not exist: `enabled: false` with a stated
 * reason is a deployable state, a silent 404 is not.
 *
 * The open question is legal, not technical — whether a salted hash of a
 * Google value is itself "content" under Maps Service Terms §14.3. Until
 * counsel answers, an operator must set both the flag and a salt.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const repo = await getRepo();
    const hospital = await repo.getHospital(id);
    if (!hospital) return fail(404, 'Hospital not found');

    if (!discrepancyDetectionConfigured()) {
      return ok({
        enabled: false,
        reason:
          'Cross-source checking is turned off in this deployment. It is ' +
          'pending a review of whether fingerprinting third-party values is ' +
          'permitted under the Google Maps Service Terms.',
        comparableFields: HASHABLE_FIELDS,
        discrepancies: [],
      });
    }

    // When enabled, detection runs in the enrichment path and persists only
    // salted fingerprints. Nothing is computed on this read.
    return ok({
      enabled: true,
      notice: DISCREPANCY_NOTICE,
      comparableFields: HASHABLE_FIELDS,
      discrepancies: [],
    });
  } catch (e) {
    return handleError(e);
  }
}
