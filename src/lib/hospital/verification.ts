/**
 * How a hospital claim gets checked.
 *
 * The question this answers: anyone can submit a claim, so what stops
 * anyone from taking over a hospital?
 *
 * Not a separate domain for the sign-up form — a hostname authenticates
 * nobody, and `hospital-signup.example.com` is exactly as reachable by a
 * stranger as `/hospital/register`. Obscurity is not a control.
 *
 * What works is proving a connection the claimant could not fake without
 * already having access to the hospital's own property: its domain, its
 * published switchboard, its letterhead. Those are ranked below, strongest
 * first, and the ranking is computed from data FlowCare already holds about
 * the facility rather than from anything the claimant typed.
 *
 * None of these approve a claim on their own. They tell a reviewer how much
 * work is left, and a domain match in particular proves control of a
 * mailbox, not authority to hand over a hospital's appointments.
 */
import { promises as dns } from 'node:dns';
import { createHash, randomBytes } from 'node:crypto';
import type { Hospital } from '@/lib/types';

export type VerificationRoute = 'dns_token' | 'email_domain' | 'callback' | 'manual';

export interface RouteOption {
  id: VerificationRoute;
  label: string;
  detail: string;
  /** Can this route even be attempted for this hospital? */
  available: boolean;
  strength: 'strong' | 'moderate' | 'weak';
}

/** Public-suffix-naive host reduction. Good enough to compare org domains. */
export function registrableDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  if (host.includes('@')) host = host.split('@').pop() ?? '';
  host = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  host = host.replace(/^www\./, '');
  if (!host.includes('.')) return null;
  const parts = host.split('.');
  // Handle the common Indian second-level cases so co.in / org.in / gov.in
  // are not mistaken for the registrable domain.
  const twoLevel = new Set(['co', 'org', 'net', 'gov', 'ac', 'edu', 'res', 'nic']);
  if (parts.length >= 3 && twoLevel.has(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/** Deterministic, per-claim, and safe to publish — it proves nothing alone. */
export function dnsToken(claimId: string): string {
  const digest = createHash('sha256').update(`flowcare:${claimId}`).digest('hex').slice(0, 32);
  return `flowcare-verification=${digest}`;
}

export function newClaimSecret(): string {
  return randomBytes(16).toString('hex');
}

export function planVerification(
  hospital: Pick<Hospital, 'website' | 'phone'> | null,
  contactEmail: string,
): { routes: RouteOption[]; emailDomainMatches: boolean | null; hospitalDomain: string | null } {
  const hospitalDomain = registrableDomain(hospital?.website ?? null);
  const emailDomain = registrableDomain(contactEmail);

  // null, not false, when there is nothing to compare against — "we could
  // not check" and "we checked and it did not match" are different facts
  // and a reviewer must not see them as the same.
  const emailDomainMatches =
    hospitalDomain && emailDomain ? hospitalDomain === emailDomain : null;

  const routes: RouteOption[] = [
    {
      id: 'dns_token',
      label: 'Prove control of the hospital’s domain',
      detail: hospitalDomain
        ? `Add a TXT record to ${hospitalDomain}. Only someone who runs that domain can do it, so this is checked automatically and needs nobody’s judgement.`
        : 'Not available — FlowCare has no website recorded for this hospital.',
      available: Boolean(hospitalDomain),
      strength: 'strong',
    },
    {
      id: 'callback',
      label: 'Call the hospital’s published number',
      detail: hospital?.phone
        ? 'A reviewer rings the switchboard number already published for this hospital and asks for you by name. The number is one FlowCare already held, not one supplied in this form.'
        : 'Not available — FlowCare has no phone number recorded for this hospital.',
      available: Boolean(hospital?.phone),
      strength: 'strong',
    },
    {
      id: 'email_domain',
      label: 'Work email on the hospital’s domain',
      detail:
        emailDomainMatches === true
          ? `Your email is on ${hospitalDomain}, which matches the hospital’s website. Useful, but it shows you have a mailbox there — not that you speak for the hospital.`
          : hospitalDomain
            ? `Your email is not on ${hospitalDomain}. That is not disqualifying, it just means we cannot use it as evidence.`
            : 'Not available — no website on record to compare against.',
      available: emailDomainMatches === true,
      strength: 'moderate',
    },
    {
      id: 'manual',
      label: 'Documentation',
      detail:
        'Registration certificate, letterhead, or a listing naming you. Slowest route, and the only one open when FlowCare holds no website or phone for the hospital.',
      available: true,
      strength: 'weak',
    },
  ];

  return { routes, emailDomainMatches, hospitalDomain };
}

/**
 * Look for the claim's token in the hospital domain's TXT records.
 *
 * The one check here that is genuinely self-serve: publishing a TXT record
 * on a domain requires control of that domain, which a stranger does not
 * have. Everything else needs a person.
 *
 * Failure is never treated as evidence of bad faith — DNS propagates slowly
 * and plenty of hospitals outsource their domain.
 */
export async function checkDnsToken(
  hospitalWebsite: string | null,
  claimId: string,
): Promise<{ ok: boolean; domain: string | null; reason: string }> {
  const domain = registrableDomain(hospitalWebsite);
  if (!domain) {
    return { ok: false, domain: null, reason: 'No website is recorded for this hospital.' };
  }
  const expected = dnsToken(claimId);
  try {
    const records = await dns.resolveTxt(domain);
    const flat = records.map((chunks) => chunks.join('')).map((s) => s.trim());
    if (flat.some((r) => r === expected)) {
      return { ok: true, domain, reason: 'TXT record found.' };
    }
    return {
      ok: false,
      domain,
      reason:
        'The record is not visible yet. DNS can take up to an hour to propagate — this can be retried.',
    };
  } catch {
    return {
      ok: false,
      domain,
      reason: 'Could not read DNS for that domain. This can be retried.',
    };
  }
}
