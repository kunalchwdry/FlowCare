import 'server-only';
import { z } from 'zod';
import { translate, looksLikeEmergency, EMERGENCY_NOTICE } from '@/lib/journey/translator';
import { FLOWCARE_AGENT_SYSTEM_PROMPT } from './prompts';

/**
 * fc-agent-v1 — the agentic booking workflow.
 *
 * ===========================================================================
 * THE BOUNDARY
 * ===========================================================================
 * The language model has exactly one job in this pipeline: turn a sentence
 * into a structured intent. It does not choose a hospital, it does not choose
 * a slot, it does not build the booking payload, and it cannot write anything.
 *
 *   model ──► intent (Zod-validated, allowlisted fields)
 *              │
 *   server ────┴─► search ─► candidates ─► user picks ─► server builds payload
 *                                                          │
 *   user ──────────────────────────────── taps Confirm ────┤
 *                                                          ▼
 *   server ─────────────────────────────────────► book_appointment()
 *
 * Why it is shaped this way: if the model could supply the payload, then any
 * text a patient pasted in — a hospital's own description, a review, a
 * WhatsApp forward — would be a potential instruction to book something else.
 * Prompt injection would become a booking primitive. Because confirmation
 * takes a proposal ID and the payload was assembled server-side from
 * validated search results, the worst a fully compromised model can do is
 * suggest a bad search.
 *
 * The four steps are deliberately separate round trips so that a human sees,
 * and approves, the thing that actually happens.
 */

export const AGENT_VERSION = 'fc-agent-v1';

/** The only actions the agent may ever propose. Nothing here is destructive. */
export const AGENT_ACTIONS = ['book_appointment', 'cancel_appointment'] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export type AgentStep =
  | 'clarify'        // we need more from the user before searching
  | 'choose_hospital'// candidates found, waiting for a human choice
  | 'choose_slot'    // hospital chosen, waiting for a slot choice
  | 'confirm'        // payload assembled, waiting for explicit confirmation
  | 'done'           // executed
  | 'blocked';       // we will not proceed (e.g. emergency language)

export interface AgentTurn {
  version: string;
  step: AgentStep;
  /** Plain-language message for the user. Never clinical advice. */
  message: string;
  notices: string[];
  careNeed?: {
    query: string;
    departments: Array<{ slug: string; label: string }>;
    ambiguous: boolean;
  };
  candidates?: AgentCandidate[];
  slots?: AgentSlot[];
  proposal?: {
    id: string;
    summary: string;
    expiresAt: string;
    payload: Record<string, unknown>;
  };
  result?: Record<string, unknown>;
  /** Which model produced the intent, and who paid for it. */
  ai: {
    provider: string | null;
    model: string | null;
    source: string;
    keySource: 'user' | 'server' | 'none';
    unavailableReason: string | null;
  };
}

export interface AgentCandidate {
  id: string;
  name: string;
  locality: string | null;
  city: string | null;
  distanceKm: number | null;
  bookingIntegrated: boolean;
  availability: 'available' | 'limited' | 'none' | 'unknown';
  /** Why this appeared, in the user's terms. Never a black box. */
  reasons: string[];
}

export interface AgentSlot {
  id: string;
  departmentId: string;
  departmentName: string;
  startsAt: string;
  endsAt: string;
  kind: string;
  remaining: number | null;
}

/**
 * The structured intent the model is allowed to emit. Anything outside this
 * shape is discarded before it can influence a query.
 */
export const AgentIntentSchema = z
  .object({
    careNeed: z.string().min(1).max(120).nullish(),
    locality: z.string().max(80).nullish(),
    city: z.string().max(80).nullish(),
    // A preference, never a promise. The scheduler decides what exists.
    preferredWhen: z.enum(['asap', 'today', 'tomorrow', 'this_week', 'any']).nullish(),
    forDependentName: z.string().max(80).nullish(),
  })
  .strict();

export type AgentIntent = z.infer<typeof AgentIntentSchema>;

export const AGENT_SYSTEM_PROMPT = FLOWCARE_AGENT_SYSTEM_PROMPT;

/**
 * Turn free text into a care-need translation using FlowCare's own closed
 * vocabulary. The model's careNeed string is only ever used as a LOOKUP KEY
 * against this list — it never reaches a query directly.
 */
