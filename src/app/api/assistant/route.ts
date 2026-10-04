import { NextRequest } from 'next/server';
import { z } from 'zod';
import { EMERGENCY_NOTICE, SCOPE_NOTICE } from '@/lib/ai/notices';
import { getRepo } from '@/lib/data';
import { extractIntent } from '@/lib/ai/intent';
import { getProvider } from '@/lib/ai/providers';
import { DiscoveryFiltersSchema, type DiscoveryFilters } from '@/lib/discovery/filters';
import { searchHospitals } from '@/lib/discovery/search';
import { makeExternalFetcher } from '@/lib/places/enrich';
import { buildEvidence } from '@/lib/ai/evidence';
import { anchorForCity } from '@/lib/discovery/geo';
import { env } from '@/lib/env';
import { track } from '@/lib/analytics';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  query: z.string().min(1).max(400),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(1200),
  }).strict()).max(12).default([]),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullish(),
  page: z.number().int().min(1).max(50).optional(),
}).strict();

const IMMEDIATE_HELP_QUERY = /\b(snake\s*bite|snake has bitten|poison(?:ed|ing)?|anaphylaxis|severe allergic reaction|unconscious|can't breathe|cannot breathe|severe bleeding|heart attack|stroke|overdose|suicid(?:e|al)|self[- ]harm)\b/i;
const EMOTIONAL_SUPPORT_QUERY = /\b(i(?:'m| am)\s+(?:feeling\s+)?(?:sad|depressed|anxious|lonely|hopeless)|feeling\s+(?:sad|low|hopeless|unsafe)|want\s+to\s+die|hurt myself|self[- ]harm)\b/i;
const EMOTIONAL_SUPPORT_NOTICE = 'If you might hurt yourself or are in immediate danger, call 112 in India or go to the nearest emergency department now. If you are safe right now, FlowCare can help you find a mental-health professional, but it cannot provide crisis counselling.';

export async function POST(req: NextRequest) {
  try {
    const body = Body.parse(await readJson(req, 12000));

    const rl = rateLimit(`assistant:${clientKey(req)}`, env.aiRateLimitPerMin());
    if (!rl.allowed) {
      return fail(429, 'You have made a lot of assistant requests. Please wait a minute, or use the filters on /hospitals.', {
        retryInMs: rl.resetInMs,
      });
    }

    // Greetings should receive a conversational response instead of being
    // treated as a hospital keyword search. This stays server-side so every
    // assistant request still uses the same backend contract and rate limit.
    if (/^(hi+|hey|hello+|hie|namaste|good\s+(morning|afternoon|evening))[!.?,\s]*$/i.test(body.query.trim())) {
      return ok({
        reply: 'Hi! I can help you find and compare hospitals, departments, accessibility options, and available appointments. What are you looking for?',
        understood: {
          filters: {},
          explanation: [],
          source: 'deterministic',
          provider: null,
          model: null,
          latencyMs: null,
        },
        aiUnavailableReason: null,
        safetyNotice: null,
        scopeNotice: SCOPE_NOTICE,
        locationNotice: null,
        results: [],
        total: 0,
        emptyReason: null,
        computedAt: new Date().toISOString(),
      });
    }

    const normalizedQuery = body.query.trim().toLowerCase().replace(/loacation/g, 'location').replace(/\s+/g, ' ');

    // High-risk phrases must not be treated as ordinary directory searches.
    // This branch is deterministic so it still works when the LLM key is
    // missing, expired, or unavailable on a Vercel preview deployment.
    if (IMMEDIATE_HELP_QUERY.test(normalizedQuery)) {
      return ok({
        reply: 'This may need urgent medical attention. Call 112 in India or go to the nearest emergency department now. Do not wait for FlowCare to find a routine appointment.',
        understood: { filters: {}, explanation: [], source: 'deterministic', provider: null, model: null, latencyMs: null },
        aiUnavailableReason: null,
        safetyNotice: EMERGENCY_NOTICE,
        scopeNotice: SCOPE_NOTICE,
        locationNotice: null,
        results: [], total: 0, emptyReason: null, computedAt: new Date().toISOString(),
      });
    }

    if (EMOTIONAL_SUPPORT_QUERY.test(normalizedQuery)) {
      return ok({
        reply: 'I\'m sorry you\'re feeling this way. If you are safe right now, I can help you find a mental-health professional or psychiatry department. If you might hurt yourself or are in immediate danger, call 112 or go to the nearest emergency department now.',
        understood: { filters: {}, explanation: [], source: 'deterministic', provider: null, model: null, latencyMs: null },
        aiUnavailableReason: null,
        safetyNotice: EMOTIONAL_SUPPORT_NOTICE,
        scopeNotice: SCOPE_NOTICE,
        locationNotice: null,
        results: [], total: 0, emptyReason: null, computedAt: new Date().toISOString(),
      });
    }

    if (
      /\bwhere\s+am\s+i\b/i.test(normalizedQuery)
      || /\bwhat(?:'s| is)\s+my\s+(?:current\s+)?location\b/i.test(normalizedQuery)
      || /\b(can\s+you|can\s+u)\s+(?:tell|show)\s+(?:me\s+)?(?:my\s+)?(?:current\s+)?location\b/i.test(normalizedQuery)
      || /\bmy\s+(?:current\s+)?location\b/i.test(normalizedQuery)
    ) {
      const hasLocation = Boolean(body.location);
      return ok({
        reply: hasLocation
          ? 'Your device location is available to FlowCare for nearby-hospital searches. For privacy, I do not display your exact coordinates or street address here.'
          : 'I do not have your device location yet. Tap Use my location below, allow browser access, and ask me again. You can also search by city or area.',
        understood: {
          filters: {},
          explanation: [],
          source: 'deterministic',
          provider: null,
          model: null,
          latencyMs: null,
        },
        aiUnavailableReason: null,
        safetyNotice: null,
        scopeNotice: SCOPE_NOTICE,
        locationNotice: hasLocation ? 'Location access is on for this chat session.' : null,
        results: [],
        total: 0,
        emptyReason: null,
        computedAt: new Date().toISOString(),
      });
    }

    // One application-owned provider. The browser cannot select a vendor or
    // supply a credential; changing providers later is a server-only change.
    const provider = getProvider('gemini');

    const intent = await extractIntent(body.query, {
      provider,
      timeoutMs: env.aiTimeoutMs(),
      maxChars: env.aiMaxInputChars(),
      history: body.history,
    });

    // --- Map validated AI filters onto the discovery filter schema ---------
    const { useUserLocation, preference, ...rest } = intent.filters;
    const draft: Record<string, unknown> = { ...rest };
    if (useUserLocation && body.location) {
      draft.near = body.location;
      draft.radiusKm = intent.filters.radiusKm ?? 10;
    } else if (useUserLocation && !body.location) {
      const anchor = anchorForCity(intent.filters.city);
      if (anchor) { draft.near = anchor; draft.radiusKm = intent.filters.radiusKm ?? 10; }
    }
    draft.page = body.page ?? 1;
    draft.pageSize = 8;
    draft.sort = 'relevance';

    const filters: DiscoveryFilters = DiscoveryFiltersSchema.parse(draft);

    const repo = await getRepo();
    const outcome = await searchHospitals(filters, {
      repo,
      fetchExternal: makeExternalFetcher(),
      preference,
    });

    track('assistant_query', req.headers.get('x-flowcare-session') ?? 'anon', {
      provider: intent.provider ?? 'none',
      source: intent.source,
      result_count: outcome.total,
      query_length: body.query.length,
      used_location: Boolean(draft.near),
    });

    const locationNotice =
      useUserLocation && !body.location && !draft.near
        ? 'You asked for hospitals near you but location access is not available. Showing results without a distance filter — you can search by city or area instead.'
        : null;

    const reply = outcome.total > 0
      ? `I found ${outcome.total} hospital${outcome.total === 1 ? '' : 's'} matching your request. Review the verified details below.`
      : 'I could not find a matching hospital with the information available. Try a broader department, city, or availability request.';

    return ok({
      // Everything below is derived from retrieved data, never model prose.
      reply,
      understood: {
        filters,
        explanation: intent.notes,
        source: intent.source,
        provider: intent.provider,
        model: intent.model,
        latencyMs: intent.latencyMs,
      },
      aiUnavailableReason: intent.aiUnavailableReason,
      safetyNotice: intent.emergencySignal ? EMERGENCY_NOTICE : null,
      scopeNotice: SCOPE_NOTICE,
      locationNotice,
      results: outcome.results.map((r) => ({ ...r, evidence: buildEvidence(r, filters) })),
      total: outcome.total,
      emptyReason: outcome.emptyReason,
      computedAt: outcome.computedAt,
    });
  } catch (e) {
    return handleError(e);
  }
}
