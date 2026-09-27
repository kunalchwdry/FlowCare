import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    email: z.string().email().max(200),
    // Supabase enforces its own minimum; we ask for a little more.
    password: z.string().min(10, 'Use at least 10 characters.').max(200),
    fullName: z.string().min(1).max(80).nullish(),
    /**
     * Accepted so the client can be explicit, but deliberately NOT trusted.
     * Whatever arrives here, the account is created as a patient. Staff and
     * administrator roles live in app_metadata, which only a service-role
     * key can write, and are only ever set by an approval action.
     */
    role: z.enum(['patient', 'staff', 'admin']).nullish(),
    phone: z.string().max(20).nullish(),
    dateOfBirth: z.string().max(20).nullish(),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    // Account creation is a classic abuse target, so it is limited harder
    // than ordinary reads.
    const rl = rateLimit(`signup:${clientKey(req)}`, 5);
    if (!rl.allowed) {
      return fail(429, 'Too many sign-up attempts. Please wait a minute.', { retryInMs: rl.resetInMs });
    }

    const body = Body.parse(await readJson(req, 2000));
    const supabase = await getSupabaseServerClient();
    if (!supabase) {
      return fail(503, 'Accounts are unavailable because Supabase is not configured on this server.');
    }

    // user_metadata is self-asserted and treated as such: it holds display
    // and contact details only. Nothing here can grant a permission.
    const profile: Record<string, string> = {};
    if (body.fullName) profile.full_name = body.fullName;
    if (body.phone) profile.phone = body.phone;
    if (body.dateOfBirth) profile.date_of_birth = body.dateOfBirth;

    const { data, error } = await supabase.auth.signUp({
      email: body.email,
      password: body.password,
      options: { data: Object.keys(profile).length ? profile : undefined },
    });

    if (error) {
      // Do not distinguish "already registered" from other failures in a way
      // that lets someone enumerate which emails have accounts.
      const msg = /already registered|already exists/i.test(error.message)
        ? 'If that address can be used, check your email to continue.'
        : error.message;
      return fail(400, msg);
    }

    // With email confirmation on (the Supabase default) there is no session
    // yet. Say so plainly rather than implying the user is signed in.
    const needsConfirmation = !data.session;
    return ok({
      needsConfirmation,
      email: body.email,
      message: needsConfirmation
        ? 'Account created. Check your email for a confirmation link, then sign in.'
        : 'Account created and signed in.',
    });
  } catch (e) {
    return handleError(e);
  }
}
