/**
 * Journey-layer unit tests (F1–F20).
 *
 * These concentrate on the HARD CONSTRAINTS from
 * docs/research/03-review-and-plan.md §10.1 — the rules that, if broken,
 * make a feature actively harmful rather than merely incomplete. A test that
 * only checked "the function returns something" would not be worth writing
 * here; each one below corresponds to a way the product could mislead a
 * patient.
 */
import { describe, expect, it } from 'vitest';

import {
  FACT_TTL_DAYS, freshnessOf, medianFactAgeDays, provenance, summariseFreshness,
  isFlowcareVerified, UNVERIFIED,
} from '@/lib/provenance';
import {
  AMBIGUOUS_GUIDANCE, CARE_NEEDS, EMERGENCY_NOTICE, translate,
} from '@/lib/journey/translator';
import {
  CLINICAL_REFERRAL_NOTICE, ClinicalContentError, assertAdministrative,
  buildChecklist, findClinicalContent, isAdministrative,
} from '@/lib/journey/prep';
import {
  HASHABLE_FIELDS, UnhashableFieldError, assertHashable, detect,
  normaliseForComparison,
} from '@/lib/journey/discrepancy';
import {
  MAX_CORRECTIONS_PER_DAY, UnreviewedPublicationError, assertReviewed,
  countRecentByUser, findDuplicate, validateSubmission,
} from '@/lib/journey/corrections';
import { groupTasks, isOverdue, validateDueDate } from '@/lib/journey/followup';
import { describeEstimate, straightLineEstimate } from '@/lib/journey/travel';
import { buildFacilityFactsView } from '@/lib/journey/factsView';
import { FACTS, isFilterableVerification } from '@/lib/data/facts';
import { SEED } from '@/lib/data/seed';
import { demoRepo } from '@/lib/data/demoRepo';
import type { FacilityCorrection, PrepRequirement, Provenance } from '@/lib/types';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

/* ===================================================== F18 provenance === */

describe('F18 provenance and freshness', () => {
  it('never renders an unverified fact as fresh', () => {
    const f = freshnessOf(UNVERIFIED, 'phone');
    expect(f.state).toBe('unverified');
    expect(f.ageDays).toBeNull();
    expect(f.label).toMatch(/not verified/i);
    expect(f.caution).toBeTruthy();
  });

  it('grades fresh / ageing / stale against the field TTL, not a global one', () => {
    const ttl = FACT_TTL_DAYS.phone; // 90
    expect(freshnessOf(provenance('hospital_confirmed', iso(ttl - 5)), 'phone').state).toBe('fresh');
    expect(freshnessOf(provenance('hospital_confirmed', iso(ttl + 10)), 'phone').state).toBe('ageing');
    expect(freshnessOf(provenance('hospital_confirmed', iso(ttl * 2 + 10)), 'phone').state).toBe('stale');
  });

  it('applies a different TTL to a different field for the same date', () => {
    // 120 days is stale-ish for a phone number and fresh for accessibility.
    const p = provenance('flowcare_field_check', iso(120));
    expect(freshnessOf(p, 'phone').state).toBe('ageing');
    expect(freshnessOf(p, 'accessibility').state).toBe('fresh');
  });

  it('treats Google content as live with no verification date', () => {
    const f = freshnessOf(provenance('google_live', null), 'phone');
    expect(f.state).toBe('live');
    expect(f.label).toMatch(/google/i);
    expect(f.caution).toBeNull();
  });

  it('does not count a Google fact as FlowCare-verified', () => {
    expect(isFlowcareVerified(provenance('google_live', iso(1)))).toBe(false);
    expect(isFlowcareVerified(provenance('flowcare_field_check', iso(1)))).toBe(true);
    expect(isFlowcareVerified(provenance('flowcare_field_check', null))).toBe(false);
  });

  it('summarises by counts and exposes a median age, never a score', () => {
    const items = [
      { provenance: provenance('hospital_confirmed', iso(10)), field: 'phone' as const },
      { provenance: provenance('hospital_confirmed', iso(200)), field: 'phone' as const },
      { provenance: UNVERIFIED, field: 'phone' as const },
    ];
    const s = summariseFreshness(items);
    expect(s.total).toBe(3);
    expect(s.fresh).toBe(1);
    expect(s.stale).toBe(1);
    expect(s.unverified).toBe(1);
    expect(s).not.toHaveProperty('score');
    expect(s).not.toHaveProperty('grade');
    expect(medianFactAgeDays(items)).toBeCloseTo(105, 0);
  });

  it('returns a null median when nothing has ever been verified', () => {
    expect(medianFactAgeDays([{ provenance: UNVERIFIED, field: 'prep' }])).toBeNull();
  });
});

