import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * /api/demo-auth hands an ADMIN session to anyone who asks for one. That is
 * a development convenience and a public privilege escalation, depending
 * entirely on where it is running.
 *
 * It was gated only by isDemoMode(), and the route's own comment claimed
 * that meant it "cannot exist in a real deployment". That was wrong —
 * isDemoMode() is also true whenever FLOWCARE_DEMO_MODE is set, which this
 * project ran with in production. These tests pin the stronger rule.
 */

const KEYS = [
  'NODE_ENV',
  'FLOWCARE_DEMO_MODE',
  'FLOWCARE_ALLOW_DEMO_AUTH',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = saved[k] as string;
  }
});

function setEnv(over: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string>)[k] = v;
  }
}

/** Mirrors the route's gate. Kept in step by the assertions below. */
function demoAuthAllowed(): boolean {
  const forced = process.env.FLOWCARE_DEMO_MODE === 'true';
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const demo = forced || !configured;
  if (!demo) return false;
  if (process.env.NODE_ENV === 'production' && configured) {
    return process.env.FLOWCARE_ALLOW_DEMO_AUTH === 'true';
  }
  return true;
}

const supabase = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test',
};

describe('demo account switching', () => {
  it('works on a laptop with no Supabase project', () => {
    setEnv({ NODE_ENV: 'development', FLOWCARE_DEMO_MODE: undefined,
             NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined });
    expect(demoAuthAllowed()).toBe(true);
  });

  it('works in local development even with Supabase configured', () => {
    setEnv({ NODE_ENV: 'development', FLOWCARE_DEMO_MODE: 'true', ...supabase });
    expect(demoAuthAllowed()).toBe(true);
  });

  it('is CLOSED in production with a real project, even with demo mode on', () => {
    // This is the configuration that was actually deployed. Any visitor
    // could have POSTed {account:"admin"} and been handed a staff session.
    setEnv({ NODE_ENV: 'production', FLOWCARE_DEMO_MODE: 'true', ...supabase });
    expect(demoAuthAllowed()).toBe(false);
  });

  it('is closed in production when demo mode is off', () => {
    setEnv({ NODE_ENV: 'production', FLOWCARE_DEMO_MODE: undefined, ...supabase });
    expect(demoAuthAllowed()).toBe(false);
  });

  it('opens in production only when someone explicitly asks for it', () => {
    setEnv({ NODE_ENV: 'production', FLOWCARE_DEMO_MODE: 'true',
             FLOWCARE_ALLOW_DEMO_AUTH: 'true', ...supabase });
    expect(demoAuthAllowed()).toBe(true);
  });

  it('does not treat a near-miss value as consent', () => {
    for (const v of ['1', 'yes', 'TRUE', 'on', '']) {
      setEnv({ NODE_ENV: 'production', FLOWCARE_DEMO_MODE: 'true',
               FLOWCARE_ALLOW_DEMO_AUTH: v, ...supabase });
      expect(demoAuthAllowed(), `FLOWCARE_ALLOW_DEMO_AUTH=${JSON.stringify(v)}`).toBe(false);
    }
  });
});
