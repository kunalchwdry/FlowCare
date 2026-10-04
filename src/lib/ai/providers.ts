/**
 * Provider-agnostic LLM access.
 *
 * Rules:
 *  - Keys are read server-side only; the browser only ever learns a provider's
 *    id, label and whether it is configured.
 *  - Every provider implements the same `completeJson` contract, so the AI is
 *    replaceable and the app is not coupled to one vendor.
 *  - Nothing clinical is ever sent: the prompt contains the user's discovery
 *    phrase and a static schema, and nothing else.
 */
import 'server-only';
import { env } from '@/lib/env';

export interface ProviderInfo {
  id: string;
  label: string;
  /** Marketing-free description shown in the UI picker. */
  note: string;
  configured: boolean;
  model: string;
  /** Known-good model ids for this provider, for the settings picker. */
  models: string[];
}

/**
 * Model ids offered in the settings picker, per provider.
 *
 * This exists because the field used to be free text and a single mistyped
 * id ("llma" for "llama-3.3-70b-versatile") is accepted silently at save
 * time and then fails on every call, with the provider's own error — which
 * reads like a broken key rather than a typo.
 *
 * The list is deliberately short and conservative. It is not a catalogue:
 * providers add and retire models constantly, so a custom entry stays
 * available for anything not listed here.
 */
export const MODEL_CHOICES: Record<string, string[]> = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ],
  nvidia: ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-8b-instruct', 'mistralai/mixtral-8x7b-instruct-v0.1'],
  openrouter: [
    'meta-llama/llama-3.3-70b-instruct',
    'google/gemini-2.0-flash-001',
    'openai/gpt-4o-mini',
    'mistralai/mistral-small',
  ],
  together: [
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    'mistralai/Mixtral-8x7B-Instruct-v0.1',
  ],
  mistral: ['mistral-small-latest', 'mistral-large-latest', 'open-mistral-nemo'],
};

export interface ProviderCredentials {
  /** A user-supplied key, already decrypted server-side. Never logged. */
  apiKey: string;
  /** Optional model override chosen by the key's owner. */
  model?: string;
}

export interface CompleteArgs {
  system: string;
  user: string;
  timeoutMs: number;
  maxOutputTokens?: number;
  /**
   * Bring-your-own-key. When present this takes precedence over the server's
   * own environment key, so a user spends their own quota rather than ours.
   */
  credentials?: ProviderCredentials;
}

export interface LlmProvider {
  id: string;
  label: string;
  note: string;
  model(): string;
  isConfigured(): boolean;
  completeJson(args: CompleteArgs): Promise<string>;
}

