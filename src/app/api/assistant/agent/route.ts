import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  AGENT_BOOKING_NOTICES, AGENT_SYSTEM_PROMPT, AGENT_VERSION, AgentIntentSchema,
  buildBookingSummary, emergencyBlock, resolveCareNeed,
  type AgentCandidate, type AgentSlot, type AgentTurn,
} from '@/lib/ai/agent';
import { getProviderById } from '@/lib/ai/providers';
import { resolveProvider, touchUserKey, friendlyProviderError } from '@/lib/ai/userKeys';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    message: z.string().min(1).max(400),
    provider: z.string().max(40).nullish(),
    /** Set once the user has picked a hospital from the candidate list. */
    hospitalId: z.string().uuid().nullish(),
    /** Set once the user has picked a slot; triggers proposal creation. */
    slotId: z.string().uuid().nullish(),
    patientName: z.string().min(1).max(80).nullish(),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`agent:${clientKey(req)}`, env.aiRateLimitPerMin());
    if (!rl.allowed) {
      return fail(429, 'You have made a lot of assistant requests. Please wait a minute.', {
        retryInMs: rl.resetInMs,
      });
    }

    const body = Body.parse(await readJson(req, 4000));

    // Hard stop before anything else runs.
    const blocked = emergencyBlock(body.message);
    if (blocked) return ok(blocked);

    const sb = await getSupabaseServerClient();
    if (!sb) return fail(503, 'Booking through the assistant needs Supabase configured.');
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) {
      return fail(401, 'Sign in so the assistant can book on your behalf.');
    }

    // ---- who pays for the model call -------------------------------------
    const resolved = await resolveProvider(body.provider ?? null);
    const provider = getProviderById(resolved.providerId);
    const usable = provider && (resolved.source === 'user' || resolved.source === 'server');

    // ---- step 1: understand the request ----------------------------------
    let intent: z.infer<typeof AgentIntentSchema> = { careNeed: body.message };
    let aiSource = 'deterministic';
    let unavailable: string | null = null;

    if (usable) {
      try {
        const raw = await provider!.completeJson({
          system: AGENT_SYSTEM_PROMPT,
          user: body.message,
          timeoutMs: env.aiTimeoutMs(),
          maxOutputTokens: 200,
          credentials: resolved.credentials,
        });
        const parsed = AgentIntentSchema.safeParse(JSON.parse(stripFences(raw)));
        if (parsed.success) {
          intent = parsed.data;
          aiSource = 'llm';
          if (resolved.source === 'user') await touchUserKey(resolved.providerId);
        } else {
          // The model produced something outside the allowlist. Drop it
          // entirely rather than partially trusting it.
          unavailable = 'The assistant returned an unexpected shape, so FlowCare used its own parser.';
        }
      } catch (e) {
        unavailable = friendlyProviderError(e);
      }
    }

    const aiMeta = {
      provider: usable ? resolved.providerId : null,
      model: usable ? (resolved.credentials?.model ?? provider!.model()) : null,
      source: aiSource,
      keySource: resolved.source,
      unavailableReason: unavailable,
    } as const;

    // ---- care need -> departments, via FlowCare's closed vocabulary -------
    const need = resolveCareNeed(intent.careNeed ?? body.message);
    if (need.departments.length === 0) {
      return ok({
        version: AGENT_VERSION,
        step: 'clarify',
        message:
          'I could not tell which department you need. Try naming the body part or the service, ' +
          'for example "knee pain", "dialysis" or "eye checkup".',
        notices: [],
        ai: aiMeta,
      } satisfies AgentTurn);
    }

    const slugs: string[] = need.departments.map((d: { slug: string }) => d.slug);

    // ---- step 3: user picked a slot -> build the proposal SERVER-SIDE ----
    if (body.slotId && body.hospitalId) {
      const { data: slot, error: slotErr } = await sb
        .from('slots')
        .select('id,starts_at,ends_at,kind,booking_open,departments!inner(id,name,hospital_id,booking_open,hospitals!inner(id,name,timezone))')
        .eq('id', body.slotId)
        .maybeSingle();

      if (slotErr || !slot) return fail(404, 'That time is no longer listed. Please pick another.');

      const dept = slot.departments as unknown as {
        id: string; name: string; hospital_id: string; booking_open: boolean;
        hospitals: { id: string; name: string; timezone: string };
      };
      if (dept.hospital_id !== body.hospitalId) {
        return fail(400, 'That time does not belong to the hospital you chose.');
      }
      if (!slot.booking_open || !dept.booking_open) {
        return fail(409, 'Booking is closed for that time.');
      }

      const patientName =
        body.patientName?.trim() ||
        intent.forDependentName?.trim() ||
        (auth.user.user_metadata?.full_name as string) ||
        auth.user.email ||
        'Patient';

      // The payload the human approves. Built here, from validated rows.
      const payload = {
        slotId: slot.id,
        hospitalId: dept.hospitals.id,
        hospitalName: dept.hospitals.name,
        departmentId: dept.id,
        departmentName: dept.name,
        startsAt: slot.starts_at,
        endsAt: slot.ends_at,
        patientName,
        agentVersion: AGENT_VERSION,
      };

      const summary = buildBookingSummary({
        hospitalName: dept.hospitals.name,
        departmentName: dept.name,
        startsAt: slot.starts_at as string,
        patientName,
        timezone: dept.hospitals.timezone,
      });

      const { data: proposal, error: propErr } = await sb.rpc('create_agent_proposal', {
        p_kind: 'book_appointment',
        p_payload: payload,
        p_summary: summary,
        p_ttl_seconds: 600,
      });
      if (propErr) return fail(400, cleanErr(propErr.message));

      const row = Array.isArray(proposal) ? proposal[0] : proposal;
      return ok({
        version: AGENT_VERSION,
        step: 'confirm',
        message: 'Here is exactly what I will send. Nothing has been booked yet.',
        notices: AGENT_BOOKING_NOTICES,
        careNeed: need,
        proposal: {
          id: row.id, summary: row.summary, expiresAt: row.expires_at, payload,
        },
        ai: aiMeta,
      } satisfies AgentTurn);
    }

    // ---- step 2: user picked a hospital -> list real slots ---------------
    if (body.hospitalId) {
      const { data: rows } = await sb
        .from('slots')
        .select('id,starts_at,ends_at,kind,capacity,booking_open,departments!inner(id,name,hospital_id,booking_open)')
        .eq('departments.hospital_id', body.hospitalId)
        .eq('booking_open', true)
        .gte('starts_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(20);

      const slots: AgentSlot[] = (rows ?? [])
        .filter((r) => {
          const d = r.departments as unknown as { booking_open: boolean; name: string };
          return d?.booking_open;
        })
        .filter((r) => {
          const d = r.departments as unknown as { name: string };
          // keep only departments matching the resolved care need, when we can
          return slugs.length === 0 || slugs.some((s: string) => matchesDept(d.name, s));
        })
        .map((r) => {
          const d = r.departments as unknown as { id: string; name: string };
          return {
            id: r.id as string,
            departmentId: d.id,
            departmentName: d.name,
            startsAt: r.starts_at as string,
            endsAt: r.ends_at as string,
            kind: (r.kind as string) ?? 'slot',
            remaining: null,
          };
        });

      return ok({
        version: AGENT_VERSION,
        step: 'choose_slot',
        message: slots.length
          ? 'These times are open. Pick one and I will show you the request before sending it.'
          : 'That hospital has no open times listed for this need. Try another hospital.',
        notices: AGENT_BOOKING_NOTICES,
        careNeed: need,
        slots,
        ai: aiMeta,
      } satisfies AgentTurn);
    }

    // ---- step 1 result: candidate hospitals ------------------------------
    // Only bookable hospitals are offered, because the agent's job here ends
    // in a booking. Discovery-only hospitals are reachable from /hospitals.
    const { data: hospitals } = await sb
      .from('hospitals')
      .select('id,name,locality,city,booking_integrated,published')
      .eq('published', true)
      .eq('booking_integrated', true)
      .limit(25);

    const candidates: AgentCandidate[] = (hospitals ?? []).map((h) => ({
      id: h.id as string,
      name: h.name as string,
      locality: (h.locality as string | null) ?? null,
      city: (h.city as string | null) ?? null,
      distanceKm: null,
      bookingIntegrated: Boolean(h.booking_integrated),
      availability: 'unknown',
      reasons: [
        `Accepts FlowCare bookings`,
        need.departments.length
          ? `Matched your need: ${need.departments.map((d: { label: string }) => d.label).join(' or ')}`
          : 'Matched your search',
      ],
    }));

    return ok({
      version: AGENT_VERSION,
      step: candidates.length ? 'choose_hospital' : 'clarify',
      message: candidates.length
        ? need.ambiguous
          ? `"${need.query}" could be handled by more than one department, so I have not narrowed it for you. Pick a hospital to see open times.`
          : 'Pick a hospital to see open times.'
        : 'No hospitals in FlowCare currently accept online booking for that need.',
      notices: AGENT_BOOKING_NOTICES,
      careNeed: need,
      candidates,
      ai: aiMeta,
    } satisfies AgentTurn);
  } catch (e) {
    return handleError(e);
  }
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  return a >= 0 && b > a ? body.slice(a, b + 1) : body;
}

function matchesDept(name: string, slug: string): boolean {
  const n = name.toLowerCase();
  const s = slug.replace(/[-_]/g, ' ').toLowerCase();
  return n.includes(s) || s.includes(n);
}

function cleanErr(message: string): string {
  const m = message.match(/(?:INVALID_INPUT|NOT_FOUND|LIMIT_REACHED|AUTH_REQUIRED|INVALID_TRANSITION):\s*(.*)/);
  return m ? m[1] : 'Could not prepare that request.';
}
