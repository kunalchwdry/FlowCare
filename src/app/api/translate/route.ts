import { NextRequest } from 'next/server';
import { track } from '@/lib/analytics';
import { fail, handleError, ok } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { translate } from '@/lib/journey/translator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * F1 — lay words to departments. Deterministic dictionary lookup, no LLM,
 * no network. The rate limit exists only to bound abuse of a public endpoint;
 * the work itself is a few dozen regex tests.
 */
export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
    if (!q) return fail(400, 'q is required');
    if (q.length > 200) return fail(400, 'Query is too long');

    const limit = rateLimit(`translate:${clientKey(req)}`, 120);
    if (!limit.allowed) return fail(429, 'Too many requests. Please slow down.');

    const result = translate(q);

    // §9.1: the query itself is a care context and is never logged. Only its
    // length and whether anything matched.
    track('care_need_translated', req.headers.get('x-flowcare-session') ?? 'anon', {
      query_length: q.length,
      matched: result.translations.length > 0,
      department_count: result.suggestedSpecialties.length,
    });

    return ok(result);
  } catch (e) {
    return handleError(e);
  }
}
