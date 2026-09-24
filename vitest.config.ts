import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // tests/live/** talks to a real Supabase project over the network and has
    // its own config (vitest.live.config.ts). Excluded here so the default
    // suite stays hermetic and reports zero skipped tests.
    exclude: ['tests/live/**', 'node_modules/**', 'dist/**', '.next/**'],
    globals: true,
    setupFiles: ['tests/setup.ts'],
    /**
     * The HTTP suites back off and retry when they hit a 429 (rate limits are
     * real controls, and the tests that exercise them saturate shared
     * buckets). That retry budget can reach ~6s, which quietly exceeds
     * vitest's 5s default and surfaces as "Test timed out" rather than as the
     * assertion the test was actually making. 20s leaves headroom.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // see tests/stubs/server-only.ts
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
});
