import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({ email: z.string().email().max(200), password: z.string().min(1).max(200) })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`signin:${clientKey(req)}`, 10);
    if (!rl.allowed) {
      return fail(429, 'Too many sign-in attempts. Please wait a minute.', { retryInMs: rl.resetInMs });
    }

    const body = Body.parse(await readJson(req, 2000));
    const supabase = await getSupabaseServerClient();
    if (!supabase) {
      return fail(503, 'Accounts are unavailable because Supabase is not configured on this server.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (error || !data.user) {
      // One message for every failure mode: wrong password, unknown address
      // and unconfirmed email are indistinguishable to an attacker.
      return fail(401, 'Those details did not match an account. If you have just signed up, confirm your email first.');
    }

    return ok({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: (data.user.user_metadata?.full_name as string) ?? data.user.email,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
