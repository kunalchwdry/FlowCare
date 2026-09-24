/**
 * Minimal fixed-window in-memory rate limiter.
 * Adequate for a single Node process / dev. A multi-instance deployment must
 * swap this for a shared store (documented in docs/security.md).
 */
interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

export interface RateLimitResult { allowed: boolean; remaining: number; resetInMs: number }

export function rateLimit(key: string, limit: number, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetInMs: windowMs };
  }
  b.count += 1;
  return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count), resetInMs: b.resetAt - now };
}

/** Coarse client key: prefers the authenticated user id, else a hashed IP. */
export function clientKey(req: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = (Math.imul(31, h) + ip.charCodeAt(i)) | 0;
  return `ip:${h}`;
}

export function __resetRateLimits() { buckets.clear(); }