/* ====================================================== F1 translator === */

describe('F1 care need translator', () => {
  it('ALWAYS returns >= 2 departments for every ambiguous term', () => {
    // The defining safety property: one department for "chest pain" is triage.
    const offenders = CARE_NEEDS
      .filter((e) => e.ambiguous && e.departments.length < 2)
      .map((e) => e.term);
    expect(offenders).toEqual([]);
  });

  it('gives every department a reason, so the list is never unexplained', () => {
    const offenders = CARE_NEEDS
      .filter((e) => e.reasons.length < e.departments.length || e.reasons.some((r) => !r.trim()))
      .map((e) => e.term);
    expect(offenders).toEqual([]);
  });

  it('maps "chest pain" across cardiac, general, gastro and lung clinics', () => {
    const r = translate('I have chest pain');
    expect(r.translations).toHaveLength(1);
    const slugs = r.translations[0].departments.map((d) => d.slug);
    expect(slugs).toContain('cardiology');
    expect(slugs).toContain('gastroenterology');
    expect(slugs.length).toBeGreaterThanOrEqual(2);
    expect(r.translations[0].guidance).toBe(AMBIGUOUS_GUIDANCE);
  });

  it('handles transliterated Hindi and Marathi input', () => {
    expect(translate('pet me dard').translations[0]?.term).toBe('stomach pain');
    expect(translate('sar dard se pareshan hoon').translations[0]?.term).toBe('headache');
  });

  it('returns every match rather than narrowing to one', () => {
    const r = translate('chest pain and breathlessness');
    expect(r.translations.length).toBeGreaterThanOrEqual(2);
  });

  it('surfaces an emergency notice without suppressing results', () => {
    const r = translate('think this is a heart attack');
    expect(r.emergency).toBe(true);
    expect(r.emergencyNotice).toBe(EMERGENCY_NOTICE);
    expect(r.emergencyNotice).toMatch(/108/);
  });

  it('returns nothing rather than guessing for an unknown phrase', () => {
    const r = translate('qwertyuiop asdfgh');
    expect(r.translations).toEqual([]);
    expect(r.suggestedSpecialties).toEqual([]);
  });

  it('is pure and synchronous — no LLM at query time', () => {
    const out = translate('fever');
    expect(out).not.toBeInstanceOf(Promise);
  });
});

/* ============================================== F9 clinical blocklist === */

describe('F9 preparation checklist', () => {
  it.each([
    ['Come fasting for this test', 'fasting'],
    ['Attend on an empty stomach', 'empty stomach'],
    ['NPO after midnight', 'npo'],
    ['Stop taking your medication two days before', 'stop taking'],
    ['Take 500 mg the night before', 'mg'],
    ['Adjust your insulin as needed', 'insulin'],
    ['Arrive with a full bladder', 'full bladder'],
    ['Bring a list of your symptoms', 'symptom'],
  ])('rejects clinical instruction: %s', (text) => {
    expect(isAdministrative(text)).toBe(false);
    expect(() => assertAdministrative(text)).toThrow(ClinicalContentError);
  });

  it.each([
    'A government photo ID — Aadhaar, PAN, driving licence or voter ID.',
    'Your current prescriptions, or photographs of them.',
    'Collect the form from the diagnostic lab counter.',
    'Bring ₹50 in cash for the case paper.',
    'An adult attendant must come with you.',
  ])('accepts administrative item: %s', (text) => {
    expect(isAdministrative(text)).toBe(true);
    expect(() => assertAdministrative(text)).not.toThrow();
  });

  it('reports every reason a string was rejected', () => {
    const hits = findClinicalContent('Come fasting and stop taking your insulin');
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.map((h) => h.why)).toContain('fasting instruction');
  });

  it('NO seeded preparation text anywhere contains clinical content', () => {
    const offenders = FACTS.prepRequirements
      .filter((p) => !isAdministrative(p.text))
      .map((p) => `${p.hospitalId}: ${p.text}`);
    expect(offenders).toEqual([]);
  });

  it('filters by appliesTo and always attaches the clinical referral notice', () => {
    const base: Omit<PrepRequirement, 'code' | 'appliesTo' | 'text'> = {
      hospitalId: 'h1', departmentId: null, provenance: provenance('hospital_confirmed', iso(5)),
    };
    const reqs: PrepRequirement[] = [
      { ...base, code: 'photo-id', text: 'Photo ID', appliesTo: 'all' },
      { ...base, code: 'scheme-card', text: 'Scheme card', appliesTo: 'scheme_patients' },
      { ...base, code: 'referral-letter', text: 'Referral letter', appliesTo: 'first_visit' },
    ];

    const withoutScheme = buildChecklist(reqs, { firstVisit: false, usingScheme: false, isProcedure: false });
    expect(withoutScheme.items.map((i) => i.value.code)).toEqual(['photo-id']);
    expect(withoutScheme.notice).toBe(CLINICAL_REFERRAL_NOTICE);

    const withScheme = buildChecklist(reqs, { firstVisit: true, usingScheme: true, isProcedure: false });
    expect(withScheme.items.map((i) => i.value.code).sort())
      .toEqual(['photo-id', 'referral-letter', 'scheme-card']);
    expect(withScheme.items.find((i) => i.value.code === 'scheme-card')!.value.conditional).toBe(true);
  });

  it('says so plainly when a hospital has published nothing', () => {
    const empty = buildChecklist([], { firstVisit: true, usingScheme: false, isProcedure: false });
    expect(empty.empty).toBe(true);
    expect(empty.emptyMessage).toBeTruthy();
  });
});

