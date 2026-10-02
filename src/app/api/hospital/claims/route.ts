import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClaim, storageIsDurable } from '@/lib/hospital/claims';
import { getRepo } from '@/lib/data';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    /** One of these two, never both — see the refine below. */
    hospitalId: z.string().max(120).nullish(),
    proposedName: z.string().max(140).nullish(),
    proposedCity: z.string().max(80).nullish(),
    contactName: z.string().min(2).max(80),
    contactEmail: z.string().email().max(200),
    contactPhone: z.string().max(30).nullish(),
    statedRole: z.string().min(2).max(80),
    evidenceNote: z.string().max(400).nullish(),
  })
  .strict()
  .refine((v) => Boolean(v.hospitalId) !== Boolean(v.proposedName), {
    message: 'Either choose a listed hospital or give the name of one to add — not both.',
  });

/**
 * Submit a claim over a hospital.
 *
 * This endpoint cannot grant access. It writes a row with status 'pending'
 * and returns; there is no branch in it, or in createClaim, that produces a
 * membership. Taking control of a facility's published information and its
 * patients' appointments has to involve a person checking who the claimant
 * actually is, and an HTTP request is not that.
 *
 * Open to signed-out callers on purpose: the whole point is that nobody at
 * the hospital has an account yet.
 */
export async function POST(req: NextRequest) {
  try {
    // Tighter than the usual limit. This is unauthenticated and creates
    // review work for a human, so the cost of abuse lands on people.
    const rl = rateLimit(`hospital-claim:${clientKey(req)}`, 3);
    if (!rl.allowed) {
      return fail(429, 'Too many submissions. Please wait a minute.', { retryInMs: rl.resetInMs });
    }

    const body = Body.parse(await readJson(req, 3000));

    // If a hospital id is named it has to be real — otherwise a claim could
    // be filed against an id that does not exist and sit in the queue.
    let hospitalName: string | null = null;
    if (body.hospitalId) {
      const repo = await getRepo();
      const hospital = await repo.getHospital(body.hospitalId);
      if (!hospital) return fail(404, 'That hospital is not listed on FlowCare.');
      hospitalName = hospital.name;
    }

    const { claim, duplicate } = await createClaim({
      hospitalId: body.hospitalId ?? null,
      proposedName: body.proposedName ?? null,
      proposedCity: body.proposedCity ?? null,
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone ?? null,
      statedRole: body.statedRole,
      evidenceNote: body.evidenceNote ?? null,
    });

    return ok({
      claim: {
        id: claim.id,
        status: claim.status,
        hospitalName: hospitalName ?? claim.proposedName,
        createdAt: claim.createdAt,
      },
      duplicate,
      // Said plainly rather than implied, and never "we have emailed you":
      // no mail provider is configured on this deployment.
      durable: storageIsDurable(),
      message: duplicate
        ? 'We already have this claim. It is still being reviewed.'
        : 'Claim submitted. A FlowCare reviewer has to verify it before any access is granted.',
    });
  } catch (e) {
    return handleError(e);
  }
}