export function resolveCareNeed(text: string) {
  const t = translate(text);
  // translate() returns one Translation per matched lay term, each with its
  // own candidate departments. Flatten and dedupe by slug, preserving the
  // confidence order translate() already established.
  const seen = new Set<string>();
  const departments: Array<{ slug: string; label: string }> = [];
  for (const tr of t.translations) {
    for (const d of tr.departments) {
      if (seen.has(d.slug)) continue;
      seen.add(d.slug);
      departments.push({ slug: d.slug, label: d.label });
    }
  }
  return {
    query: text,
    departments,
    // Ambiguous when FlowCare cannot narrow to a single department. Narrowing
    // further would be triage, which is not ours to do.
    ambiguous: departments.length > 1 || t.translations.some((x) => x.ambiguous),
    emergency: t.emergency,
  };
}

/**
 * Build the human-readable summary that appears on the confirmation card.
 *
 * This is generated from the payload, NOT written by the model, so what the
 * user reads is guaranteed to describe what the server will actually do.
 */
export function buildBookingSummary(p: {
  hospitalName: string;
  departmentName: string;
  startsAt: string;
  patientName: string;
  timezone?: string | null;
}): string {
  const when = formatWhen(p.startsAt, p.timezone ?? 'Asia/Kolkata');
  return (
    `Request an appointment for ${p.patientName} in ${p.departmentName} ` +
    `at ${p.hospitalName}, ${when}. ` +
    `This sends a request — the hospital still has to confirm it.`
  );
}

export function formatWhen(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * The agent applies a BROADER emergency guard than search does.
 *
 * Why the two differ: showing someone a list of hospitals is a low-stakes act,
 * so over-blocking search would be its own harm. Booking is different — it
 * places a person in a queue for a routine outpatient slot and implicitly
 * tells them "this is the right path, now wait". If they are describing
 * something time-critical, that is an actively dangerous thing to do.
 *
 * So the agent errs toward refusing to act. Refusing is not triage: FlowCare
 * is not deciding what is wrong with anyone, it is declining to take a
 * booking action and pointing at emergency services. The safe failure is to
 * do nothing.
 *
 * `looksLikeEmergency` (used by search) only catches "crushing chest pain"
 * and "not breathing"; it misses the far commoner phrasings below.
 */
const AGENT_EMERGENCY_PATTERNS: RegExp[] = [
  // breathing
  /\b(can'?t|cannot|can not|unable to|trouble|difficulty|struggling to)\s+breath\w*/i,
  /\b(breathless|gasping|choking|suffocat\w*)\b/i,
  // chest / cardiac
  /\bchest\s+(pain|tightness|pressure|heaviness)\b/i,
  // haemorrhage and trauma
  /\b(bleeding\s+(a lot|heavily|badly|non.?stop)|won'?t stop bleeding)\b/i,
  /\b(broken bone|compound fracture|deep cut|head injury|road accident|major accident)\b/i,
  // neurological
  /\b(seizure|fitting|convulsion\w*|paralys\w*|slurred speech|face drooping)\b/i,
  /\b(fainted|passed out|unresponsive|blacked out)\b/i,
  // obstetric and paediatric red flags
  /\b(labour pain|water broke|heavy bleeding in pregnancy)\b/i,
  /\b(baby|infant|newborn)\b.{0,20}\b(not breathing|blue|limp|unresponsive)\b/i,
  // self-harm
  /\b(kill myself|end my life|hurt myself)\b/i,
];

export function agentLooksLikeEmergency(text: string): boolean {
  return looksLikeEmergency(text) || AGENT_EMERGENCY_PATTERNS.some((re) => re.test(text));
}

/**
 * Emergency language stops the agent dead. We do not triage, and we do not
 * try to book our way out of an emergency.
 */
export function emergencyBlock(text: string): AgentTurn | null {
  if (!agentLooksLikeEmergency(text)) return null;
  return {
    version: AGENT_VERSION,
    step: 'blocked',
    message: EMERGENCY_NOTICE,
    notices: [EMERGENCY_NOTICE],
    ai: { provider: null, model: null, source: 'guard', keySource: 'none', unavailableReason: null },
  };
}

/** Notices that must ride along with every agent turn that books anything. */
export const AGENT_BOOKING_NOTICES = [
  'FlowCare sends a request to the hospital. A request is not a confirmed appointment until the hospital accepts it.',
  'The assistant cannot give medical advice and does not decide how urgent your problem is.',
];
