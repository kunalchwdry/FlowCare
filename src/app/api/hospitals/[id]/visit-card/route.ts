import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { track } from '@/lib/analytics';
import { fail, handleError, ok } from '@/lib/http';
import { buildChecklist } from '@/lib/journey/prep';
import { freshnessOf } from '@/lib/provenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * F11 — Offline visit card.
 *
 * Everything a patient needs at the gate with no signal: which gate, which
 * counter, what to bring, who to call.
 *
 * HARD CONSTRAINT (R11): ZERO Google content. No Google photo, no Google
 * rating, no Google-sourced address or phone, no map tile. Google Maps
 * Service Terms §14.3 forbid storing that content, and an offline card is by
 * definition stored on the device. Every field below comes from FlowCare's
 * own records, and the response says so explicitly.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to generate a visit card.');

    const { id } = await ctx.params;
    const repo = await getRepo();
    const hospital = await repo.getHospital(id);
    if (!hospital) return fail(404, 'Hospital not found');

    const sp = req.nextUrl.searchParams;
    const locale = sp.get('locale') ?? 'en';
    const facts = await repo.getFacilityFacts(hospital.id);

    const checklist = buildChecklist(facts.prepRequirements, {
      firstVisit: sp.get('firstVisit') !== 'false',
      usingScheme: sp.get('scheme') === 'true',
      isProcedure: sp.get('procedure') === 'true',
    });

    const routes = facts.routes.filter((r) => r.locale === locale);
    const pack = facts.arrivalPack;

    const card = {
      generatedAt: new Date().toISOString(),
      locale,
      hospital: {
        // FlowCare's own directory record, never the Places response.
        name: hospital.name,
        addressLine: hospital.addressLine,
        city: hospital.city,
        phone: hospital.phone,
      },
      arrival: pack
        ? {
            gateLabel: pack.gateLabel,
            gateNote: pack.gateNote,
            firstCounter: pack.firstCounter,
            buildingNote: pack.buildingNote,
            latePolicyText: pack.latePolicyText,
            freshness: freshnessOf(pack.provenance, 'arrival'),
          }
        : null,
      routes: routes.map((r) => ({
        fromPoint: r.fromPoint,
        toPoint: r.toPoint,
        steps: r.steps,
        stepFree: r.stepFree,
        walkingMinutes: r.walkingMinutes,
      })),
      checklist: checklist.items.map((i) => ({
        text: i.value.text,
        conditional: i.value.conditional,
      })),
      checklistNotice: checklist.notice,
      // Stated on the card itself so a printed copy carries the caveat.
      sourceNotice:
        'All details on this card come from FlowCare records, not from Google. ' +
        'Facts change — check the date beside each item and call if anything matters.',
      containsGoogleContent: false,
    };

    track('visit_card_generated', req.headers.get('x-flowcare-session') ?? 'anon', {
      hospital_id: hospital.id,
      has_arrival_pack: Boolean(pack),
      route_count: routes.length,
    });

    return ok({ card });
  } catch (e) {
    return handleError(e);
  }
}
