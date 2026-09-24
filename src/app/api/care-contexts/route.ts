import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { ACCESSIBILITY_COMPONENT_CODES, TRANSPORT_MODES } from '@/lib/journey/vocab';
import { findClinicalContent } from '@/lib/journey/prep';
import { LANGUAGE_NAMES } from '@/lib/journey/factsView';
import { MAX_CARE_CONTEXTS } from '@/lib/journey/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * F3 — Caregiver mode.
 *
 * A care context is a saved set of PREFERENCES with a label the user chose.
 * There is deliberately no relationship field, no age, no condition: a value
 * like "mother, dementia" would be a clinical inference vector (§9.1).
 * The label is free text, so it is screened by the same clinical blocklist
 * that guards preparation content.
 */
const Body = z
  .object({
    label: z.string().trim().min(1).max(60),
    accessibilityPrefs: z
      .array(z.enum(ACCESSIBILITY_COMPONENT_CODES as unknown as [string, ...string[]]))
      .max(11)
      .optional(),
    languagePrefs: z
      .array(z.enum(Object.keys(LANGUAGE_NAMES) as [string, ...string[]]))
      .max(9)
      .optional(),
    transportMode: z.enum(TRANSPORT_MODES).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to use care contexts.');
    const repo = await getRepo();
    return ok({ careContexts: await repo.listCareContexts(user.id) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to use care contexts.');

    const input = Body.parse(await readJson(req, 2000));

    const hits = findClinicalContent(input.label);
    if (hits.length) {
      return fail(
        400,
        'Please choose a label without health details — for example "Dad" or ' +
          '"Weekend visits". FlowCare does not store health information.',
      );
    }

    const repo = await getRepo();
    const existing = await repo.listCareContexts(user.id);
    if (existing.length >= MAX_CARE_CONTEXTS) {
      return fail(400, `You can have up to ${MAX_CARE_CONTEXTS} care contexts.`);
    }

    const created = await repo.createCareContext({
      ownerUserId: user.id,
      label: input.label,
      accessibilityPrefs: input.accessibilityPrefs ?? [],
      languagePrefs: input.languagePrefs ?? [],
      transportMode: input.transportMode ?? null,
    });

    // Audit records that a context was created, never its label.
    await repo.recordAuditEvent({
      actorId: user.id, actorRole: user.role, action: 'care_context.create',
      entity: 'care_context', entityId: created.id,
      metadata: { has_accessibility_prefs: created.accessibilityPrefs.length > 0 },
    });

    return ok({ careContext: created }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
