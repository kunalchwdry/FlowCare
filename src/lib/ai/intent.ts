/**
 * Intent extraction pipeline:
 *   user query -> LLM (optional) -> JSON -> Zod allowlist -> filters
 * with a deterministic parser as both a fallback and a safety net.
 *
 * The model can ONLY return filter values from a fixed vocabulary. It cannot
 * name a hospital, emit SQL, choose a sort order, or set pagination. Any
 * deviation causes the whole LLM result to be discarded.
 */
import { AiFilterSchema, SPECIALTIES, SERVICES, HOSPITAL_TYPES, ACCESSIBILITY_FEATURES, LANGUAGES, type AiFilters } from '@/lib/discovery/filters';
import { parseQueryDeterministic, type FallbackParse } from './fallback';
import type { LlmProvider, ProviderCredentials } from './providers';

export const INTENT_SYSTEM_PROMPT = `You convert a patient's hospital-search phrase into a JSON filter object for a hospital DIRECTORY.

You are a directory search assistant. You must NOT diagnose, must NOT suggest treatment, must NOT assess urgency or severity, and must NOT name any hospital, doctor, brand or place. You only translate the phrase into filters.

Return ONLY a JSON object with any subset of these keys:
- "specialties": array of ${JSON.stringify(SPECIALTIES)}
- "services": array of ${JSON.stringify(SERVICES)}
- "hospitalTypes": array of ${JSON.stringify(HOSPITAL_TYPES)}
- "accessibility": array of ${JSON.stringify(ACCESSIBILITY_FEATURES)}
- "languages": array of ${JSON.stringify(LANGUAGES)}
- "city": string (city name only, e.g. "Pune")
- "area": string (locality within a city)
- "useUserLocation": boolean (true only if the phrase says near me / nearby / close to me)
- "radiusKm": number 1-100
- "availability": array of ["available","limited","none","unknown"]
- "availableWithinDays": integer 1-60 (today=1, tomorrow=2, this week=7)
- "minFlowcareRating": number 1-5
- "minGoogleRating": number 1-5
- "minReviewCount": integer
- "openNow": boolean
- "emergencyServices": boolean
- "preference": { "prioritise": array of ["distance","rating","availability","review_count","accessibility","language"] }

Rules:
- Map lay words to the closest listed specialty (heart -> cardiology, skin -> dermatology).
- Never invent coordinates. Express "near me" only with useUserLocation.
- Omit any key you are not confident about. An empty object {} is a valid answer.
- Output raw JSON only, no prose, no markdown fences.`;

export type IntentSource = 'llm' | 'deterministic' | 'llm_rejected_fallback';

export interface IntentResult {
  filters: AiFilters;
  source: IntentSource;
  provider: string | null;
  model: string | null;
  notes: string[];
  emergencySignal: boolean;
  /** Present when the LLM was attempted and failed. Shown verbatim in the UI. */
  aiUnavailableReason: string | null;
  latencyMs: number | null;
}

/** Rejects with 'provider_timeout' if `p` has not settled within `ms`. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('provider_timeout')), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
}

/** Merge LLM output over the deterministic baseline without letting it delete facts. */
function mergeFilters(base: AiFilters, llm: AiFilters): AiFilters {
  const merged: AiFilters = { ...base };
  for (const [k, v] of Object.entries(llm)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (merged as Record<string, unknown>)[k] = v;
  }
  return merged;
}

export async function extractIntent(
  query: string,
  opts: {
    provider: LlmProvider | null;
    timeoutMs: number;
    maxChars: number;
    /** Bring-your-own-key credentials; when present the user pays, not us. */
    credentials?: ProviderCredentials;
  },
): Promise<IntentResult> {
  const trimmed = (query ?? '').slice(0, opts.maxChars);
  const deterministic: FallbackParse = parseQueryDeterministic(trimmed);

  if (!opts.provider) {
    return {
      filters: deterministic.filters,
      source: 'deterministic',
      provider: null,
      model: null,
      notes: deterministic.notes,
      emergencySignal: deterministic.emergencySignal,
      aiUnavailableReason: null,
      latencyMs: null,
    };
  }

  const started = Date.now();
  try {
    // The provider aborts its own fetch on timeout, but we never trust a
    // provider to keep that promise: a hung adapter must not be able to hold a
    // request open. A hard wall-clock race here bounds the whole call, with a
    // small grace margin so the provider's own abort wins when it works.
    const raw = await withDeadline(
      opts.provider.completeJson({
        credentials: opts.credentials,
        system: INTENT_SYSTEM_PROMPT,
        user: trimmed,
        timeoutMs: opts.timeoutMs,
        maxOutputTokens: 400,
      }),
      opts.timeoutMs + 250,
    );
    const latencyMs = Date.now() - started;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stripFences(raw));
    } catch {
      return rejected(deterministic, opts.provider, 'The assistant returned a response we could not read.');
    }

    const validated = AiFilterSchema.safeParse(parsedJson);
    if (!validated.success) {
      // Strict-mode rejection is expected when a model invents a key; fall back.
      return rejected(deterministic, opts.provider, 'The assistant proposed filters outside the allowed set, so FlowCare used its own parser instead.');
    }

    const filters = mergeFilters(deterministic.filters, validated.data);
    const notes = [...deterministic.notes];
    return {
      filters,
      source: 'llm',
      provider: opts.provider.id,
      model: opts.provider.model(),
      notes,
      emergencySignal: deterministic.emergencySignal,
      aiUnavailableReason: null,
      latencyMs,
    };
  } catch (e) {
    const code = e instanceof Error ? e.message : 'provider_error';
    const reason =
      code === 'provider_not_configured' ? 'AI assistance is temporarily unavailable. You can still search hospitals using filters.'
      : code.startsWith('provider_http_429') ? 'The AI provider is rate-limiting requests. FlowCare used its own parser instead.'
      : code.includes('AbortError') || code === 'provider_timeout' ? 'The AI provider timed out. FlowCare used its own parser instead.'
      : 'AI assistance is temporarily unavailable. You can still search hospitals using filters.';
    return rejected(deterministic, opts.provider, reason);
  }
}

function rejected(d: FallbackParse, provider: LlmProvider, reason: string): IntentResult {
  return {
    filters: d.filters,
    source: 'llm_rejected_fallback',
    provider: provider.id,
    model: provider.model(),
    notes: d.notes,
    emergencySignal: d.emergencySignal,
    aiUnavailableReason: reason,
    latencyMs: null,
  };
}