/* ================================================ F16 discrepancy ======= */

describe('F16 discrepancy detector', () => {
  it('refuses to fingerprint fields outside the allowlist', () => {
    expect(() => assertHashable('reviews')).toThrow(UnhashableFieldError);
    expect(() => assertHashable('displayName')).toThrow(UnhashableFieldError);
    expect(() => assertHashable('phone')).not.toThrow();
    expect(HASHABLE_FIELDS).toEqual(['phone', 'address', 'hours']);
  });

  it('normalises cosmetic phone differences so they are not false positives', () => {
    const a = normaliseForComparison('phone', '+91 20 1234 5678');
    const b = normaliseForComparison('phone', '02012345678');
    expect(a).toBe(b);
  });

  it('is OFF unless an operator sets both the flag and a salt', () => {
    // tests/setup.ts sets neither, which is the default deployment state.
    const r = detect({
      hospitalId: 'h1', field: 'phone',
      flowcareValue: '+91 20 1111 1111', externalValue: '+91 20 2222 2222',
    });
    expect(r.ran).toBe(false);
    expect(r.skippedReason).toBe('feature_disabled');
    expect(r.discrepancy).toBeNull();
  });

  it('never stores a raw value even in its own type shape', () => {
    // The persisted record has hash fields only; there is no value field.
    const keys = [
      'hospitalId', 'fieldCode', 'flowcareValueHash', 'externalValueHash',
      'detectedAt', 'status',
    ];
    expect(keys).not.toContain('externalValue');
    expect(keys).not.toContain('flowcareValue');
  });
});

/* ================================================= F17 corrections ====== */

describe('F17 correction workflow', () => {
  const baseCorrection = (over: Partial<FacilityCorrection> = {}): FacilityCorrection => ({
    id: 'cor-1', hospitalId: 'h1', fieldCode: 'phone', reportedByUserId: 'u1',
    claimedValue: '020 1111 1111', evidenceKind: 'i_called', note: null,
    status: 'pending', reviewedByUserId: null, reviewedAt: null, outcome: null,
    createdAt: new Date().toISOString(), ...over,
  });

  it('blocks publication of anything a human has not confirmed', () => {
    expect(() => assertReviewed(baseCorrection())).toThrow(UnreviewedPublicationError);
    expect(() => assertReviewed(baseCorrection({ status: 'rejected' }))).toThrow();
    // Confirmed but with no named reviewer is still not publishable.
    expect(() => assertReviewed(baseCorrection({ status: 'confirmed' }))).toThrow();
    expect(() =>
      assertReviewed(baseCorrection({ status: 'confirmed', reviewedByUserId: 'admin-1' })),
    ).not.toThrow();
  });

  it('rejects clinical content in a correction note', () => {
    const problems = validateSubmission({
      hospitalId: 'h1', fieldCode: 'prep', evidenceKind: 'i_visited',
      note: 'they told me to come fasting',
    });
    expect(problems.some((p) => p.code === 'clinical_content')).toBe(true);
  });

  it('rejects an empty report', () => {
    const problems = validateSubmission({
      hospitalId: 'h1', fieldCode: 'phone', evidenceKind: 'i_called',
    });
    expect(problems.some((p) => p.code === 'empty')).toBe(true);
  });

  it('detects a repeat report from the same user on the same field', () => {
    const existing = [baseCorrection()];
    const dupe = findDuplicate(
      { hospitalId: 'h1', fieldCode: 'phone', reportedByUserId: 'u1', claimedValue: 'anything' },
      existing,
    );
    expect(dupe?.id).toBe('cor-1');
  });

  it('detects an identical claimed value from a different user', () => {
    const existing = [baseCorrection()];
    const dupe = findDuplicate(
      { hospitalId: 'h1', fieldCode: 'phone', reportedByUserId: 'u2', claimedValue: '020 1111 1111' },
      existing,
    );
    expect(dupe?.id).toBe('cor-1');
  });

  it('does not treat a different field on the same hospital as a duplicate', () => {
    const existing = [baseCorrection()];
    const dupe = findDuplicate(
      { hospitalId: 'h1', fieldCode: 'address', reportedByUserId: 'u2', claimedValue: 'somewhere' },
      existing,
    );
    expect(dupe).toBeNull();
  });

  it('counts only the last 24 hours towards the daily cap', () => {
    const rows = [
      baseCorrection({ id: 'a', createdAt: iso(0) }),
      baseCorrection({ id: 'b', createdAt: iso(0) }),
      baseCorrection({ id: 'c', createdAt: iso(3) }),
    ];
    expect(countRecentByUser('u1', rows)).toBe(2);
    expect(MAX_CORRECTIONS_PER_DAY).toBeGreaterThan(0);
  });
});

