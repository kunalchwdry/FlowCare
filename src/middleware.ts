import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

/**
 * Refreshes the Supabase auth cookie on every navigation.
 *
 * Without this, an access token expires mid-session and Server Components
 * start seeing a logged-out user while the browser still believes it is
 * signed in. `getUser()` is called deliberately — it revalidates the token
 * with Supabase, whereas `getSession()` would trust whatever the cookie says.
 *
 * This middleware refreshes cookies and performs ONE navigation courtesy:
 * sending a visitor with no credential at all to the correct sign-in door.
 * That is a redirect, not an authorisation decision. It deliberately does
 * not inspect roles or validate the token, because every real authorisation
 * decision in FlowCare is made by Postgres RLS — and a role check here would
 * create a second, weaker source of truth that could drift from the database.
 */

/** Areas that are meaningless to a signed-out visitor. */
const SIGNED_IN_AREAS = ['/patient', '/staff'] as const;
/** ...except the doors into them. */
const PUBLIC_AUTH_PATHS = [
  '/patient/login', '/patient/signup', '/staff/login', '/staff/register',
];

function signedInDoorFor(pathname: string): string | null {
  if (PUBLIC_AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  const area = SIGNED_IN_AREAS.find((a) => pathname === a || pathname.startsWith(`${a}/`));
  if (!area) return null;
  return area === '/staff' ? '/staff/login' : '/patient/login';
}

/**
 * Presence-only check. A forged or expired cookie still gets through here
 * and is rejected properly further in; this only avoids rendering a
 * dashboard skeleton at someone who was never signed in.
 */
function hasAnyCredential(request: NextRequest): boolean {
  if (request.cookies.get('fc_demo_user')) return true;
  return request.cookies.getAll().some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));
}

export async function middleware(request: NextRequest) {
  const door = signedInDoorFor(request.nextUrl.pathname);
  if (door && !hasAnyCredential(request)) {
    const to = request.nextUrl.clone();
    to.pathname = door;
    to.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.redirect(to);
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: CookieToSet[]) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options as never));
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    /* never block a page render because token refresh failed */
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Keeping the matcher
     * tight matters on Vercel, where middleware runs on every matched request.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
