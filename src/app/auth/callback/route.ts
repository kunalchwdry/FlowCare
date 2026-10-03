import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exchanges Supabase's PKCE recovery code for a browser session, then sends
 * the user to the password-update screen. The session is written to the
 * request cookies by the server client; the code itself is never displayed.
 */
export async function GET(req: NextRequest) {
  const nextParam = req.nextUrl.searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')
    ? nextParam
    : '/reset-password';
  const target = new URL(next, req.nextUrl.origin);
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    target.pathname = '/forgot-password';
    target.search = 'error=missing_code';
    return NextResponse.redirect(target);
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    target.pathname = '/forgot-password';
    target.search = 'error=unavailable';
    return NextResponse.redirect(target);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    target.pathname = '/forgot-password';
    target.search = 'error=expired_link';
  }
  return NextResponse.redirect(target);
}
