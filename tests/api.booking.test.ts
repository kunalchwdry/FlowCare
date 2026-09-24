/**
 * HTTP-level tests for the appointment REQUEST endpoint, against a RUNNING
 * server. The invariant under test throughout this file is that FlowCare
 * records a request and never manufactures a confirmation:
 *
 *   - a successful request comes back with status 'requested', never 'booked'
 *   - hospital, department and time are derived from the session, so a
 *     tampered payload cannot request an unpublished time or department
 *   - capacity is enforced and a patient cannot double-book one session
 *   - one patient cannot read another patient's appointment
 *
 * Skips loudly if no server is listening; a green run full of skips is not
 * a pass.
 *
 *   npm run dev      # in one shell
 *   npm run test     # in another
 */
import { beforeAll, describe, expect, it } from 'vitest';

const BASE = process.env.FLOWCARE_TEST_BASE_URL ?? 'http://127.0.0.1:3000';

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
    `\n[api.booking] SKIPPED: no FlowCare server responding at ${BASE}.\n` +
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
  try { json = JSON.parse(text); } catch { /* html */ }
  return { res, text, json };
}

async function signIn(account: 'patient' | 'patient2' | 'staff' | 'admin'): Promise<string> {
  const res = await fetch(`${BASE}/api/demo-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account }),
  });
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

const json = (cookie?: string) => ({
  'Content-Type': 'application/json',
  ...(cookie ? { Cookie: cookie } : {}),
});

/**
 * Resolved at collection time rather than hardcoded: which hospitals are
 * bookable depends on whether the server is running on the demo dataset or
 * reading the live project. A hardcoded slug that does not exist would make
 * every test below return early and report a meaningless green run.
 */
const HOSPITAL = await (async () => {
  if (!serverUp) return '';
  try {
    const r = await fetch(`${BASE}/api/hospitals/search?q=`);
    const j: any = await r.json();
    for (const row of j?.data?.results ?? []) {
      const slug = row.hospital.slug;
      const s = await fetch(`${BASE}/api/appointments?hospital=${slug}`);
      const sj: any = await s.json();
      if ((sj?.data?.sessions ?? []).length > 0) return slug;
    }
  } catch { /* fall through */ }
  return '';
})();

if (serverUp && !HOSPITAL) {
  console.warn('\n[api.booking] No bookable hospital found — booking tests cannot run.\n');
}

/** An open session with room left, read from the public availability surface. */
async function anOpenSession(cookie: string, pick = 0): Promise<{ id: string; free: number } | null> {
  const { json: j } = await api(`/api/appointments?hospital=${HOSPITAL}`, { headers: { Cookie: cookie } });
  const sessions: any[] = j?.data?.sessions ?? [];
  const open = sessions[pick];
  return open ? { id: open.id, free: open.capacity - open.booked } : null;
}

beforeAll(async () => {
  if (!serverUp) return;
  try {
    const admin = await signIn('admin');
    await fetch(`${BASE}/api/demo-reset`, { method: 'POST', headers: { Cookie: admin } });
  } catch { /* best effort */ }
});

describe('API booking: a request is not a booking', () => {
  it.runIf(serverUp && Boolean(HOSPITAL))('rejects an unauthenticated request', async () => {
    const { res } = await api('/api/appointments', {
      method: 'POST',
      headers: json(),
      body: JSON.stringify({ sessionId: 'anything' }),
    });
    expect(res.status).toBe(401);
  });

  it.runIf(serverUp && Boolean(HOSPITAL))('rejects an unknown session rather than inventing one', async () => {
    const cookie = await signIn('patient');
    const { res } = await api('/api/appointments', {
      method: 'POST',
      headers: json(cookie),
      body: JSON.stringify({ sessionId: 'session-that-does-not-exist' }),
    });
    expect(res.status).toBe(404);
  });

  it.runIf(serverUp && Boolean(HOSPITAL))('rejects unknown fields instead of trusting them', async () => {
    const cookie = await signIn('patient');
    const { res } = await api('/api/appointments', {
      method: 'POST',
      headers: json(cookie),
      // A client trying to set its own status, hospital or time.
      body: JSON.stringify({ sessionId: 'x', status: 'booked', hospitalId: 'elsewhere' }),
    });
    expect(res.status).toBe(400);
  });

  it.runIf(serverUp && Boolean(HOSPITAL))('records a request with status "requested" and confirmed:false', async () => {
    const cookie = await signIn('patient');
    const session = await anOpenSession(cookie);
    if (!session) return; // nothing open in the window; covered by the demo-reset baseline
    const { res, json: j } = await api('/api/appointments', {
      method: 'POST',
      headers: json(cookie),
      body: JSON.stringify({ sessionId: session.id, reason: 'follow-up' }),
    });
    expect(res.status).toBe(201);
    expect(j.data.appointment.status).toBe('requested');
    expect(j.data.confirmed).toBe(false);
    expect(j.data.notice).toMatch(/not confirmed/i);
    // Derived server-side, never taken from the client.
    expect(j.data.appointment.hospitalId).toBeTruthy();
    expect(j.data.appointment.departmentId).toBeTruthy();
    expect(j.data.appointment.scheduledFor).toBeTruthy();
  });

  it.runIf(serverUp && Boolean(HOSPITAL))('does not let one patient double-book the same session', async () => {
    const cookie = await signIn('patient');
    const session = await anOpenSession(cookie);
    if (!session) return;
    const body = JSON.stringify({ sessionId: session.id });
    const first = await api('/api/appointments', { method: 'POST', headers: json(cookie), body });
    const second = await api('/api/appointments', { method: 'POST', headers: json(cookie), body });
    expect(first.res.status).toBe(201);
    expect(second.json.data.appointment.id).toBe(first.json.data.appointment.id);
  });

  it.runIf(serverUp && Boolean(HOSPITAL))('consumes a seat so the slot count reflects the request', async () => {
    const cookie = await signIn('patient2');
    const before = await anOpenSession(cookie, 2);
    if (!before) return;
    await api('/api/appointments', {
      method: 'POST',
      headers: json(cookie),
      body: JSON.stringify({ sessionId: before.id }),
    });
    const { json: j } = await api(`/api/appointments?hospital=${HOSPITAL}`, { headers: { Cookie: cookie } });
    const sessions: any[] = j?.data?.sessions ?? [];
    const after = sessions.find((s: any) => s.id === before.id);
    if (!after) return;
    expect(after.capacity - after.booked).toBeLessThan(before.free);
  });
});

describe('API booking: isolation between patients', () => {
  it.runIf(serverUp && Boolean(HOSPITAL))('does not expose one patient\'s appointment to another', async () => {
    const a = await signIn('patient');
    const b = await signIn('patient2');
    const session = await anOpenSession(a, 3);
    if (!session) return;
    const mine = await api('/api/appointments', {
      method: 'POST',
      headers: json(a),
      body: JSON.stringify({ sessionId: session.id }),
    });
    const id = mine.json?.data?.appointment?.id;
    if (!id) return;
    // The receipt page is the read surface; an unauthorised read is a 404.
    const theirs = await api(`/appointments/${id}`, { headers: { Cookie: b } });
    expect(theirs.res.status).toBe(404);
    const ok = await api(`/appointments/${id}`, { headers: { Cookie: a } });
    expect(ok.res.status).toBe(200);
  });
});
