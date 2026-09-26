import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Email = z.string().email().max(200);

/**
 * Password recovery.
 *
 * Accepts a normal form post so the page works without JavaScript, and
 * always redirects to the same confirmation regardless of outcome. Telling
 * the caller whether an address exists would turn this into an account
 * enumeration oracle.
 */
export async function POST(req: NextRequest) {
  const sent = new URL('/forgot-password/sent', req.nextUrl.origin);

  try {
    const rl = rateLimit(`recover:${clientKey(req)}`, 5);
    if (rl.allowed) {
      const form = await req.formData();
      const parsed = Email.safeParse(String(form.get('email') ?? ''));
      const supabase = await getSupabaseServerClient();
      if (parsed.success && supabase) {
        await supabase.auth
          .resetPasswordForEmail(parsed.data, {
            redirectTo: `${req.nextUrl.origin}/patient/login`,
          })
          .catch(() => undefined);
      }
    }
  } catch {
    // Swallowed on purpose: the response must not vary with the outcome.
  }

  return NextResponse.redirect(sent, { status: 303 });
}
