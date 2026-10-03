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

    /*
     * Resolve the role the same way getSession does — from memberships.
     *
     * This route returned no role at all, so the client fell back to
     * 'patient' on every sign-in and redirected there. On the hospital
     * hostname /patient does not exist, so a hospital administrator signing
     * in correctly was shown "Page not found".
     *
     * app_metadata is deliberately not consulted: only a service-role key
     * can write it, this deployment holds none, and memberships is the
     * live operational source with an approval trail behind it.
     */
    const { data: membership } = await supabase
      .from('memberships')
      .select('hospital_id, permissions')
      .eq('user_id', data.user.id)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const perms = (membership?.permissions as string[] | null) ?? [];
    const role = membership
      ? (perms.includes('memberships:manage') ? 'admin' : 'staff')
      : 'patient';

    return ok({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: (data.user.user_metadata?.full_name as string) ?? data.user.email,
        role,
        hospitalId: membership?.hospital_id ?? null,
        flowcareReviewer: data.user.app_metadata?.flowcare_reviewer === true
          || data.user.app_metadata?.flowcare_reviewer === 'true',
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
