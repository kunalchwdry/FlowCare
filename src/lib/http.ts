import { NextResponse } from 'next/server';
import { HttpError } from '@/lib/auth/session';
import { ZodError } from 'zod';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: { message, ...extra } }, { status });
}

/**
 * 429 with a Retry-After header. Rate limiting must never surface as a 500:
 * clients (and our own tests) rely on the status code and the header to back
 * off correctly.
 */
export function tooMany(message: string, resetInMs: number) {
  const seconds = Math.max(1, Math.ceil(resetInMs / 1000));
  return NextResponse.json(
    { ok: false, error: { message, retryAfterSeconds: seconds } },
    { status: 429, headers: { 'Retry-After': String(seconds) } },
  );
}

/** Uniform error mapping; never leaks internal messages for 500s. */
export function handleError(e: unknown) {
  if (e instanceof HttpError) return fail(e.status, e.message, e.code ? { code: e.code } : undefined);
  if (e instanceof ZodError) {
    return fail(400, 'Invalid request', { issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  if (e instanceof Error && e.message === 'CARE_ACCESS_SYSTEM_ACTION_UNAVAILABLE') {
    return fail(503, 'Care Access system actions are not configured on this deployment.', { code: e.message });
  }
  if (e instanceof Error && e.message === 'SUPABASE_UNAVAILABLE') {
    return fail(503, 'The live data service is not configured on this deployment.', { code: e.message });
  }
  if (e instanceof Error) {
    const known = [
      { code: 'FORBIDDEN', status: 403, message: 'You do not have permission to change this hospital configuration.' },
      { code: 'NOT_FOUND', status: 404, message: 'That hospital record could not be found.' },
      { code: 'INVALID_INPUT', status: 400, message: 'Check the configuration values and try again.' },
      { code: 'BOOKING_CLOSED', status: 409, message: 'That slot is no longer open.' },
      { code: 'CAPACITY_FULL', status: 409, message: 'That slot has filled up.' },
      { code: 'WAITLIST_REQUIRED', status: 409, message: 'That slot requires joining the waitlist.' },
    ] as const;
    const match = known.find((item) => e.message.includes(item.code));
    if (match) return fail(match.status, match.message, { code: match.code });
  }
  console.error('[flowcare] unhandled error', e instanceof Error ? e.message : e);
  return fail(500, 'Something went wrong. Please try again.');
}

/** Reject oversized bodies before parsing. */
export async function readJson<T = unknown>(req: Request, maxBytes = 8_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request body too large');
  try {
    return JSON.parse(text || '{}') as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}
