/**
 * HTTP-level tests for the journey-layer endpoints, against a RUNNING dev
 * server. These are the checks that only mean something with real route
 * handlers, cookies and session middleware in the loop:
 *
 *   - cross-patient isolation of care contexts, visits and reminders
 *   - admin-only access to the correction queue
 *   - the F17 invariant that a submitted correction is never published
 *   - the F11 guarantee that a visit card carries no Google content
 *
 * If no server is listening the suite SKIPS loudly rather than passing
 * silently — a green run full of skips is not a pass.
 *
 *   npm run dev      # in one shell
 *   npm run test     # in another
 */
import { beforeAll, describe, expect, it } from 'vitest';

const BASE = process.env.FLOWCARE_TEST_BASE_URL ?? 'http://127.0.0.1:3000';

// Probed at module load: `it.runIf` is evaluated during collection, so a
// beforeAll hook would run too late and everything would report "skipped".
const serverUp = await (async () => {
  try {
    const r = await fetch(`${BASE}/api/config`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
})();

if (!serverUp) {
  console.warn(
    `\n[api.journey] SKIPPED: no FlowCare server responding at ${BASE}.\n` +
    '               Start one with `npm run dev` and re-run.\n',
  );
}

async function api(path: string, init: RequestInit = {}, retriesOn429 = 2) {
  let res = await fetch(`${BASE}${path}`, { ...init, redirect: 'manual' });
  while (res.status === 429 && retriesOn429-- > 0) {
    const wait = Number(res.headers.get('retry-after') ?? '1') * 1000 + 250;
    await new Promise((r) => setTimeout(r, Math.min(wait, 3_000)));
    res = await fetch(`${BASE}${path}`, { ...init, redirect: 'manual' });
  }
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* html or binary */ }
  return { res, text, json };
}

async function signIn(account: 'patient' | 'patient2' | 'staff' | 'admin'): Promise<string> {
  const res = await fetch(`${BASE}/api/demo-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0];
}

const json = (cookie?: string) => ({
  'Content-Type': 'application/json',
  ...(cookie ? { Cookie: cookie } : {}),
});

const HOSPITAL = 'baner-ridge-multispecialty';

/* ==================================================== public surface ==== */

/**
 * Start each HTTP file from the seeded baseline with empty rate-limit
 * buckets, so results do not depend on what a previous file (or a previous
 * run) happened to leave behind. Demo-mode only; a no-op if the endpoint is
 * absent.
 */
beforeAll(async () => {
  if (!serverUp) return;
  try {
    const admin = await signIn('admin');
    await fetch(`${BASE}/api/demo-reset`, { method: 'POST', headers: { Cookie: admin } });
  } catch { /* best effort */ }
});

describe('API journey: public fact surface', () => {
  it.runIf(serverUp)('serves facility facts with per-field provenance', async () => {
    const { res, json: j } = await api(`/api/hospitals/${HOSPITAL}/facts`);
    expect(res.status).toBe(200);
    const facts = j.data.facts;
    expect(facts.freshness.total).toBeGreaterThan(0);
    expect(facts.schemes.caveat).toMatch(/cashless/i);
    expect(facts.charges.caveat).toMatch(/does not predict/i);
    expect(facts.prep.notice).toMatch(/ask the hospital/i);
  });

  it.runIf(serverUp)('never reports a composite accessibility score', async () => {
    const { json: j } = await api(`/api/hospitals/${HOSPITAL}/facts`);
    const a = j.data.facts.accessibility;
    expect(a).toHaveProperty('counts');
    expect(a).not.toHaveProperty('score');
    expect(a).not.toHaveProperty('percentage');
    expect(a).not.toHaveProperty('grade');
  });

  it.runIf(serverUp)('reports the never-verified hospital as unchecked', async () => {
    const { json: j } = await api('/api/hospitals/nashik-road-wellness/facts');
    expect(j.data.facts.freshness.fresh).toBe(0);
    expect(j.data.facts.freshness.unverified).toBeGreaterThan(0);
    expect(j.data.facts.accessibility.assessed).toBe(false);
  });

  it.runIf(serverUp)('404s for an unknown hospital', async () => {
    const { res } = await api('/api/hospitals/not-a-real-hospital/facts');
    expect(res.status).toBe(404);
  });

  it.runIf(serverUp)('translates lay terms to several departments', async () => {
    const { res, json: j } = await api('/api/translate?q=chest%20pain');
    expect(res.status).toBe(200);
    expect(j.data.translations[0].departments.length).toBeGreaterThanOrEqual(2);
  });

  it.runIf(serverUp)('returns an emergency notice for emergency wording', async () => {
    const { json: j } = await api('/api/translate?q=having%20a%20heart%20attack');
    expect(j.data.emergency).toBe(true);
    expect(j.data.emergencyNotice).toMatch(/108/);
  });

  it.runIf(serverUp)('rejects an empty or oversized translate query', async () => {
    expect((await api('/api/translate?q=')).res.status).toBe(400);
    expect((await api(`/api/translate?q=${'a'.repeat(250)}`)).res.status).toBe(400);
  });

  it.runIf(serverUp)('reports F16 as disabled rather than pretending it works', async () => {
    const { res, json: j } = await api(`/api/hospitals/${HOSPITAL}/discrepancies`);
    expect(res.status).toBe(200);
    expect(j.data.enabled).toBe(false);
    expect(j.data.reason).toMatch(/Service Terms/i);
    expect(j.data.discrepancies).toEqual([]);
  });
});

/* ================================================ auth is required ====== */

describe('API journey: unauthenticated access is refused', () => {
  const guarded: Array<[string, RequestInit]> = [
    ['/api/care-contexts', { method: 'GET' }],
    ['/api/care-contexts', { method: 'POST', headers: json(), body: '{"label":"Dad"}' }],
    ['/api/visits', { method: 'GET' }],
    ['/api/followups', { method: 'GET' }],
    ['/api/corrections', { method: 'GET' }],
    [`/api/hospitals/${HOSPITAL}/visit-card`, { method: 'GET' }],
  ];

  for (const [path, init] of guarded) {
    it.runIf(serverUp)(`401s for ${init.method} ${path}`, async () => {
      const { res } = await api(path, init);
      expect(res.status).toBe(401);
    });
  }
});

/* ============================================ cross-patient isolation === */

describe('API journey: one patient cannot reach another patient data', () => {
  it.runIf(serverUp)('care contexts are invisible across accounts', async () => {
    const a = await signIn('patient');
    const b = await signIn('patient2');

    const created = await api('/api/care-contexts', {
      method: 'POST',
      headers: json(a),
      body: JSON.stringify({ label: `Isolation probe ${Date.now()}` }),
    });
    expect(created.res.status).toBe(201);
    const id = created.json.data.careContext.id;

    const mine = await api('/api/care-contexts', { headers: { Cookie: a } });
    expect(mine.json.data.careContexts.some((c: any) => c.id === id)).toBe(true);

    const theirs = await api('/api/care-contexts', { headers: { Cookie: b } });
    expect(theirs.json.data.careContexts.some((c: any) => c.id === id)).toBe(false);

    // And patient2 deleting by id must not remove patient1's row.
    await api(`/api/care-contexts/${id}`, { method: 'DELETE', headers: { Cookie: b } });
    const stillMine = await api('/api/care-contexts', { headers: { Cookie: a } });
    expect(stillMine.json.data.careContexts.some((c: any) => c.id === id)).toBe(true);

    await api(`/api/care-contexts/${id}`, { method: 'DELETE', headers: { Cookie: a } });
  });

  it.runIf(serverUp)('visit records are invisible across accounts', async () => {
    const a = await signIn('patient');
    const b = await signIn('patient2');

    const created = await api('/api/visits', {
      method: 'POST',
      headers: json(a),
      body: JSON.stringify({ hospitalId: HOSPITAL, visitDate: '2026-01-15' }),
    });
    expect(created.res.status).toBe(201);
    const id = created.json.data.visit.id;

    const theirs = await api('/api/visits', { headers: { Cookie: b } });
    expect(theirs.json.data.visits.some((v: any) => v.id === id)).toBe(false);

    await api(`/api/visits/${id}`, { method: 'DELETE', headers: { Cookie: b } });
    const stillMine = await api('/api/visits', { headers: { Cookie: a } });
    expect(stillMine.json.data.visits.some((v: any) => v.id === id)).toBe(true);

    await api(`/api/visits/${id}`, { method: 'DELETE', headers: { Cookie: a } });
  });

  it.runIf(serverUp)('follow-up reminders cannot be updated by another account', async () => {
    const a = await signIn('patient');
    const b = await signIn('patient2');
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    const created = await api('/api/followups', {
      method: 'POST',
      headers: json(a),
      body: JSON.stringify({ taskType: 'collect_report', dueDate: due }),
    });
    expect(created.res.status).toBe(201);
    const id = created.json.data.task.id;

    const hijack = await api(`/api/followups/${id}`, {
      method: 'PATCH',
      headers: json(b),
      body: JSON.stringify({ status: 'done' }),
    });
    expect(hijack.res.status).toBe(404);

    const mine = await api('/api/followups', { headers: { Cookie: a } });
    expect(mine.json.data.tasks.find((t: any) => t.id === id).status).toBe('open');

    await api(`/api/followups/${id}`, { method: 'DELETE', headers: { Cookie: a } });
  });
});

/* ================================================== input validation ==== */

describe('API journey: input validation', () => {
  it.runIf(serverUp)('rejects a care context label containing health details', async () => {
    const a = await signIn('patient');
    const { res, json: j } = await api('/api/care-contexts', {
      method: 'POST',
      headers: json(a),
      body: JSON.stringify({ label: 'Mum diabetes insulin' }),
    });
    expect(res.status).toBe(400);
    expect(j.error.message).toMatch(/health/i);
  });

  it.runIf(serverUp)('rejects unknown keys on a care context (strict schema)', async () => {
    const a = await signIn('patient');
    const { res } = await api('/api/care-contexts', {
      method: 'POST',
      headers: json(a),
      body: JSON.stringify({ label: 'Dad', condition: 'diabetes' }),
    });
    expect(res.status).toBe(400);
  });

  it.runIf(serverUp)('rejects a follow-up type outside the closed enum', async () => {
    const a = await signIn('patient');
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const { res } = await api('/api/followups', {
      method: 'POST',
      headers: json(a),
      body: JSON.stringify({ taskType: 'chemotherapy_round', dueDate: due }),
    });
    expect(res.status).toBe(400);
  });

  it.runIf(serverUp)('rejects a follow-up due date in the past', async () => {
    const a = await signIn('patient');
    const past = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    const { res } = await api('/api/followups', {
      method: 'POST',
      headers: json(a),
      body: JSON.stringify({ taskType: 'collect_report', dueDate: past }),
    });
    expect(res.status).toBe(400);
  });

  it.runIf(serverUp)('rejects a travel request with out-of-range coordinates', async () => {
    const { res } = await api('/api/travel', {
      method: 'POST',
      headers: json(),
      body: JSON.stringify({ hospitalId: HOSPITAL, origin: { lat: 999, lng: 0 } }),
    });
    expect(res.status).toBe(400);
  });

  it.runIf(serverUp)('never invents a journey time when routing is unconfigured', async () => {
    const { res, json: j } = await api('/api/travel', {
      method: 'POST',
      headers: json(),
      body: JSON.stringify({ hospitalId: HOSPITAL, origin: { lat: 18.52, lng: 73.85 } }),
    });
    expect(res.status).toBe(200);
    for (const e of j.data.estimates) {
      expect(e.minutes).toBeNull();
      expect(e.basis).toBe('straight_line');
      expect(e.distanceKm).toBeGreaterThan(0);
    }
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });
});

/* ============================================ F17 correction workflow === */

describe('API journey: corrections are never self-publishing', () => {
  /**
   * The F17 daily cap (5 reports per user per day) and the per-minute rate
   * limit are both real controls, so this block resets before it runs rather
   * than inheriting whatever budget earlier tests consumed.
   */
  beforeAll(async () => {
    if (!serverUp) return;
    const admin = await signIn('admin');
    await api('/api/demo-reset', { method: 'POST', headers: { Cookie: admin } });
  });

  it.runIf(serverUp)('stores a submission as pending and says so', async () => {
    const a = await signIn('patient');
    const { res, json: j } = await api('/api/corrections', {
      method: 'POST',
      headers: json(a),
      body: JSON.stringify({
        hospitalId: HOSPITAL,
        fieldCode: 'phone',
        evidenceKind: 'i_called',
        claimedValue: `020 5555 ${String(Date.now()).slice(-4)}`,
      }),
    });
    expect(res.status).toBe(201);
    expect(j.data.correction.status).toBe('pending');
    expect(j.data.correction.reviewedByUserId).toBeNull();
    expect(j.data.published).toBe(false);
    expect(j.data.acknowledgement).toMatch(/person/i);
  });

  it.runIf(serverUp)('rejects a correction carrying clinical advice', async () => {
    const a = await signIn('patient');
    const { res, json: j } = await api('/api/corrections', {
      method: 'POST',
      headers: json(a),
      body: JSON.stringify({
        hospitalId: HOSPITAL,
        fieldCode: 'prep',
        evidenceKind: 'i_visited',
        note: 'they said come fasting from midnight',
      }),
    });
    expect(res.status).toBe(400);
    expect(j.error.message).toMatch(/medical|hospital/i);
  });

  it.runIf(serverUp)('marks an immediate repeat as a duplicate', async () => {
    // patient2 so that this pair does not eat into patient's daily budget.
    const a = await signIn('patient2');
    const value = `020 7777 ${String(Date.now()).slice(-4)}`;
    const body = JSON.stringify({
      hospitalId: HOSPITAL, fieldCode: 'address', evidenceKind: 'i_visited', claimedValue: value,
    });
    await api('/api/corrections', { method: 'POST', headers: json(a), body });
    const second = await api('/api/corrections', { method: 'POST', headers: json(a), body });
    expect(second.json.data.correction.status).toBe('duplicate');
  }, 15_000);

  it.runIf(serverUp)('a reporter sees only their own reports', async () => {
    const a = await signIn('patient');
    const b = await signIn('patient2');
    const marker = `own-report-${Date.now()}`;

    await api('/api/corrections', {
      method: 'POST',
      headers: json(a),
      body: JSON.stringify({
        hospitalId: HOSPITAL, fieldCode: 'hours', evidenceKind: 'saw_a_notice', note: marker,
      }),
    });

    const theirs = await api('/api/corrections', { headers: { Cookie: b } });
    expect(theirs.json.data.corrections.some((c: any) => c.note === marker)).toBe(false);
  });

  it.runIf(serverUp)('blocks non-admins from the review queue', async () => {
    const patient = await signIn('patient');
    const staff = await signIn('staff');
    expect((await api('/api/admin/corrections', { headers: { Cookie: patient } })).res.status)
      .toBeGreaterThanOrEqual(401);
    expect((await api('/api/admin/corrections', { headers: { Cookie: staff } })).res.status)
      .toBeGreaterThanOrEqual(401);
  });

  it.runIf(serverUp)('blocks a non-admin from deciding a correction', async () => {
    const patient = await signIn('patient');
    const { res } = await api('/api/admin/corrections', {
      method: 'POST',
      headers: json(patient),
      body: JSON.stringify({ correctionId: 'anything', decision: 'confirmed' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it.runIf(serverUp)('records a named reviewer when an admin confirms', async () => {
    const patient = await signIn('patient2');
    const admin = await signIn('admin');

    const created = await api('/api/corrections', {
      method: 'POST',
      headers: json(patient),
      body: JSON.stringify({
        hospitalId: HOSPITAL,
        fieldCode: 'services',
        evidenceKind: 'i_work_here',
        claimedValue: `MRI moved to block C ${Date.now()}`,
      }),
    });
    const id = created.json.data.correction.id;

    const decided = await api('/api/admin/corrections', {
      method: 'POST',
      headers: json(admin),
      body: JSON.stringify({ correctionId: id, decision: 'confirmed', outcome: 'called and confirmed' }),
    });
    expect(decided.res.status).toBe(200);
    expect(decided.json.data.correction.status).toBe('confirmed');
    expect(decided.json.data.correction.reviewedByUserId).toBeTruthy();
    expect(decided.json.data.correction.reviewedAt).toBeTruthy();
  });

  it.runIf(serverUp)('enforces the daily reporting cap per account', async () => {
    const admin = await signIn('admin');
    await api('/api/demo-reset', { method: 'POST', headers: { Cookie: admin } });

    const a = await signIn('patient');
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const { res } = await api('/api/corrections', {
        method: 'POST',
        headers: json(a),
        body: JSON.stringify({
          hospitalId: HOSPITAL,
          fieldCode: 'hours',
          evidenceKind: 'saw_a_notice',
          claimedValue: `cap probe ${i} ${Date.now()}`,
        }),
      });
      statuses.push(res.status);
    }
    // The cap is 5 per day, so the tail of this burst must be refused.
    expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(5);
    expect(statuses.at(-1)).toBe(429);

    // Leave a clean slate for anything that runs after this file.
    await api('/api/demo-reset', { method: 'POST', headers: { Cookie: admin } });
  }, 20_000);

  it.runIf(serverUp)('404s when deciding a correction that does not exist', async () => {
    const admin = await signIn('admin');
    const { res } = await api('/api/admin/corrections', {
      method: 'POST',
      headers: json(admin),
      body: JSON.stringify({ correctionId: 'cor-does-not-exist', decision: 'rejected' }),
    });
    expect(res.status).toBe(404);
  });
});

/* ================================================== F11 visit card ===== */

describe('API journey: offline visit card', () => {
  it.runIf(serverUp)('contains no Google content and says so', async () => {
    const a = await signIn('patient');
    const { res, json: j, text } = await api(`/api/hospitals/${HOSPITAL}/visit-card`, {
      headers: { Cookie: a },
    });
    expect(res.status).toBe(200);
    const card = j.data.card;
    expect(card.containsGoogleContent).toBe(false);
    expect(card.sourceNotice).toMatch(/not from Google/i);

    // Structural check: no Google-shaped field survived into the payload.
    expect(text).not.toMatch(/googleMapsUri|userRatingCount|photoUri|places\.googleapis/i);
    expect(card.hospital).not.toHaveProperty('rating');
  });

  it.runIf(serverUp)('carries the gate, the counter and the checklist', async () => {
    const a = await signIn('patient');
    const { json: j } = await api(`/api/hospitals/${HOSPITAL}/visit-card`, {
      headers: { Cookie: a },
    });
    const card = j.data.card;
    expect(card.arrival.gateLabel).toBeTruthy();
    expect(card.arrival.firstCounter).toBeTruthy();
    expect(card.checklist.length).toBeGreaterThan(0);
    expect(card.checklistNotice).toMatch(/documents and payments only/i);
  });
});

/* ==================================================== page rendering === */

describe('Pages: journey surfaces render', () => {
  const pages = ['/care', '/visit/baner-ridge-multispecialty', '/admin/corrections'];

  for (const path of pages) {
    it.runIf(serverUp)(`${path} renders the app, not an error page`, async () => {
      const { res, text } = await api(path);
      expect(res.status).toBe(200);
      expect(text).toMatch(/FlowCare/);
      // Next's dev error page is valid HTML with a 200, so assert its absence.
      expect(text).not.toMatch(/Unhandled Runtime Error|__NEXT_ERROR__|Application error/i);
    });
  }
});
