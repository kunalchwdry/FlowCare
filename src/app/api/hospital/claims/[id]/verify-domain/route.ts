import { NextRequest } from 'next/server';
import { getClaim, markDomainVerified } from '@/lib/hospital/claims';
import { checkDnsToken } from '@/lib/hospital/verification';
import { getRepo } from '@/lib/data';
import { fail, handleError, ok } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Check the claim's TXT record on the hospital's own domain.
 *
 * The only self-serve verification here, and the only one that needs no
 * human: publishing a record on a domain requires control of that domain,
 * which a stranger submitting a form does not have.
 *
 * Succeeding moves the claim to 'verifying', never to 'approved'. Running
 * the hospital's website is good evidence that you work there. It is not
 * evidence that the hospital wants you holding its patients' appointments,
 * and that difference is the whole reason a person still signs this off.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    // DNS lookups on an unauthenticated endpoint; keep it slow.
    const rl = rateLimit(`claim-dns:${clientKey(req)}`, 6);
    if (!rl.allowed) {
      return fail(429, 'Too many checks. Please wait a minute.', { retryInMs: rl.resetInMs });
    }

    const { id } = await ctx.params;
    const claim = await getClaim(id);
    // Unknown and foreign claim ids are indistinguishable on purpose.
    if (!claim || !claim.hospitalId) return fail(404, 'That claim could not be found.');

    const repo = await getRepo();
    const hospital = await repo.getHospital(claim.hospitalId);
    if (!hospital) return fail(404, 'That claim could not be found.');

    const result = await checkDnsToken(hospital.website ?? null, claim.id);
    if (!result.ok) {
      return ok({ verified: false, domain: result.domain, reason: result.reason });
    }

    const updated = await markDomainVerified(claim.id);
    return ok({
      verified: true,
      domain: result.domain,
      status: updated?.status ?? 'verifying',
      message:
        'Domain control confirmed. A reviewer still has to approve access before the portal opens.',
    });
  } catch (e) {
    return handleError(e);
  }
}
