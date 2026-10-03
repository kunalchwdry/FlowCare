/**
 * Intent extraction pipeline:
 *   user query -> LLM (optional) -> JSON -> Zod allowlist -> filters
 * with a deterministic parser as both a fallback and a safety net.
 *
 * The model can ONLY return filter values from a fixed vocabulary. It cannot
 * name a hospital, emit SQL, choose a sort order, or set pagination. Any
 * deviation causes the whole LLM result to be discarded.
 */
import { AiFilterSchema, type AiFilters } from '@/lib/discovery/filters';
import { parseQueryDeterministic, type FallbackParse } from './fallback';
import type { LlmProvider, ProviderCredentials } from './providers';
import { FLOWCARE_SEARCH_SYSTEM_PROMPT } from './prompts';

/** Kept as a named export for existing callers and tests. */
export const INTENT_SYSTEM_PROMPT = FLOWCARE_SEARCH_SYSTEM_PROMPT;

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}


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
    /** Recent turns from the current browser session only. */
    history?: ConversationMessage[];
    /** Server-managed credentials; never supplied by the browser. */
    credentials?: ProviderCredentials;
  },
): Promise<IntentResult> {
  const trimmed = (query ?? '').slice(0, opts.maxChars);
  const deterministic: FallbackParse = parseQueryDeterministic(trimmed);
  const context = (opts.history ?? [])
    .slice(-8)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'FlowCare'}: ${turn.content.slice(0, 800)}`)
    .join('\n');
  const modelInput = context
    ? `Conversation context from this browser session:\n${context}\n\nLatest user request:\n${trimmed}`
    : trimmed;

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
        user: modelInput,
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
