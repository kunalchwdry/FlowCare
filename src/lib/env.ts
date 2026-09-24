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

  aiDefaultProvider: () => s(process.env.AI_DEFAULT_PROVIDER) ?? 'gemini',
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
   * project has real hospitals but no sessions table and no reviews.
   */
  liveReadsEnabled: () => s(process.env.FLOWCARE_LIVE_READS) === 'true',
} as const;

/** True when we have no Supabase project wired up (or demo mode is forced). */
export function isDemoMode(): boolean {
  if (env.demoModeForced()) return true;
  return !(env.supabaseUrl() && env.supabaseAnonKey());
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
