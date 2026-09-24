import { NextRequest, NextResponse } from 'next/server';
import { photoMediaUrl } from '@/lib/places/client';
import { fail, handleError, tooMany } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streams a Google Place photo without exposing the API key to the browser.
 * The photo resource name comes from a Place Details response and is validated
 * against the expected `places/<id>/photos/<ref>` shape.
 */
export async function GET(req: NextRequest) {
  try {
    const rl = rateLimit(`photo:${clientKey(req)}`, 120);
    if (!rl.allowed) return tooMany('Too many photo requests', rl.resetInMs);

    const name = req.nextUrl.searchParams.get('name') ?? '';
    const width = Math.min(Math.max(Number(req.nextUrl.searchParams.get('w') ?? 640), 100), 1600);
    if (!/^places\/[A-Za-z0-9_\-]+\/photos\/[A-Za-z0-9_\-]+$/.test(name)) {
      return fail(400, 'Invalid photo reference');
    }

    const url = photoMediaUrl(name, width);
    if (!url) return fail(503, 'Google Maps is not configured on this deployment.');

    const upstream = await fetch(url, { cache: 'no-store' });
    if (!upstream.ok || !upstream.body) return fail(502, 'Photo unavailable');

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
        // Short-lived, performance-only caching. Photo bytes are never persisted.
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