const s = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      // Log status only. Never log the prompt or the provider's body.
      throw new Error(`provider_http_${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Any OpenAI-compatible /chat/completions endpoint. */
function openAiCompatible(cfg: {
  id: string; label: string; note: string; baseUrl: string;
  keyEnv: () => string | undefined; modelEnv: () => string | undefined; defaultModel: string;
  extraHeaders?: () => Record<string, string>;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
}): LlmProvider {
  return {
    id: cfg.id,
    label: cfg.label,
    note: cfg.note,
    model: () => cfg.modelEnv() ?? cfg.defaultModel,
    isConfigured: () => Boolean(cfg.keyEnv()),
    async completeJson({ system, user, timeoutMs, maxOutputTokens = 400, credentials }) {
      const key = credentials?.apiKey ?? cfg.keyEnv();
      if (!key) throw new Error('provider_not_configured');
      const json = await postJson(
        `${cfg.baseUrl}/chat/completions`,
        { Authorization: `Bearer ${key}`, ...(cfg.extraHeaders?.() ?? {}) },
        {
          model: credentials?.model ?? cfg.modelEnv() ?? cfg.defaultModel,
          temperature: 0,
          [cfg.maxTokensField ?? 'max_tokens']: maxOutputTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
        timeoutMs,
      );
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('provider_bad_shape');
      return text;
    },
  };
}

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** Gemini 2.0 and 1.5 model ids are retired; do not let a stale deployment
 * setting silently take every assistant request down. */
function geminiModel(): string {
  const configured = s(process.env.GEMINI_MODEL);
  if (!configured || /^gemini-(?:1\.5|2\.0)-/i.test(configured)) return DEFAULT_GEMINI_MODEL;
  return configured;
}

const gemini: LlmProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  note: 'Google AI Studio API',
  model: geminiModel,
  isConfigured: () => Boolean(s(process.env.GEMINI_API_KEY)),
  async completeJson({ system, user, timeoutMs, maxOutputTokens = 400, credentials }) {
    const key = credentials?.apiKey ?? s(process.env.GEMINI_API_KEY);
    if (!key) throw new Error('provider_not_configured');
    const model = credentials?.model ?? geminiModel();
    const json = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': key },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens,
          responseMimeType: 'application/json',
        },
      },
      timeoutMs,
    );
    const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
    if (typeof text !== 'string' || !text) throw new Error('provider_bad_shape');
    return text;
  },
};

export const PROVIDERS: LlmProvider[] = [
  gemini,
  openAiCompatible({
    id: 'openai', label: 'OpenAI', note: 'api.openai.com',
    baseUrl: s(process.env.OPENAI_BASE_URL) ?? 'https://api.openai.com/v1',
    keyEnv: () => s(process.env.OPENAI_API_KEY),
    modelEnv: () => s(process.env.OPENAI_MODEL), defaultModel: 'gpt-4o-mini',
  }),
  openAiCompatible({
    id: 'groq', label: 'Groq', note: 'Low-latency OpenAI-compatible endpoint',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: () => s(process.env.GROQ_API_KEY),
    modelEnv: () => s(process.env.GROQ_MODEL), defaultModel: 'llama-3.3-70b-versatile',
    maxTokensField: 'max_completion_tokens',
  }),
  openAiCompatible({
    id: 'nvidia', label: 'NVIDIA NIM', note: 'integrate.api.nvidia.com',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyEnv: () => s(process.env.NVIDIA_API_KEY),
    modelEnv: () => s(process.env.NVIDIA_MODEL), defaultModel: 'meta/llama-3.3-70b-instruct',
  }),
  openAiCompatible({
    id: 'openrouter', label: 'OpenRouter', note: 'Multi-model router',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: () => s(process.env.OPENROUTER_API_KEY),
    modelEnv: () => s(process.env.OPENROUTER_MODEL), defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    extraHeaders: () => ({ 'X-Title': 'FlowCare Hospital Assistant' }),
  }),
  openAiCompatible({
    id: 'together', label: 'Together AI', note: 'api.together.xyz',
    baseUrl: 'https://api.together.xyz/v1',
    keyEnv: () => s(process.env.TOGETHER_API_KEY),
    modelEnv: () => s(process.env.TOGETHER_MODEL), defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  }),
  openAiCompatible({
    id: 'mistral', label: 'Mistral', note: 'api.mistral.ai',
    baseUrl: 'https://api.mistral.ai/v1',
    keyEnv: () => s(process.env.MISTRAL_API_KEY),
    modelEnv: () => s(process.env.MISTRAL_MODEL), defaultModel: 'mistral-small-latest',
  }),
];

export function listProviders(): ProviderInfo[] {
  return PROVIDERS.map((p) => {
    const listed = MODEL_CHOICES[p.id] ?? [];
    const current = p.model();
    // The configured default has to be selectable even when it is not one
    // of the curated ids — otherwise opening the picker would silently
    // change a deliberately-set model.
    const models = listed.includes(current) ? listed : [current, ...listed];
    return {
      id: p.id, label: p.label, note: p.note,
      configured: p.isConfigured(), model: current, models,
    };
  });
}

export function getProvider(id?: string | null): LlmProvider | null {
  const wanted = id ?? env.aiDefaultProvider();
  const exact = PROVIDERS.find((p) => p.id === wanted);
  // The application-managed provider is an explicit deployment choice. Do
  // not silently fall back to Gemini (or another provider) after migration.
  return exact?.isConfigured() ? exact : null;
}

/**
 * The adapter for a provider REGARDLESS of whether the server has a key for
 * it. Needed for bring-your-own-key: the user supplies the credential, so
 * "the server has no key" is not a reason to refuse.
 *
 * Callers MUST pass `credentials` to completeJson, or the call will fail with
 * provider_not_configured.
 */
export function getProviderById(id: string): LlmProvider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

export function anyProviderConfigured(): boolean {
  return Boolean(getProvider());
}
