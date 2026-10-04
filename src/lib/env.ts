/**
 * Central environment access. Server-only values are read lazily so that a
 * missing variable degrades a single feature instead of crashing the app.
 */
const s = (v: string | undefined) => (v && v.trim().length > 0 ? v.trim() : undefined);

export const env = {
  supabaseUrl: () => s(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () => s(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseServiceKey: () => s(process.env.SUPABASE_SERVICE_ROLE_KEY),

  googleMapsServerKey: () => s(process.env.GOOGLE_MAPS_API_KEY),
  placesRegion: () => s(process.env.PLACES_DEFAULT_REGION) ?? 'in',
  placesLanguage: () => s(process.env.PLACES_DEFAULT_LANGUAGE) ?? 'en',

  aiDefaultProvider: () => s(process.env.AI_DEFAULT_PROVIDER) ?? 'groq',
  aiTimeoutMs: () => Number(s(process.env.AI_TIMEOUT_MS) ?? 8000),
  aiMaxInputChars: () => Number(s(process.env.AI_MAX_INPUT_CHARS) ?? 400),
  aiRateLimitPerMin: () => Number(s(process.env.AI_RATE_LIMIT_PER_MIN) ?? 10),

  /** F6 — Routes API is billed separately from Places; opt in explicitly. */
  routesApiEnabled: () => s(process.env.GOOGLE_ROUTES_ENABLED) === 'true',

  /**
   * F16 — salt for one-way value fingerprints. Without it, discrepancy
   * detection stays off rather than hashing with a predictable salt.
   */
  discrepancySalt: () => s(process.env.FLOWCARE_DISCREPANCY_SALT),
  /**
   * F16 ships dark by default: comparing FlowCare values against Google
   * values is pending the Maps Service Terms review recorded in
   * docs/research/03-review-and-plan.md §10.1 R16.
   */
  discrepancyEnabled: () => s(process.env.FLOWCARE_DISCREPANCY_ENABLED) === 'true',

  demoModeForced: () => s(process.env.FLOWCARE_DEMO_MODE) === 'true',

  /**
   * Read the facility record from the live Supabase project with the
   * publishable key (RLS still applies), while appointment slots, reviews
   * and sign-in continue to come from the local demo store. Used because the
   * project has real hospitals and published slots, while review reads remain
   * intentionally disabled until the live review vocabulary is mapped.
   */
  liveReadsEnabled: () => s(process.env.FLOWCARE_LIVE_READS) === 'true',
} as const;

/** True when we have no Supabase project wired up (or demo mode is forced). */
export function isDemoMode(): boolean {
  if (env.demoModeForced()) return true;
  return !(env.supabaseUrl() && env.supabaseAnonKey());
}

/**
 * Why demo mode is on, so the UI can say which it is.
 *
 * These are not the same situation and must not be described as if they
 * were. 'unconfigured' means there is no project to talk to. 'forced' means
 * there is a perfectly good project and this deployment chose to ignore it —
 * telling that operator "Supabase is not configured" is simply untrue, and
 * sends them off checking credentials that were never the problem.
 */
export type DemoReason = 'forced' | 'unconfigured';

/**
 * May this deployment honour demo accounts at all?
 *
 * Demo accounts are a cookie away from an administrator session — that is
 * the point of them, and it is why they must never coexist with a real
 * Supabase project on a public origin. Gating only the switching endpoint
 * is not enough: the cookie can be set by hand, and getSession() cannot
 * tell the difference.
 *
 * So this is checked where the cookie is READ, not only where it is
 * written. On a production build with a configured project, demo accounts
 * are off unless FLOWCARE_ALLOW_DEMO_AUTH=true says otherwise in so many
 * words.
 */
export function demoAccountsAllowed(): boolean {
  if (!isDemoMode()) return false;
  const configured = Boolean(env.supabaseUrl() && env.supabaseAnonKey());
  if (process.env.NODE_ENV === 'production' && configured) {
    return s(process.env.FLOWCARE_ALLOW_DEMO_AUTH) === 'true';
  }
  return true;
}

export function demoReason(): DemoReason | null {
  if (!isDemoMode()) return null;
  return env.demoModeForced() && env.supabaseUrl() && env.supabaseAnonKey()
    ? 'forced'
    : 'unconfigured';
}

/**
 * True when hospitals on screen are real rows from Supabase. Distinct from
 * full Supabase mode: writes and auth are still local.
 */
export function liveReadMode(): boolean {
  return env.liveReadsEnabled() && Boolean(env.supabaseUrl() && env.supabaseAnonKey());
}

export function googleMapsConfigured(): boolean {
  return Boolean(env.googleMapsServerKey());
}

/** F6 — routing needs both the key and the explicit opt-in. */
export function routingConfigured(): boolean {
  return Boolean(env.googleMapsServerKey()) && env.routesApiEnabled();
}

/** F16 — needs the feature flag AND a salt. Both, or the feature is off. */
export function discrepancyDetectionConfigured(): boolean {
  return env.discrepancyEnabled() && Boolean(env.discrepancySalt());
}
