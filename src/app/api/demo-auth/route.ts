import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { demoAccountsAllowed } from '@/lib/env';
import { DEMO_COOKIE } from '@/lib/auth/session';
import { fail, handleError, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ account: z.enum(['patient', 'patient2', 'staff', 'admin', 'signout']) }).strict();

/**
 * DEMO ONLY. Switches the local demo account so the review, favourite and
 * moderation flows can be exercised without a Supabase project.
 *
 * This endpoint hands out an ADMIN session to anyone who asks. That is fine
 * on a laptop and unacceptable on the public internet, so it is gated twice.
 *
 * The first gate used to be the only one, and the comment here claimed it
 * meant the route "cannot exist in a real deployment". That was wrong:
 * isDemoMode() is also true when FLOWCARE_DEMO_MODE is set, regardless of
 * whether Supabase is configured. A deployment running with that flag on —
 * which this project did — exposed a one-request path to a staff dashboard
 * for any visitor.
 *
 * So the second gate refuses outright on a production build that has a real
 * Supabase project behind it. Demo accounts and real accounts should never
 * be reachable from the same origin. FLOWCARE_ALLOW_DEMO_AUTH=true overrides
 * it for a deliberate public demo, which at least makes that a decision
 * somebody typed out rather than a default nobody noticed.
 */
export async function POST(req: NextRequest) {
  try {
    if (!demoAccountsAllowed()) return fail(404, 'Not found');
    const { account } = Body.parse(await readJson(req, 500));
    const res = NextResponse.json({ ok: true, data: { account } });
    if (account === 'signout') {
      res.cookies.set(DEMO_COOKIE, '', { path: '/', maxAge: 0 });
    } else {
      res.cookies.set(DEMO_COOKIE, account, {
        path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 8,
      });
    }
    return res;
  } catch (e) {
    return handleError(e);
  }
}
