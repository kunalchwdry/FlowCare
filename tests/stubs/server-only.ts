/**
 * `server-only` throws when it is resolved through the client condition, which
 * is what Vitest's default node resolution does. The package is a build-time
 * guard for Next.js, not runtime behaviour, so tests alias it to a no-op. The
 * real guard still applies to the Next.js build (verified by `npm run build`).
 */
export {};
