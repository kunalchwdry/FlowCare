import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * demoReason() exists so the UI can stop telling operators that Supabase is
 * not configured when it plainly is. The two causes of demo mode are
 * different faults with different fixes, and conflating them sends someone
 * off checking credentials that were never broken.
 */

const KEYS = [
  'FLOWCARE_DEMO_MODE',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

let saved: Record<string, string | undefined>;

async function envModule() {
  // The module reads process.env lazily through accessor functions, but the
  // import cache still has to be dropped so a fresh evaluation is guaranteed.
  const mod = await import('@/lib/env');
  return mod;
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

function configureSupabase() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example-ref.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_test_value';
}

describe('demo mode reporting', () => {
  it('reports no reason at all when Supabase is live', async () => {
    const { isDemoMode, demoReason } = await envModule();
    configureSupabase();
    delete process.env.FLOWCARE_DEMO_MODE;

    expect(isDemoMode()).toBe(false);
    expect(demoReason()).toBeNull();
  });

  it('says the flag is responsible when Supabase is configured but bypassed', async () => {
    const { isDemoMode, demoReason } = await envModule();
    configureSupabase();
    process.env.FLOWCARE_DEMO_MODE = 'true';

    expect(isDemoMode()).toBe(true);
    // The important assertion: NOT 'unconfigured'. Blaming configuration here
    // is the bug this function was added to prevent.
    expect(demoReason()).toBe('forced');
  });

  it('says configuration is responsible when there is no project', async () => {
    const { isDemoMode, demoReason } = await envModule();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.FLOWCARE_DEMO_MODE;

    expect(isDemoMode()).toBe(true);
    expect(demoReason()).toBe('unconfigured');
  });

  it('still blames configuration when the flag is set and there is no project', async () => {
    const { demoReason } = await envModule();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.FLOWCARE_DEMO_MODE = 'true';

    // Both are true, but the missing project is the one an operator has to
    // fix first, so it wins.
    expect(demoReason()).toBe('unconfigured');
  });

  it('treats a half-configured project as unconfigured', async () => {
    const { demoReason } = await envModule();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example-ref.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.FLOWCARE_DEMO_MODE = 'true';

    expect(demoReason()).toBe('unconfigured');
  });

  it('only honours the exact string "true" for the flag', async () => {
    const { isDemoMode } = await envModule();
    configureSupabase();
    for (const v of ['1', 'yes', 'TRUE', 'on', '']) {
      process.env.FLOWCARE_DEMO_MODE = v;
      expect(isDemoMode(), `FLOWCARE_DEMO_MODE=${JSON.stringify(v)}`).toBe(false);
    }
  });
});
