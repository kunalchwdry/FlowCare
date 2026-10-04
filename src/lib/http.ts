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
