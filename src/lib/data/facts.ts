/**
 * DEMO FACILITY FACTS — SYNTHETIC, NOT REAL.
 * -------------------------------------------------------------------------
 * Facility facts for the journey layer (F2, F4, F5, F7, F8, F9, F10, F12,
 * F13, F14), attached to the fictional hospitals in seed.ts.
 *
 * Two properties this file must have, and is tested for:
 *
 *  1. FRESHNESS COVERAGE. Every fact type has fresh, ageing, stale and
 *     never-verified instances somewhere in the dataset. Without that, F18's
 *     four-state rendering is untested and would ship broken.
 *     `nashik-road-wellness` is the never-verified fixture; `katraj-trust-
 *     charitable` and `shivajinagar-government-general` carry stale facts.
 *
 *  2. PER-FIELD FRESHNESS. A single hospital deliberately has fresh facts in
 *     one field and stale facts in another (P24: freshness is not a property
 *     of a facility, it is a property of each fact).
 *
 * The distributions here are illustrative, not sampled from the audits in
 * docs/research/sources.md. They are shaped to exercise the UI, including the
 * uncomfortable states — see `accessible-toilet`, which is absent at most of
 * these fictional sites, echoing the pattern S24/S25 found in real audits.
 */
import type {
  AccessibilityComponent, AccessibilityStatus, ArrivalPack, FacilityCharge,
  LanguageSupport, PrepRequirement, Provenance, SchemeListing,
  ServiceVerification, WayfindingRoute,
} from '@/lib/types';
import { FACT_TTL_DAYS, provenance, type FactField } from '@/lib/provenance';
import { assertAdministrative } from '@/lib/journey/prep';
import {
  ACCESSIBILITY_COMPONENTS, SCHEMES, WORKFLOW_STAGES,
} from '@/lib/journey/vocab';
import { SEED } from '@/lib/data/seed';

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/**
 * Age of each fact, expressed as a multiple of that field's TTL.
 *  <= 1   -> fresh
 *  1–2    -> ageing
 *  > 2    -> stale
 *  null   -> never verified
 */
type AgeProfile = Partial<Record<FactField, number | null>>;

const DEFAULT_PROFILE: AgeProfile = {
  services: 0.25, schemes: 0.3, charges: 0.35, accessibility: 0.2,
  languages: 0.3, arrival: 0.3, routes: 0.35, prep: 0.25,
  arrival_guidance: 0.3, late_policy: 0.35,
};

/** Per-hospital overrides. This is where the edge-case fixtures live. */
const AGE_PROFILES: Record<string, AgeProfile> = {
  // Well maintained, but scheme listing has drifted past its 90-day TTL.
  'deccan-gymkhana-multispecialty': { schemes: 1.4 },

  // Fresh throughout — the "good" reference row.
  'koregaon-park-cardiac': {},

  // Mixed: charges fresh, accessibility stale. Demonstrates P24 directly.
  'kothrud-family-health': { charges: 0.2, accessibility: 2.6, routes: null },

  'baner-ridge-multispecialty': { arrival: 0.15, prep: 0.1 },

  // Community trust: thin, ageing data.
  'hadapsar-community-care': { schemes: 1.6, charges: 1.3, prep: 1.5, routes: null },

  'viman-nagar-skin-allergy': { accessibility: 1.2, routes: null, arrival_guidance: null },

  // Government hospital: stale everywhere except the charges it must publish.
  'shivajinagar-government-general': {
    services: 2.4, schemes: 2.2, accessibility: 2.8, languages: 2.1,
    arrival: 2.5, prep: 2.3, charges: 0.4, routes: 2.4,
  },

  'aundh-orthopaedic-trauma': { services: 1.1, routes: null },

  'wakad-mother-child': { languages: 1.3 },

  // Small clinic: never published charges or schemes at all.
  'camp-eye-ent': { charges: null, schemes: null, routes: null, arrival_guidance: null },

  'pimpri-teaching-research': { services: 1.8, accessibility: 1.9, prep: 1.2 },

  'magarpatta-daycare-surgical': { schemes: 1.1 },

  // Charitable trust: stale, and accessibility never assessed.
  'katraj-trust-charitable': {
    services: 2.7, schemes: 2.9, charges: 2.2, accessibility: null,
    languages: 2.4, arrival: 2.6, prep: 2.8, routes: null, arrival_guidance: null,
    late_policy: null,
  },

  // THE NEVER-VERIFIED FIXTURE. Nothing about this hospital has been checked.
  'nashik-road-wellness': {
    services: null, schemes: null, charges: null, accessibility: null,
    languages: null, arrival: null, routes: null, prep: null,
    arrival_guidance: null, late_policy: null,
  },

  'andheri-east-metro': { charges: 1.5, routes: null },
};

function ageDaysFor(slug: string, field: FactField): number | null {
  const profile = { ...DEFAULT_PROFILE, ...(AGE_PROFILES[slug] ?? {}) };
  const mult = field in profile ? profile[field] : DEFAULT_PROFILE[field];
  if (mult === null || mult === undefined) return mult === null ? null : 30;
  return Math.round(FACT_TTL_DAYS[field] * mult);
}