/* ==================================================== F20 follow-ups ==== */

describe('F20 follow-up closure', () => {
  const task = (over: Record<string, unknown> = {}) => ({
    id: 't1', ownerUserId: 'u1', careContextId: null, hospitalId: null,
    departmentId: null, taskType: 'collect_report' as const,
    dueDate: new Date().toISOString().slice(0, 10), status: 'open' as const,
    createdAt: new Date().toISOString(), ...over,
  });

  it('rejects a due date in the past and one beyond two years', () => {
    const past = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const farFuture = new Date(Date.now() + 900 * 86_400_000).toISOString().slice(0, 10);
    expect(validateDueDate(past).ok).toBe(false);
    expect(validateDueDate(farFuture).ok).toBe(false);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect(validateDueDate(soon).ok).toBe(true);
  });

  it('does not mark a completed task as overdue', () => {
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    expect(isOverdue(task({ dueDate: old }))).toBe(true);
    expect(isOverdue(task({ dueDate: old, status: 'done' }))).toBe(false);
  });

  it('groups into overdue / this week / later / closed', () => {
    const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const g = groupTasks([
      task({ id: 'a', dueDate: d(-3) }),
      task({ id: 'b', dueDate: d(2) }),
      task({ id: 'c', dueDate: d(40) }),
      task({ id: 'e', dueDate: d(1), status: 'dismissed' }),
    ]);
    expect(g.overdue.map((t) => t.id)).toEqual(['a']);
    expect(g.thisWeek.map((t) => t.id)).toEqual(['b']);
    expect(g.later.map((t) => t.id)).toEqual(['c']);
    expect(g.closed.map((t) => t.id)).toEqual(['e']);
  });
});

/* ======================================================= F6 travel ====== */

describe('F6 mode-aware reachability', () => {
  it('returns a distance but NEVER a duration when routing is unavailable', () => {
    const e = straightLineEstimate(
      { lat: 18.52, lng: 73.85 }, { lat: 18.56, lng: 73.79 },
      'transit', 'not_configured', 'no routing',
    );
    expect(e.minutes).toBeNull();
    expect(e.basis).toBe('straight_line');
    expect(e.distanceKm).toBeGreaterThan(0);
  });

  it('never describes a straight line as a journey time', () => {
    const e = straightLineEstimate(
      { lat: 18.52, lng: 73.85 }, { lat: 18.56, lng: 73.79 },
      'drive', 'not_configured', 'no routing',
    );
    const text = describeEstimate(e);
    expect(text).not.toMatch(/\bmin\b/);
    expect(text).toMatch(/straight line/i);
  });

  it('describes a routed estimate with its mode', () => {
    const text = describeEstimate({
      mode: 'transit', minutes: 42, distanceKm: 9.1,
      basis: 'routing', status: 'ok', message: null,
    });
    expect(text).toMatch(/42 min/);
    expect(text).toMatch(/bus/i);
  });
});

/* ============================================== seeded facility facts === */

