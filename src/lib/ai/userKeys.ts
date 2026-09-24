import 'server-only';
import { decryptSecret, encryptSecret, keyHint, looksLikeKey, vaultAvailable } from '@/lib/crypto/keyvault';
import { getProviderById, listProviders, type ProviderCredentials } from '@/lib/ai/providers';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Bring-your-own-key resolution.
 *
 * Precedence, highest first:
 *   1. the signed-in user's own stored key   -> they spend their own quota
 *   2. the server's environment key          -> operator-funded fallback
 *   3. nothing                               -> deterministic parser, no LLM
 *
 * Plaintext never leaves this module except as an Authorization header inside
 * the provider adapter. It is never returned to a route handler, never logged,
 * never serialised into a response, and never put in a prompt.
 */

export const SUPPORTED_PROVIDERS = [
  'gemini', 'openai', 'groq', 'nvidia', 'openrouter', 'together', 'mistral',
] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export function isSupportedProvider(v: string): v is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(v);
}

export interface StoredKeyView {
  provider: string;
  label: string | null;
  model: string | null;
  /** Display only, e.g. "••••••••4f2a". The key itself is never sent out. */
  masked: string;
  status: 'unvalidated' | 'valid' | 'invalid';
  lastError: string | null;
  lastValidatedAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
}