/** Build the provenance record for one hospital/field pair. */
function prov(
  slug: string,
  field: FactField,
  source: Provenance['source'],
  opts: { sourceUrl?: string | null; role?: string } = {},
): Provenance {
  const age = ageDaysFor(slug, field);
  return provenance(age === null ? 'user_reported_pending' : source, age === null ? null : iso(daysAgo(age)), {
    sourceUrl: opts.sourceUrl ?? null,
    verifiedByRole: age === null ? null : opts.role ?? 'flowcare_ops',
  });
}

const HOSPITALS = SEED.hospitals;

/* ------------------------------------------------------------- F2 ------ */
/**
 * Not every listed service is verified AT THIS LOCATION. Services without a
 * verification row stay out of the filters by default (R2) — that is the
 * whole point of the feature, so the dataset must contain some.
 */
const UNVERIFIED_SERVICES: Record<string, string[]> = {
  'deccan-gymkhana-multispecialty': ['ct-scan'],
  'baner-ridge-multispecialty': ['mri'],
  'hadapsar-community-care': ['ambulance'],
  'pimpri-teaching-research': ['blood-bank'],
  'andheri-east-metro': ['mri', 'day-care-surgery'],
  // Nothing at all is verified here.
  'nashik-road-wellness': ['*'],
  'katraj-trust-charitable': ['*'],
};

