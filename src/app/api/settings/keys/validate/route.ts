import { NextRequest } from 'next/server';
import { z } from 'zod';
import { SUPPORTED_PROVIDERS, validateUserKey } from '@/lib/ai/userKeys';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ provider: z.enum(SUPPORTED_PROVIDERS) }).strict();

/**
 * Makes a REAL minimal call to the provider with the user's stored key.
 *
 * A shape check cannot tell you whether a key is revoked, out of quota, or
 * lacks access to the model — only the provider can. The stored status is
 * updated from the outcome, so the settings screen never claims a key works
 * on the strength of it merely looking like a key.
 */
export async function POST(req: NextRequest) {
  try {
    const sb = await getSupabaseServerClient();
    if (!sb) return fail(503, 'Supabase is not configured on this server.');
    const { data } = await sb.auth.getUser();
    if (!data.user) return fail(401, 'Sign in to test your API keys.');

    // Each test costs the user a (tiny) provider call, so it is throttled.
    const rl = rateLimit(`keytest:${clientKey(req)}`, 10);
    if (!rl.allowed) return fail(429, 'Too many key tests. Please wait a minute.');

    const body = Body.parse(await readJson(req, 500));
    const result = await validateUserKey(body.provider, env.aiTimeoutMs());

    return ok({
      provider: body.provider,
      valid: result.ok,
      message: result.message,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return handleError(e);
  }
}
