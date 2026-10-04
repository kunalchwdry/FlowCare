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
const SIGNED_IN_AREAS = ['/patient', '/staff', '/hospital'] as const;
/** ...except the doors into them. */
const PUBLIC_AUTH_PATHS = [
  '/patient/login', '/patient/signup', '/staff/login', '/staff/register',
  // Both hospital doors are public by necessity: /login is where you sign
  // in, and /register exists precisely for hospitals where nobody has an
  // account yet. Gating either behind a credential would be circular.
  '/hospital/login', '/hospital/register',
];

/**
 * Hostnames that should land on the hospital portal instead of the patient
 * app. Comma-separated, set per deployment:
 *
 *   HOSPITAL_HOSTS=hospital.flowcare.in,staff.flowcare.in
 *
 * A bare `hospital.` prefix is also honoured so a new environment works
 * without configuration. Matching is on the host header only — never on
 * anything the page can influence.
 */
function isHospitalHost(host: string): boolean {
  const bare = host.split(':')[0].toLowerCase();
  const configured = (process.env.HOSPITAL_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (configured.includes(bare)) return true;
  return bare.startsWith('hospital.') || bare.startsWith('staff.');
}

function signedInDoorFor(pathname: string): string | null {
  if (PUBLIC_AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  const area = SIGNED_IN_AREAS.find((a) => pathname === a || pathname.startsWith(`${a}/`));
  if (!area) return null;
  if (area === '/hospital') return '/hospital/login';
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
  /*
   * One deployment, two front doors.
   *
   * On a hospital hostname every path is served from under /hospital. This
   * is a rewrite, not a redirect: the visitor keeps seeing
   * hospital.example.com/appointments while Next renders
   * /hospital/appointments. Hospitals get their own address without a second
   * application, a second auth system or a second copy of the state machine.
   *
   * /api is deliberately excluded. The routes are shared by both sides and
   * already authorise per request; rewriting them would mean the same
   * endpoint had two paths depending on which hostname called it.
   */
  const host = request.headers.get('host') ?? '';
  const { pathname } = request.nextUrl;
  // These are shared public doors. They must remain on their real routes:
  // a staff member without access needs /staff/register to request access,
  // not a rewritten /hospital/staff/register route that does not exist.
  const sharedStaffDoor = pathname === '/staff/login' || pathname === '/staff/register';
  const sharedRecoveryDoor =
    pathname === '/forgot-password' ||
    pathname === '/forgot-password/sent' ||
    pathname === '/auth/callback' ||
    pathname === '/reset-password';
  const sharedReviewerDoor = pathname === '/admin/hospital-registrations';
  const authShellPath =
    pathname === '/forgot-password' ||
    pathname === '/forgot-password/sent' ||
    pathname === '/reset-password' ||
    pathname === '/patient/login' ||
    pathname === '/patient/signup' ||
    pathname === '/staff/login' ||
    pathname === '/staff/register';
  if (
    isHospitalHost(host) &&
    !sharedStaffDoor &&
    !sharedRecoveryDoor &&
    !sharedReviewerDoor &&
    !pathname.startsWith('/hospital') &&
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/_next')
  ) {
    const to = request.nextUrl.clone();
    to.pathname = `/hospital${pathname === '/' ? '' : pathname}`;
    const headers = new Headers(request.headers);
    headers.set('x-flowcare-area', 'hospital');
    return NextResponse.rewrite(to, { request: { headers } });
  }

  /*
   * Tell the root layout which product this request belongs to.
   *
   * A layout cannot see the pathname, so without this the patient header —
   * Discover, Map, Saved, Care hub — was drawn around the hospital portal,
   * giving staff a second navigation they must not use and a second
   * FlowCare logo on the sign-in page.
   */
  if (
    pathname === '/hospital' ||
    pathname.startsWith('/hospital/') ||
    sharedReviewerDoor ||
    (isHospitalHost(host) && sharedStaffDoor)
  ) {
    const headers = new Headers(request.headers);
    headers.set('x-flowcare-area', 'hospital');
    return NextResponse.next({ request: { headers } });
  }

  const door = signedInDoorFor(request.nextUrl.pathname);
  if (door && !hasAnyCredential(request)) {
    const to = request.nextUrl.clone();
    /*
     * On a hospital hostname the /hospital prefix is an implementation
     * detail of the rewrite, so it must not surface in a redirect: the
     * visitor should see hospital.example.com/login, not
     * hospital.example.com/hospital/login. The `next` value is stripped the
     * same way, otherwise sign-in would bounce them to a doubled path.
     */
    const onHospitalHost = isHospitalHost(request.headers.get('host') ?? '');
    const strip = (path: string) =>
      onHospitalHost && path.startsWith('/hospital')
        ? path.slice('/hospital'.length) || '/'
        : path;

    to.pathname = strip(door);
    to.search = `?next=${encodeURIComponent(strip(request.nextUrl.pathname))}`;
    return NextResponse.redirect(to);
  }

  const requestHeaders = new Headers(request.headers);
  if (authShellPath) requestHeaders.set('x-flowcare-shell', 'auth');
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: CookieToSet[]) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
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