function buildServiceVerifications(): ServiceVerification[] {
  const out: ServiceVerification[] = [];
  for (const h of HOSPITALS) {
    const excluded = UNVERIFIED_SERVICES[h.id] ?? [];
    if (excluded.includes('*')) continue;
    for (const svc of h.services) {
      if (excluded.includes(svc.slug)) continue;
      const method: ServiceVerification['method'] =
        h.type === 'government' || h.type === 'teaching'
          ? 'public_document'
          : 'hospital_confirmed';
      out.push({
        hospitalId: h.id,
        serviceSlug: svc.slug,
        method,
        provenance: prov(
          h.id,
          'services',
          method === 'public_document' ? 'hospital_published' : 'hospital_confirmed',
        ),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------- F4 ------ */
const SCHEME_LISTINGS: Record<string, string[]> = {
  'deccan-gymkhana-multispecialty': ['pmjay', 'mjpjay'],
  'koregaon-park-cardiac': ['cghs'],
  'kothrud-family-health': ['mjpjay', 'esic'],
  'baner-ridge-multispecialty': ['pmjay', 'mjpjay', 'cghs'],
  'hadapsar-community-care': ['pmjay', 'mjpjay'],
  'viman-nagar-skin-allergy': [],
  'shivajinagar-government-general': ['pmjay', 'mjpjay', 'esic'],
  'aundh-orthopaedic-trauma': ['mjpjay'],
  'wakad-mother-child': ['pmjay', 'mjpjay'],
  'camp-eye-ent': [],
  'pimpri-teaching-research': ['pmjay', 'mjpjay', 'cghs', 'esic'],
  'magarpatta-daycare-surgical': ['mjpjay'],
  'katraj-trust-charitable': ['pmjay'],
  'nashik-road-wellness': [],
  'andheri-east-metro': ['pmjay', 'cghs'],
};

function buildSchemeListings(): SchemeListing[] {
  const out: SchemeListing[] = [];
  for (const h of HOSPITALS) {
    const listed = SCHEME_LISTINGS[h.id] ?? [];
    if (ageDaysFor(h.id, 'schemes') === null && listed.length === 0) continue;
    for (const s of SCHEMES) {
      const isListed = listed.includes(s.code);
      // We only assert listings we have seen. Absence is "unknown", never "no".
      if (!isListed) continue;
      out.push({
        hospitalId: h.id,
        schemeCode: s.code,
        schemeName: s.name,
        listingStatus: 'listed',
        provenance: prov(h.id, 'schemes', 'official_registry', {
          sourceUrl: `https://example.invalid/registry/${s.code}`,
          role: 'registry_import',
        }),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------- F5 ------ */
/** Published administrative charges, transcribed. Never estimated (R5). */
const CHARGES: Record<string, Partial<Record<FacilityCharge['chargeType'], [number, number]>>> = {
  'deccan-gymkhana-multispecialty': { opd_registration: [200, 200], new_patient_consultation: [700, 1200], followup_consultation: [400, 600] },
  'koregaon-park-cardiac': { opd_registration: [300, 300], new_patient_consultation: [1000, 1500], followup_consultation: [600, 800] },
  'kothrud-family-health': { opd_registration: [100, 100], new_patient_consultation: [400, 600], followup_consultation: [250, 300] },
  'baner-ridge-multispecialty': { opd_registration: [250, 250], new_patient_consultation: [800, 1400], followup_consultation: [500, 700] },
  'hadapsar-community-care': { opd_registration: [50, 50], new_patient_consultation: [150, 250] },
  'viman-nagar-skin-allergy': { opd_registration: [150, 150], new_patient_consultation: [600, 900], followup_consultation: [350, 450] },
  'shivajinagar-government-general': { opd_registration: [10, 10], new_patient_consultation: [0, 0], followup_consultation: [0, 0] },
  'aundh-orthopaedic-trauma': { opd_registration: [200, 200], new_patient_consultation: [700, 1000], followup_consultation: [400, 500] },
  'wakad-mother-child': { opd_registration: [150, 150], new_patient_consultation: [500, 800], followup_consultation: [300, 400] },
  'pimpri-teaching-research': { opd_registration: [20, 20], new_patient_consultation: [50, 100], followup_consultation: [0, 0] },
  'magarpatta-daycare-surgical': { opd_registration: [300, 300], new_patient_consultation: [900, 1200] },
  'katraj-trust-charitable': { opd_registration: [20, 20], new_patient_consultation: [50, 50] },
  'andheri-east-metro': { opd_registration: [250, 250], new_patient_consultation: [800, 1500], followup_consultation: [500, 600] },
};

function buildCharges(): FacilityCharge[] {
  const out: FacilityCharge[] = [];
  for (const h of HOSPITALS) {
    if (ageDaysFor(h.id, 'charges') === null) continue;
    const entry = CHARGES[h.id];
    if (!entry) continue;
    for (const [chargeType, range] of Object.entries(entry)) {
      if (!range) continue;
      out.push({
        hospitalId: h.id,
        chargeType: chargeType as FacilityCharge['chargeType'],
        amountMin: range[0],
        amountMax: range[1],
        currency: 'INR',
        isPublishedRange: range[0] !== range[1],
        provenance: prov(h.id, 'charges', 'hospital_published', {
          sourceUrl: `https://example.invalid/${h.id}/charges`,
        }),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------- F7 ------ */
/**
 * One letter per component, in ACCESSIBILITY_COMPONENTS order.
 * M = meets_standard, B = present_below_standard, N = not_present, A = not_assessed
 */
const ACCESS_MATRIX: Record<string, string> = {
  'deccan-gymkhana-multispecialty': 'MMNMBMNBNNM',
  'koregaon-park-cardiac': 'MMMMMBNMNNM',
  'kothrud-family-health': 'MBNMNNNNNNB',
  'baner-ridge-multispecialty': 'MMMMMMBMBMM',
  'hadapsar-community-care': 'BBNBNNNNNNB',
  'viman-nagar-skin-allergy': 'MMNANMNNNNM',
  'shivajinagar-government-general': 'BBNBNNBNNAB',
  'aundh-orthopaedic-trauma': 'MMBMNMNBNNM',
  'wakad-mother-child': 'MMMMNMNMNNM',
  'camp-eye-ent': 'NBNNNNMNNMB',
  'pimpri-teaching-research': 'MBNMNBBNNAB',
  'magarpatta-daycare-surgical': 'MMMMMMNMMNM',
  'katraj-trust-charitable': 'BNNNNNNNNNN',
  'nashik-road-wellness': 'AAAAAAAAAAA',
  'andheri-east-metro': 'MMBMBMNBNNM',
};

const STATUS_BY_LETTER: Record<string, AccessibilityStatus> = {
  M: 'meets_standard', B: 'present_below_standard', N: 'not_present', A: 'not_assessed',
};

const ACCESS_NOTES: Record<string, string> = {
  'kothrud-family-health:ramp-standard': 'Ramp is steeper than 1:12 and has no handrail on the left side.',
  'hadapsar-community-care:step-free-entrance': 'One 80mm lip at the threshold; staff bring a portable ramp on request.',
  'shivajinagar-government-general:ramp-standard': 'Ramp present at the OPD block only; the pathology block has steps.',
  'aundh-orthopaedic-trauma:accessible-toilet': 'Grab bars fitted, but the door is 750mm and will not admit most wheelchairs.',
  'camp-eye-ent:step-free-entrance': 'Three steps at the entrance. No ramp. Staff assist on request.',
  'baner-ridge-multispecialty:accessible-examination-table': 'One height-adjustable table, in Orthopaedics only.',
  'andheri-east-metro:accessible-toilet': 'Accessible toilet on the ground floor only; upper floors are standard.',
};

function buildAccessibilityComponents(): AccessibilityComponent[] {
  const out: AccessibilityComponent[] = [];
  for (const h of HOSPITALS) {
    const row = ACCESS_MATRIX[h.id];
    if (!row) continue;
    const neverAssessed = ageDaysFor(h.id, 'accessibility') === null;
    ACCESSIBILITY_COMPONENTS.forEach((component, i) => {
      const status: AccessibilityStatus = neverAssessed
        ? 'not_assessed'
        : STATUS_BY_LETTER[row[i]] ?? 'not_assessed';
      out.push({
        hospitalId: h.id,
        componentCode: component.code,
        status,
        standardReference: component.standard,
        note: ACCESS_NOTES[`${h.id}:${component.code}`] ?? null,
        provenance: prov(h.id, 'accessibility', 'flowcare_field_check', {
          role: 'accessibility_auditor',
        }),
      });
    });
  }
  return out;
}

/* ------------------------------------------------------------- F8 ------ */
/**
 * The asymmetry is the point (P9): consultation is often multilingual while
 * the registration counter — where the visit actually starts — is not.
 */
function stageLanguages(base: string[], stage: string): string[] {
  const has = (l: string) => base.includes(l);
  const local = ['mr', 'hi'].filter(has);
  switch (stage) {
    case 'consultation':
      return base;
    case 'phone-enquiry':
      return local.length ? local : base.slice(0, 1);
    case 'registration-counter':
    case 'billing-counter':
      return local.length ? local : base.slice(0, 1);
    case 'nursing-triage':
      return local;
    case 'signage':
      return ['mr', 'en'].filter(has);
    case 'discharge-instructions':
      return local.length ? local : base.slice(0, 1);
    default:
      return base;
  }
}

/** Hospitals that genuinely do better at the counter than the baseline. */
const COUNTER_LANGUAGE_BONUS: Record<string, string[]> = {
  'baner-ridge-multispecialty': ['en', 'gu'],
  'andheri-east-metro': ['en', 'gu'],
  'pimpri-teaching-research': ['en'],
};

function buildLanguageSupport(): LanguageSupport[] {
  const out: LanguageSupport[] = [];
  for (const h of HOSPITALS) {
    for (const stage of WORKFLOW_STAGES) {
      let langs = stageLanguages(h.languages, stage.code);
      if (
        (stage.code === 'registration-counter' || stage.code === 'billing-counter') &&
        COUNTER_LANGUAGE_BONUS[h.id]
      ) {
        langs = Array.from(new Set([...langs, ...COUNTER_LANGUAGE_BONUS[h.id]]))
          .filter((l) => h.languages.includes(l));
      }
      out.push({
        hospitalId: h.id,
        stage: stage.code,
        languages: langs,
        provenance: prov(h.id, 'languages', 'hospital_confirmed'),
      });
    }
  }
  return out;
}

/* ------------------------------------------- F10 / F13 / F14 ----------- */
interface ArrivalSpec {
  gateLabel: string; gateNote: string; firstCounter: string;
  buildingNote: string; parkingNote: string; dropoffNote: string;
  latePolicy: string; arrivalGuidance: string;
}

const ARRIVALS: Record<string, ArrivalSpec> = {
  'deccan-gymkhana-multispecialty': {
    gateLabel: 'Gate 2 (OPD gate)', gateNote: 'Gate 1 is for emergency and ambulances only — you will be sent back.',
    firstCounter: 'OPD registration, ground floor, immediately left of the entrance',
    buildingNote: 'Consulting rooms are in the same block; imaging is in the rear annexe.',
    parkingNote: 'Basement parking, entry from the lane behind the building. Fills by 10:00.',
    dropoffNote: 'Drop-off bay is inside Gate 2, before the ramp.',
    latePolicy: 'Arrive more than 30 minutes late and you keep your place but are seen after the patients already waiting.',
    arrivalGuidance: 'Registration usually takes 10–15 minutes at this site. Coming 20 minutes before your slot is generally enough.',
  },
  'koregaon-park-cardiac': {
    gateLabel: 'Main gate on North Main Road', gateNote: 'Single gate; the security desk directs cardiac OPD to the left wing.',
    firstCounter: 'Reception desk in the atrium, then cardiac OPD counter on level 1',
    buildingNote: 'Echo and TMT rooms are on level 2; you will be sent up after consultation.',
    parkingNote: 'Valet parking at the porch, chargeable.',
    dropoffNote: 'Covered porch at the main entrance.',
    latePolicy: 'Slots are held for 20 minutes. After that you are fitted in when there is a gap.',
    arrivalGuidance: 'Arriving 15 minutes early is usually enough; registration is rarely queued here.',
  },
  'kothrud-family-health': {
    gateLabel: 'Main entrance, Paud Road', gateNote: 'The entrance is set back from the road behind a row of shops.',
    firstCounter: 'Single reception counter facing the door',
    buildingNote: 'Paediatrics and vaccination are on the first floor, up one flight.',
    parkingNote: 'Two-wheeler parking only on site. Car parking is on-street and difficult.',
    dropoffNote: 'No dedicated drop-off; stop briefly on the service road.',
    latePolicy: 'Walk-in based. Arriving late means rejoining the queue.',
    arrivalGuidance: 'Evening OPD is busiest between 18:00 and 19:30.',
  },
  'baner-ridge-multispecialty': {
    gateLabel: 'Gate 3 (OPD and day-care)', gateNote: 'Gates 1 and 2 lead to inpatient and emergency; the OPD block is not reachable on foot from them.',
    firstCounter: 'Kiosk check-in in the OPD atrium, or counter 4 if you need help',
    buildingNote: 'OPD is Block B. Imaging is Block C, connected by a covered walkway on level 1.',
    parkingNote: 'Multi-level car park at Gate 3. Keep the token; it is validated at the billing counter.',
    dropoffNote: 'Drop-off loop directly outside Block B.',
    latePolicy: 'Up to 30 minutes late, you are seen in the next available gap. Beyond that the slot is released.',
    arrivalGuidance: 'Allow 25 minutes between arriving at the gate and reaching the consulting room. The car park to Block B walk alone takes 6–8 minutes.',
  },
  'hadapsar-community-care': {
    gateLabel: 'Main gate, Solapur Road', gateNote: 'Pedestrian entry is the smaller gate to the left of the vehicle gate.',
    firstCounter: 'Case paper counter, first window on the right',
    buildingNote: 'Single building. Consulting rooms run along the corridor past the counter.',
    parkingNote: 'Limited on-site parking, free.',
    dropoffNote: 'Just inside the main gate.',
    latePolicy: 'Token-based. A missed token means taking a fresh one.',
    arrivalGuidance: 'Case paper counter opens at 08:00 and the queue is longest in the first hour.',
  },
  'shivajinagar-government-general': {
    gateLabel: 'Gate 1 (OPD)', gateNote: 'Gate 4 is the mortuary and stores entrance. Gate 2 is inpatient visitors only.',
    firstCounter: 'Case paper window 3, in the covered shed left of the OPD block',
    buildingNote: 'OPD block is separate from the main hospital building. Pathology is a third building behind it.',
    parkingNote: 'Paid parking outside Gate 1. On-site parking is for staff.',
    dropoffNote: 'Auto and bus stand is directly outside Gate 1.',
    latePolicy: 'Case paper counter closes at 11:30 regardless of appointment. Arriving after that means returning the next day.',
    arrivalGuidance: 'The case paper queue commonly runs 45–60 minutes at this site. Patients report arriving before 08:00.',
  },
  'aundh-orthopaedic-trauma': {
    gateLabel: 'Main gate, Aundh Road', gateNote: 'Ortho OPD is the second building; the first is administration.',
    firstCounter: 'OPD counter on the ground floor of Block 2',
    buildingNote: 'X-ray is in the basement of the same block, reachable by lift.',
    parkingNote: 'Surface parking in front, free for the first two hours.',
    dropoffNote: 'Ramped drop-off outside Block 2.',
    latePolicy: 'Slots held 20 minutes; plaster room walk-ins are taken between appointments.',
    arrivalGuidance: 'If you need an X-ray first, allow an extra 30 minutes before your consultation.',
  },
  'wakad-mother-child': {
    gateLabel: 'Main entrance, Wakad Road', gateNote: 'Single entrance with a security desk.',
    firstCounter: 'Reception, directly ahead of the entrance',
    buildingNote: 'Antenatal OPD is on level 1; paediatrics is on the ground floor.',
    parkingNote: 'Basement parking, free.',
    dropoffNote: 'Sheltered drop-off at the entrance, with a step-free path.',
    latePolicy: 'Antenatal slots are held for 30 minutes.',
    arrivalGuidance: 'Arrive 15 minutes early. Antenatal visits start with weight and BP at the nursing station.',
  },
  'viman-nagar-skin-allergy': {
    gateLabel: 'Clinic entrance, Viman Nagar Road', gateNote: 'Ground floor of the Orchid Plaza building, left of the lobby.',
    firstCounter: 'Reception desk immediately inside the clinic door',
    buildingNote: 'Single floor. Patch testing room is at the rear of the corridor.',
    parkingNote: 'Building parking, first hour free.',
    dropoffNote: 'Drop-off in the building forecourt.',
    latePolicy: 'Slots held for 15 minutes.',
    arrivalGuidance: 'Patch testing appointments need you to return on a second and third day; ask at reception.',
  },
  'camp-eye-ent': {
    gateLabel: 'Street entrance, MG Road', gateNote: 'Above the pharmacy; the door is easy to miss between two shopfronts.',
    firstCounter: 'Reception on the first floor, up three steps then one flight',
    buildingNote: 'Eye and ENT share one waiting area on the first floor.',
    parkingNote: 'No parking. Paid public parking two streets away.',
    dropoffNote: 'Kerbside only; stopping is restricted during peak hours.',
    latePolicy: 'Walk-in based, first come first served.',
    arrivalGuidance: 'Quietest in the early afternoon.',
  },
  'pimpri-teaching-research': {
    gateLabel: 'Gate 2 (OPD and college)', gateNote: 'Gate 1 leads to the teaching college, not the hospital OPD.',
    firstCounter: 'Registration hall, counters 1–6, ground floor of the OPD tower',
    buildingNote: 'Departments are spread across four floors of the OPD tower; check the board in the registration hall.',
    parkingNote: 'Large paid car park inside Gate 2.',
    dropoffNote: 'Drop-off outside the OPD tower.',
    latePolicy: 'Registration closes at 12:00 for morning OPD and 17:00 for evening OPD.',
    arrivalGuidance: 'As a teaching hospital, a first visit commonly involves being seen by a junior doctor first. Patients report allowing half a day.',
  },
  'magarpatta-daycare-surgical': {
    gateLabel: 'Main entrance, Magarpatta City', gateNote: 'Inside the commercial complex, tower C.',
    firstCounter: 'Day-care admissions desk, level 2',
    buildingNote: 'Take the lift in tower C lobby to level 2. Ground-floor reception is for the complex, not the hospital.',
    parkingNote: 'Complex parking, paid, validated by the hospital.',
    dropoffNote: 'Tower C porch.',
    latePolicy: 'Day-care lists run to a fixed order; arriving late may move you to the end of the list.',
    arrivalGuidance: 'Day-care admissions ask patients to arrive at the time on their admission letter, not earlier.',
  },
  'katraj-trust-charitable': {
    gateLabel: 'Main gate, Katraj', gateNote: 'One gate for everything.',
    firstCounter: 'Token counter under the tin shed, left of the gate',
    buildingNote: 'Single-storey building; all consulting rooms open onto the central corridor.',
    parkingNote: 'Two-wheeler parking inside the gate.',
    dropoffNote: 'Just inside the gate.',
    latePolicy: 'Tokens are issued from 07:30 until they run out for the day.',
    arrivalGuidance: 'Tokens are limited daily and patients report queueing before the counter opens.',
  },
  'andheri-east-metro': {
    gateLabel: 'Main entrance, Chakala', gateNote: 'Entrance faces the service road, not the highway.',
    firstCounter: 'OPD registration, counters 1–4, ground floor',
    buildingNote: 'OPD on ground and first floor; imaging on the second.',
    parkingNote: 'Basement parking, paid.',
    dropoffNote: 'Drop-off on the service road outside the main door.',
    latePolicy: 'Slots held for 20 minutes.',
    arrivalGuidance: 'Allow extra time on weekday mornings; the service road backs up before 10:00.',
  },
};

function buildArrivalPacks(): ArrivalPack[] {
  const out: ArrivalPack[] = [];
  for (const h of HOSPITALS) {
    const spec = ARRIVALS[h.id];
    if (!spec) continue;
    const guidanceKnown = ageDaysFor(h.id, 'arrival_guidance') !== null;
    const lateKnown = ageDaysFor(h.id, 'late_policy') !== null;
    out.push({
      hospitalId: h.id,
      gateLabel: spec.gateLabel,
      gateNote: spec.gateNote,
      firstCounter: spec.firstCounter,
      buildingNote: spec.buildingNote,
      parkingNote: spec.parkingNote,
      dropoffNote: spec.dropoffNote,
      latePolicyText: lateKnown ? spec.latePolicy : null,
      arrivalGuidanceText: guidanceKnown ? spec.arrivalGuidance : null,
      provenance: prov(h.id, 'arrival', 'flowcare_field_check'),
    });
  }
  return out;
}

/* ------------------------------------------------------------ F12 ------ */
/**
 * Static landmark steps only. No indoor positioning, no live guidance (R12).
 * Deliberately present for a minority of sites — this is a data-bound
 * feature (Band 3) and the "we do not have this yet" state is the common one.
 */
const ROUTES: Array<Omit<WayfindingRoute, 'provenance'>> = [
  {
    hospitalId: 'baner-ridge-multispecialty', fromPoint: 'Gate 3', toPoint: 'OPD registration (Block B)',
    locale: 'en', stepFree: true, walkingMinutes: 7,
    steps: [
      'Enter at Gate 3, the one with the multi-level car park sign.',
      'Keep the car park on your right and walk straight towards the glass-fronted block.',
      'Pass the covered auto stand; the path slopes gently down, no steps.',
      'Enter Block B through the automatic doors under the blue "OPD" sign.',
      'Registration kiosks are directly ahead; staffed counters 1–6 are to your left.',
    ],
  },
  {
    hospitalId: 'baner-ridge-multispecialty', fromPoint: 'Gate 3', toPoint: 'OPD registration (Block B)',
    locale: 'mr', stepFree: true, walkingMinutes: 7,
    steps: [
      'गेट ३ मधून आत या — जिथे बहुमजली पार्किंगचा बोर्ड आहे.',
      'पार्किंग उजव्या हाताला ठेवून काचेच्या इमारतीकडे सरळ चालत जा.',
      'रिक्षा स्टँड ओलांडा; रस्ता हळू उतरतो, पायऱ्या नाहीत.',
      'निळ्या "OPD" फलकाखालील स्वयंचलित दरवाजातून ब्लॉक B मध्ये जा.',
      'नोंदणी कियोस्क समोरच आहेत; काउंटर १–६ डावीकडे आहेत.',
    ],
  },
  {
    hospitalId: 'shivajinagar-government-general', fromPoint: 'Gate 1 (bus stop)', toPoint: 'Case paper window 3',
    locale: 'en', stepFree: false, walkingMinutes: 5,
    steps: [
      'From the bus stop, use Gate 1 — the gate with the painted OPD board, not the larger gate to its right.',
      'Walk past the medicine shop on your left and continue towards the tin-roofed shed.',
      'The shed has six windows. Window 3 is the middle one, marked "New case paper".',
      'There are two steps up into the shed. A ramp is at the far left end.',
    ],
  },
  {
    hospitalId: 'shivajinagar-government-general', fromPoint: 'Case paper window 3', toPoint: 'OPD block, first floor',
    locale: 'en', stepFree: false, walkingMinutes: 6,
    steps: [
      'With your case paper, leave the shed and turn right towards the two-storey building.',
      'Enter through the central doorway under the clock.',
      'The staircase is immediately on your right. The lift is at the far end of the corridor and is often not working.',
      'First floor: departments are signposted in Marathi only.',
    ],
  },
  {
    hospitalId: 'pimpri-teaching-research', fromPoint: 'Gate 2', toPoint: 'Registration hall',
    locale: 'en', stepFree: true, walkingMinutes: 8,
    steps: [
      'Enter at Gate 2, signposted for the hospital, not Gate 1 for the college.',
      'Follow the covered walkway straight ahead for about 300 metres.',
      'The OPD tower is the tall building at the end with a red canopy.',
      'The registration hall is on the ground floor through the main doors.',
    ],
  },
  {
    hospitalId: 'deccan-gymkhana-multispecialty', fromPoint: 'Gate 2', toPoint: 'OPD registration',
    locale: 'en', stepFree: true, walkingMinutes: 3,
    steps: [
      'Use Gate 2, marked OPD. Gate 1 is emergency only and security will redirect you.',
      'Walk up the ramp to the main doors.',
      'Registration is the counter immediately on your left as you enter.',
    ],
  },
  {
    hospitalId: 'magarpatta-daycare-surgical', fromPoint: 'Tower C lobby', toPoint: 'Day-care admissions',
    locale: 'en', stepFree: true, walkingMinutes: 4,
    steps: [
      'Enter Tower C from the complex porch.',
      'Ignore the ground-floor reception — it serves the whole complex, not the hospital.',
      'Take the lift on the right to level 2.',
      'Turn left out of the lift; admissions is the desk facing you.',
    ],
  },
];

function buildRoutes(): WayfindingRoute[] {
  return ROUTES
    .filter((r) => ageDaysFor(r.hospitalId, 'routes') !== null)
    .map((r) => ({ ...r, provenance: prov(r.hospitalId, 'routes', 'flowcare_field_check') }));
}

/* ------------------------------------------------------------- F9 ------ */
interface PrepSpec {
  code: string; text: string; appliesTo: PrepRequirement['appliesTo'];
}

const COMMON_PREP: PrepSpec[] = [
  { code: 'photo-id', text: 'A government photo ID — Aadhaar, PAN, driving licence or voter ID.', appliesTo: 'all' },
  { code: 'appointment-reference', text: 'Your appointment reference number, on your phone or printed.', appliesTo: 'all' },
  { code: 'previous-reports', text: 'Any previous test reports relating to this visit.', appliesTo: 'first_visit' },
  { code: 'previous-prescriptions', text: 'Your current prescriptions, or photographs of them.', appliesTo: 'first_visit' },
  { code: 'scheme-card', text: 'Your scheme card and the referral paperwork the scheme requires.', appliesTo: 'scheme_patients' },
];

const EXTRA_PREP: Record<string, PrepSpec[]> = {
  'shivajinagar-government-general': [
    { code: 'registration-window', text: 'The case paper counter closes at 11:30. Arriving after that means returning another day.', appliesTo: 'all' },
    { code: 'advance-payment', text: 'Bring ₹10 in cash for the case paper. Cards are not accepted at this counter.', appliesTo: 'all' },
  ],
  'katraj-trust-charitable': [
    { code: 'registration-window', text: 'Tokens are issued from 07:30 until the daily limit is reached.', appliesTo: 'all' },
    { code: 'advance-payment', text: 'Bring ₹20 in cash for the token. There is no card facility.', appliesTo: 'all' },
  ],
  'pimpri-teaching-research': [
    { code: 'referral-letter', text: 'A referral letter is required for specialty clinics. Without one you will be sent to general OPD first.', appliesTo: 'first_visit' },
  ],
  'magarpatta-daycare-surgical': [
    { code: 'attendant-required', text: 'An adult attendant must come with you and stay for the whole day-care visit.', appliesTo: 'procedure' },
    { code: 'advance-payment', text: 'Day-care admissions ask for the package advance at the admissions desk.', appliesTo: 'procedure' },
  ],
  'wakad-mother-child': [
    { code: 'previous-reports', text: 'Bring your antenatal card to every visit.', appliesTo: 'all' },
  ],
  'baner-ridge-multispecialty': [
    { code: 'attendant-required', text: 'An attendant is required for day-care procedures.', appliesTo: 'procedure' },
  ],
  'hadapsar-community-care': [
    { code: 'advance-payment', text: 'Bring ₹50 in cash for the case paper; UPI is accepted at the billing counter only.', appliesTo: 'all' },
  ],
};

function buildPrepRequirements(): PrepRequirement[] {
  const out: PrepRequirement[] = [];
  for (const h of HOSPITALS) {
    if (ageDaysFor(h.id, 'prep') === null) continue;
    const specs = [...COMMON_PREP, ...(EXTRA_PREP[h.id] ?? [])];
    for (const spec of specs) {
      // Enforcement at build time: the seed cannot introduce clinical advice.
      assertAdministrative(spec.text);
      out.push({
        hospitalId: h.id,
        departmentId: null,
        code: spec.code,
        text: spec.text,
        appliesTo: spec.appliesTo,
        provenance: prov(h.id, 'prep', 'hospital_confirmed'),
      });
    }
  }
  return out;
}

/* ------------------------------------------------- pending fixtures ---- */
/**
 * User-reported, not yet checked. These exist so the `unverified` state is
 * real in the dataset rather than theoretical.
 *
 * They are also what makes F2 testable: a service with a pending
 * verification must NOT be matched by a service filter (R2), because a
 * patient filtering for "MRI" and travelling to a site that does not have
 * one is exactly the failure the feature exists to prevent.
 */
const PENDING_SERVICES: Array<[string, string]> = [
  ['nashik-road-wellness', 'diagnostic-lab'],
  ['nashik-road-wellness', 'pharmacy'],
  ['katraj-trust-charitable', 'pharmacy'],
  ['viman-nagar-skin-allergy', 'diagnostic-lab'],
];

function buildPendingServiceVerifications(): ServiceVerification[] {
  return PENDING_SERVICES.filter(([hid, slug]) =>
    HOSPITALS.some((h) => h.id === hid && h.services.some((s) => s.slug === slug)),
  ).map(([hospitalId, serviceSlug]) => ({
    hospitalId,
    serviceSlug,
    method: 'user_reported_pending' as const,
    provenance: provenance('user_reported_pending', null),
  }));
}

function buildPendingSchemeListings(): SchemeListing[] {
  return [
    {
      hospitalId: 'nashik-road-wellness',
      schemeCode: 'pmjay',
      schemeName: SCHEMES[0].name,
      listingStatus: 'unknown' as const,
      provenance: provenance('user_reported_pending', null),
    },
  ];
}

function buildPendingCharges(): FacilityCharge[] {
  return [
    {
      hospitalId: 'nashik-road-wellness',
      chargeType: 'opd_registration' as const,
      amountMin: 100, amountMax: 100, currency: 'INR' as const, isPublishedRange: false,
      provenance: provenance('user_reported_pending', null),
    },
  ];
}

function buildPendingArrival(): ArrivalPack[] {
  return [
    {
      hospitalId: 'nashik-road-wellness',
      gateLabel: 'Main entrance, Nashik Road',
      gateNote: 'Reported by a visitor, not yet checked by FlowCare.',
      firstCounter: 'Reception inside the main door',
      buildingNote: null, parkingNote: null, dropoffNote: null,
      latePolicyText: null, arrivalGuidanceText: null,
      provenance: provenance('user_reported_pending', null),
    },
  ];
}

function buildPendingPrep(): PrepRequirement[] {
  const text = 'A government photo ID. Reported by a visitor, not yet confirmed.';
  assertAdministrative(text);
  return [
    {
      hospitalId: 'nashik-road-wellness', departmentId: null,
      code: 'photo-id', text, appliesTo: 'all' as const,
      provenance: provenance('user_reported_pending', null),
    },
  ];
}

function buildPendingRoutes(): WayfindingRoute[] {
  return [
    {
      hospitalId: 'nashik-road-wellness',
      fromPoint: 'Main entrance', toPoint: 'Reception',
      locale: 'en', stepFree: null, walkingMinutes: null,
      steps: [
        'Reported by a visitor: the entrance is directly off the main road.',
        'Reception is inside on the right.',
      ],
      provenance: provenance('user_reported_pending', null),
    },
  ];
}

/* ----------------------------------------------------------- export ---- */

export const FACTS = {
  serviceVerifications: [...buildServiceVerifications(), ...buildPendingServiceVerifications()],
  schemeListings: [...buildSchemeListings(), ...buildPendingSchemeListings()],
  charges: [...buildCharges(), ...buildPendingCharges()],
  accessibilityComponents: buildAccessibilityComponents(),
  languageSupport: buildLanguageSupport(),
  arrivalPacks: [...buildArrivalPacks(), ...buildPendingArrival()],
  routes: [...buildRoutes(), ...buildPendingRoutes()],
  prepRequirements: [...buildPrepRequirements(), ...buildPendingPrep()],
};

/**
 * F2 gate. A service counts as available for FILTERING only when a person or
 * a document confirmed it at this location. Pending user reports are shown on
 * the profile (labelled) but never drive a filter match.
 */
export function isFilterableVerification(v: ServiceVerification): boolean {
  return v.method !== 'user_reported_pending' && v.provenance.verifiedAt !== null;
}
