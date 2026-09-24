import { NextRequest } from 'next/server';
import { autocomplete } from '@/lib/places/client';
import { handleError, ok } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Proxy for Places Autocomplete (New). The browser sends a session token it
 * generated (a v4 UUID) so the typing session and the follow-up details call
 * are billed as one session; the API key stays on the server.
 */
export async function GET(req: NextRequest) {
  try {
    const rl = rateLimit(`ac:${clientKey(req)}`, 60);
    if (!rl.allowed) return ok({ suggestions: [], throttled: true });

    const input = req.nextUrl.searchParams.get('input') ?? '';
    const token = req.nextUrl.searchParams.get('sessionToken') ?? undefined;
    const lat = Number(req.nextUrl.searchParams.get('lat'));
    const lng = Number(req.nextUrl.searchParams.get('lng'));
    const bias = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;

    const res = await autocomplete(input, { sessionToken: token, bias });
    return ok({
      suggestions: res.data ?? [],
      status: res.status,
      message: res.message ?? null,
      attribution: 'Powered by Google',
    });
  } catch (e) {
    return handleError(e);
  }
}
