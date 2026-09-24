/**
 * Live-database suite. Separate from vitest.config.ts on purpose.
 *
 * These tests talk to a real Supabase project over the network, so they must
 * never run as part of the default `npm test`: that suite has to stay
 * hermetic and offline. Keeping them in their own config also means the
 * default run reports no skipped tests, so "green with skips" — which reads
 * like a pass but proves nothing — cannot happen by accident.
 *
 *   npm run test:live
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
});