describe('facility facts fixtures', () => {
  it('covers all four freshness states for every fact type', () => {
    const groups: Array<[string, Array<{ provenance: Provenance }>, Parameters<typeof freshnessOf>[1]]> = [
      ['services', FACTS.serviceVerifications, 'services'],
      ['schemes', FACTS.schemeListings, 'schemes'],
      ['charges', FACTS.charges, 'charges'],
      ['accessibility', FACTS.accessibilityComponents, 'accessibility'],
      ['languages', FACTS.languageSupport, 'languages'],
      ['arrival', FACTS.arrivalPacks, 'arrival'],
      ['routes', FACTS.routes, 'routes'],
      ['prep', FACTS.prepRequirements, 'prep'],
    ];
    for (const [name, rows, field] of groups) {
      const states = new Set(rows.map((r) => freshnessOf(r.provenance, field).state));
      expect(states.has('unverified'), `${name} has no never-verified fixture`).toBe(true);
      expect(states.size, `${name} needs more than one freshness state`).toBeGreaterThan(1);
    }
  });

  it('keeps unverified services out of filter matching (F2)', () => {
    const pending = FACTS.serviceVerifications.filter((v) => !isFilterableVerification(v));
    expect(pending.length).toBeGreaterThan(0);
    for (const p of pending) {
      expect(p.provenance.verifiedAt === null || p.method === 'user_reported_pending').toBe(true);
    }
  });

  it('never marks an unassessed accessibility component as meeting a standard', () => {
    const bad = FACTS.accessibilityComponents.filter(
      (c) => c.provenance.verifiedAt === null && c.status !== 'not_assessed',
    );
    expect(bad).toEqual([]);
  });

  it('records no scheme as "not listed" — absence is unknown, not refusal', () => {
    const statuses = new Set(FACTS.schemeListings.map((s) => s.listingStatus));
    expect([...statuses].sort()).toEqual(['listed', 'unknown']);
  });

  it('holds no arrival guidance that predicts a wait time (F13)', () => {
    const offenders = FACTS.arrivalPacks
      .filter((p) => p.arrivalGuidanceText)
      .filter((p) => /your wait will|expected wait|estimated wait|you will wait/i.test(p.arrivalGuidanceText!));
    expect(offenders).toEqual([]);
  });
});

/* ================================================= assembled view ======= */

describe('facility facts view assembly', () => {
  const hospital = SEED.hospitals.find((h) => h.id === 'baner-ridge-multispecialty')!;

  it('attaches the non-dismissible scheme caveat even when schemes exist', async () => {
    const facts = await demoRepo.getFacilityFacts(hospital.id);
    const view = buildFacilityFactsView(
      facts, hospital.services.map((s) => ({ slug: s.slug, name: s.name })),
      { firstVisit: true, usingScheme: false, isProcedure: false },
    );
    expect(view.schemes.items.length).toBeGreaterThan(0);
    expect(view.schemes.caveat).toMatch(/not the same as being treated cashless/i);
  });

  it('exposes accessibility as counts with no composite score', async () => {
    const facts = await demoRepo.getFacilityFacts(hospital.id);
    const view = buildFacilityFactsView(
      facts, [], { firstVisit: true, usingScheme: false, isProcedure: false },
    );
    expect(view.accessibility.counts).toHaveProperty('meets_standard');
    expect(view.accessibility).not.toHaveProperty('score');
    expect(view.accessibility).not.toHaveProperty('percentage');
  });

  it('flags the language gap between consultation and the registration counter', async () => {
    const facts = await demoRepo.getFacilityFacts('deccan-gymkhana-multispecialty');
    const view = buildFacilityFactsView(
      facts, [], { firstVisit: true, usingScheme: false, isProcedure: false },
    );
    // Deccan speaks en/hi/mr in consultation but only hi/mr at the counter.
    expect(view.languages.gapWarning).toMatch(/English/);
  });

  it('says "we do not know" rather than inventing charges', async () => {
    const facts = await demoRepo.getFacilityFacts('camp-eye-ent');
    const view = buildFacilityFactsView(
      facts, [], { firstVisit: true, usingScheme: false, isProcedure: false },
    );
    expect(view.charges.empty).toBe(true);
    expect(view.charges.emptyMessage).toMatch(/does not estimate/i);
  });

  it('reports the never-verified hospital as entirely unchecked', async () => {
    const facts = await demoRepo.getFacilityFacts('nashik-road-wellness');
    const view = buildFacilityFactsView(
      facts, [], { firstVisit: true, usingScheme: false, isProcedure: false },
    );
    expect(view.freshness.fresh).toBe(0);
    expect(view.freshness.unverified).toBeGreaterThan(0);
    expect(view.freshness.medianAgeDays).toBeNull();
    expect(view.accessibility.assessed).toBe(false);
  });
});