/** Masked metadata for the settings screen. Contains no key material. */
export async function listUserKeys(): Promise<StoredKeyView[]> {
  const sb = await getSupabaseServerClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('user_ai_keys')
    .select('provider,label,model,key_hint,status,last_error,last_validated_at,last_used_at,use_count');
  if (error || !data) return [];
  return data.map((r) => ({
    provider: r.provider as string,
    label: (r.label as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    masked: `${'•'.repeat(8)}${r.key_hint as string}`,
    status: r.status as StoredKeyView['status'],
    lastError: (r.last_error as string | null) ?? null,
    lastValidatedAt: (r.last_validated_at as string | null) ?? null,
    lastUsedAt: (r.last_used_at as string | null) ?? null,
    useCount: Number(r.use_count ?? 0),
  }));
}

export type SaveResult =
  | { ok: true; view: StoredKeyView }
  | { ok: false; status: number; message: string };

export async function saveUserKey(args: {
  provider: string;
  apiKey: string;
  label?: string | null;
  model?: string | null;
}): Promise<SaveResult> {
  if (!isSupportedProvider(args.provider)) {
    return { ok: false, status: 400, message: 'Unknown provider.' };
  }
  if (!vaultAvailable()) {
    return {
      ok: false,
      status: 503,
      message:
        'This server cannot store keys because FLOWCARE_KEY_ENCRYPTION_SECRET is not configured. ' +
        'You can still use a key for this session only.',
    };
  }
  const shape = looksLikeKey(args.provider, args.apiKey);
  if (!shape.ok) return { ok: false, status: 400, message: shape.reason };

  const sb = await getSupabaseServerClient();
  if (!sb) return { ok: false, status: 401, message: 'Sign in to save a key.' };

  const { error } = await sb.rpc('save_ai_key', {
    p_provider: args.provider,
    p_ciphertext: encryptSecret(args.apiKey),
    p_hint: keyHint(args.apiKey),
    p_label: args.label ?? null,
    p_model: args.model ?? null,
  });
  if (error) return { ok: false, status: 400, message: cleanDbError(error.message) };

  const all = await listUserKeys();
  const view = all.find((k) => k.provider === args.provider);
  return view
    ? { ok: true, view }
    : { ok: false, status: 500, message: 'Saved, but could not read it back.' };
}

export async function deleteUserKey(provider: string): Promise<{ ok: boolean; message?: string }> {
  const sb = await getSupabaseServerClient();
  if (!sb) return { ok: false, message: 'Sign in first.' };
  const { error } = await sb.rpc('delete_ai_key', { p_provider: provider });
  if (error) return { ok: false, message: cleanDbError(error.message) };
  return { ok: true };
}

/**
 * Decrypt the caller's key for one call. Returns null when they have none.
 * The caller must not store, log or return the result.
 */
async function loadUserCredentials(provider: string): Promise<ProviderCredentials | null> {
  if (!vaultAvailable()) return null;
  const sb = await getSupabaseServerClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from('user_ai_keys')
    .select('ciphertext,model,status')
    .eq('provider', provider)
    .maybeSingle();
  if (error || !data?.ciphertext) return null;
  try {
    return {
      apiKey: decryptSecret(data.ciphertext as string),
      model: (data.model as string | null) ?? undefined,
    };
  } catch {
    // Wrong master key, or a tampered row. Fail closed and say nothing
    // specific: a decryption oracle is not a feature.
    return null;
  }
}

export interface ResolvedProvider {
  providerId: string;
  /** Who is paying for this call. */
  source: 'user' | 'server' | 'none';
  credentials?: ProviderCredentials;
}

/**
 * Decide which provider to use and whose key pays for it.
 * `requested` may be null, in which case we prefer any key the user has
 * stored before falling back to the server default.
 */
export async function resolveProvider(requested: string | null): Promise<ResolvedProvider> {
  const known = listProviders();

  if (requested) {
    if (!known.some((p) => p.id === requested)) {
      return { providerId: requested, source: 'none' };
    }
    const creds = await loadUserCredentials(requested);
    if (creds) return { providerId: requested, source: 'user', credentials: creds };
    const p = getProviderById(requested);
    return { providerId: requested, source: p?.isConfigured() ? 'server' : 'none' };
  }

  // No explicit choice: a stored user key wins over the operator's key.
  const stored = await listUserKeys();
  const usable = stored.find((k) => k.status !== 'invalid');
  if (usable) {
    const creds = await loadUserCredentials(usable.provider);
    if (creds) return { providerId: usable.provider, source: 'user', credentials: creds };
  }

  const serverConfigured = known.find((p) => p.configured);
  return serverConfigured
    ? { providerId: serverConfigured.id, source: 'server' }
    : { providerId: known[0]?.id ?? 'gemini', source: 'none' };
}

/** Best-effort usage counter. Never blocks or fails a request. */
export async function touchUserKey(provider: string): Promise<void> {
  try {
    const sb = await getSupabaseServerClient();
    await sb?.rpc('touch_ai_key', { p_provider: provider });
  } catch {
    /* usage accounting must never break the feature */
  }
}

/**
 * Validate a key by making a REAL, minimal call to the provider.
 *
 * We never mark a key "valid" on shape alone — the whole point of the button
 * is to answer "does this actually work", and only the provider can answer
 * that. The stored status is updated from the result.
 */
export async function validateUserKey(
  provider: string,
  timeoutMs: number,
): Promise<{ ok: boolean; message: string; detail?: string }> {
  const p = getProviderById(provider);
  if (!p) return { ok: false, message: 'Unknown provider.' };

  const creds = await loadUserCredentials(provider);
  if (!creds) return { ok: false, message: 'No saved key for that provider.' };

  const sb = await getSupabaseServerClient();
  try {
    const raw = await p.completeJson({
      system: 'You are a connectivity check. Reply with compact JSON only.',
      user: 'Reply with exactly {"ok":true} and nothing else.',
      timeoutMs,
      maxOutputTokens: 20,
      credentials: creds,
    });
    // A parseable response proves auth, quota and model access all work.
    const parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>;
    const ok = parsed && typeof parsed === 'object';
    await sb?.rpc('mark_ai_key', { p_provider: provider, p_ok: ok, p_error: null });
    return ok
      ? { ok: true, message: `Key works. ${p.label} responded using ${creds.model ?? p.model()}.` }
      : { ok: false, message: 'The provider replied in an unexpected format.' };
  } catch (e) {
    const reason = friendlyProviderError(e);
    await sb?.rpc('mark_ai_key', { p_provider: provider, p_ok: false, p_error: reason });
    return { ok: false, message: reason };
  }
}

/** Providers sometimes wrap JSON in prose or fences. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/**
 * Turn a provider failure into something a user can act on, WITHOUT leaking
 * the key, the prompt, or the provider's raw body.
 */
export function friendlyProviderError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(msg)) return 'The provider did not respond in time.';
  if (/provider_http_401|provider_http_403/.test(msg)) {
    return 'The provider rejected this key (401/403). Check that it is active and has the right permissions.';
  }
  if (/provider_http_429/.test(msg)) {
    return 'The provider says you are out of quota or rate limited (429).';
  }
  if (/provider_http_404/.test(msg)) {
    return 'The provider does not recognise that model (404). Try a different model name.';
  }
  if (/provider_http_(5\d\d)/.test(msg)) return 'The provider had a server error. Try again shortly.';
  if (/provider_bad_shape/.test(msg)) return 'The provider replied in an unexpected format.';
  if (/provider_not_configured/.test(msg)) return 'No key is configured for that provider.';
  return 'Could not reach the provider.';
}

function cleanDbError(message: string): string {
  const m = message.match(/(?:INVALID_INPUT|NOT_FOUND|LIMIT_REACHED|AUTH_REQUIRED):\s*(.*)/);
  if (m) return m[1];
  if (/AUTH_REQUIRED/.test(message)) return 'Sign in to continue.';
  return 'Could not save that key.';
}
