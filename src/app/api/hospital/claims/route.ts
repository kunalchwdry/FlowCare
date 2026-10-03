import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClaim, storageIsDurable } from '@/lib/hospital/claims';
import { dnsToken, planVerification } from '@/lib/hospital/verification';
import { getRepo } from '@/lib/data';
import { getSupabaseServerClient } from '@/lib/supabase/server';
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
    address: z.string().max(240).nullish(),
    website: z.string().url().max(240).nullish(),
    contactName: z.string().min(2).max(120),
    contactEmail: z.string().email().max(200),
    contactPhone: z.string().max(30).nullish(),
    statedRole: z.string().min(2).max(80),
    evidenceNote: z.string().max(400).nullish(),
    licenseNumber: z.string().max(120).nullish(),
    licenseAuthority: z.string().max(160).nullish(),
    licenseExpiresOn: z.string().date().nullish(),
  })
  .strict()
  .refine((v) => Boolean(v.hospitalId) !== Boolean(v.proposedName), {
    message: 'Either choose a listed hospital or give the name of one to add — not both.',
  });

function isUuid(value: string | null | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

/**
 * Submit a hospital onboarding application.
 *
 * A submission is deliberately separate from a membership: it never grants
 * portal access. In Supabase mode the write goes through the public RPC from
 * migration 0009, which is the only write path available to signed-out
 * callers. Local/demo mode keeps the older file-backed claim store so the
 * form remains testable before migrations are applied.
 */
export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`hospital-claim:${clientKey(req)}`, 3);
    if (!rl.allowed) {
      return fail(429, 'Too many submissions. Please wait a minute.', { retryInMs: rl.resetInMs });
    }

    const body = Body.parse(await readJson(req, 4000));

    let hospitalName: string | null = null;
    let verification: ReturnType<typeof planVerification> | null = null;
    if (body.hospitalId) {
      const repo = await getRepo();
      const hospital = await repo.getHospital(body.hospitalId);
      if (!hospital) return fail(404, 'That hospital is not listed on FlowCare.');
      hospitalName = hospital.name;
      verification = planVerification(hospital, body.contactEmail);
    }

    const supabase = await getSupabaseServerClient();
    const useSupabase = Boolean(supabase && (isUuid(body.hospitalId) || body.proposedName));

    if (useSupabase && supabase) {
      const { data, error } = await supabase.rpc('submit_hospital_registration', {
        p_hospital_id: isUuid(body.hospitalId) ? body.hospitalId : null,
        p_proposed_name: body.proposedName ?? null,
        p_proposed_city: body.proposedCity ?? null,
        p_address: body.address ?? null,
        p_website: body.website ?? null,
        p_admin_name: body.contactName,
        p_admin_email: body.contactEmail,
        p_admin_phone: body.contactPhone ?? null,
        p_evidence_note: body.evidenceNote ?? null,
        p_license_number: body.licenseNumber ?? null,
        p_license_authority: body.licenseAuthority ?? null,
        p_license_expires_on: body.licenseExpiresOn ?? null,
      });

      if (error) {
        // A local checkout may have the app code before the new migration has
        // been applied. Keep that checkout usable, but never silently fall
        // back on Vercel where a file write is not durable.
        if (process.env.NODE_ENV === 'production') {
          return fail(503, 'Hospital registration is not enabled on this deployment yet. Apply the FlowCare hospital-registration migration and try again.');
        }
      } else {
        const registration = (data ?? {}) as {
          id?: string;
          status?: string;
          duplicate?: boolean;
          created_at?: string;
        };
        return ok({
          claim: {
            id: registration.id ?? 'registration-submitted',
            status: registration.status ?? 'pending',
            hospitalName: hospitalName ?? body.proposedName,
            createdAt: registration.created_at ?? new Date().toISOString(),
          },
          duplicate: Boolean(registration.duplicate),
          verification: verification
            ? {
                hospitalDomain: verification.hospitalDomain,
                emailDomainMatches: verification.emailDomainMatches,
                routes: verification.routes,
                dnsRecord: verification.hospitalDomain
                  ? { host: verification.hospitalDomain, type: 'TXT', value: dnsToken(registration.id ?? 'registration-submitted') }
                  : null,
              }
            : null,
          durable: true,
          message: registration.duplicate
            ? 'We already have this hospital registration. It is still being reviewed.'
            : 'Registration submitted. A FlowCare reviewer will verify the hospital before portal access is granted.',
        });
      }
    }

    // Demo/local fallback. This path is intentionally labelled non-durable.
    const { claim, duplicate } = await createClaim({
      hospitalId: body.hospitalId ?? null,
      proposedName: body.proposedName ?? null,
      proposedCity: body.proposedCity ?? null,
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone ?? null,
      statedRole: body.statedRole,
      evidenceNote: body.evidenceNote ?? null,
      emailDomainMatches: verification?.emailDomainMatches ?? null,
    });

    return ok({
      claim: {
        id: claim.id,
        status: claim.status,
        hospitalName: hospitalName ?? claim.proposedName,
        createdAt: claim.createdAt,
      },
      duplicate,
      verification: verification
        ? {
            hospitalDomain: verification.hospitalDomain,
            emailDomainMatches: verification.emailDomainMatches,
            routes: verification.routes,
            dnsRecord: verification.hospitalDomain
              ? { host: verification.hospitalDomain, type: 'TXT', value: dnsToken(claim.id) }
              : null,
          }
        : null,
      durable: storageIsDurable(),
      message: duplicate
        ? 'We already have this hospital registration. It is still being reviewed.'
        : 'Registration submitted. A FlowCare reviewer will verify the hospital before portal access is granted.',
    });
  } catch (e) {
    return handleError(e);
  }
}
