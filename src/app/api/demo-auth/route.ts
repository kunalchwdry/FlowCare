import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDemoMode } from '@/lib/env';
import { DEMO_COOKIE } from '@/lib/auth/session';
import { fail, handleError, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ account: z.enum(['patient', 'patient2', 'staff', 'admin', 'signout']) }).strict();

/**
 * DEMO ONLY. Switches the local demo account so the review/favourite/moderation
 * flows can be exercised without a Supabase project. Returns 404 whenever
 * Supabase is configured, so it cannot exist in a real deployment.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isDemoMode()) return fail(404, 'Not found');
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
