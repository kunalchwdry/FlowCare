import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isDemoMode, liveReadMode, googleMapsConfigured } from '@/lib/env';
import { anyProviderConfigured } from '@/lib/ai/providers';
import { DEMO_COOKIE } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public, non-secret capability report used by the UI to decide what to show.
 * Deliberately exposes booleans only — never key values.
 */
export async function GET() {
  // The demo cookie is httpOnly, so the client cannot read which account is
  // active. Report the account *name* only — never a credential.
  const demoAccount = isDemoMode()
    ? ((await cookies()).get(DEMO_COOKIE)?.value ?? 'signout')
    : null;

  // Counts make the "live" claim specific and checkable rather than a vibe.
  let live: { hospitals: number; bookable: number } | null = null;
  if (liveReadMode()) {
    try {
      const { liveReadStats } = await import('@/lib/data/liveRepo');
      const stats = await liveReadStats();
      live = { hospitals: stats.hospitals, bookable: stats.bookable };
    } catch {
      live = null; // a failed read must not crash the shell
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      demoMode: isDemoMode(),
      liveReads: liveReadMode(),
      live,
      demoAccount,
      googleMaps: {
        serverConfigured: googleMapsConfigured(),
        browserMapKeyPresent: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY),
        mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? null,
      },
      ai: { anyProviderConfigured: anyProviderConfigured() },
    },
  });
}
