/**
 * LIVE tests for migration 0008 — user API keys and agent proposals.
 *
 * The load-bearing assertions here are the ones that prove the agentic
 * workflow cannot write without a human:
 *
 *   - a proposal does nothing until confirmed
 *   - confirming takes an ID, so a payload cannot be smuggled in
 *   - an expired proposal cannot be confirmed
 *   - a proposal cannot be confirmed twice
 *   - one user cannot confirm another user's proposal
 *   - one user cannot read another user's key, even as ciphertext
 *
 *   npm run test:live
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import ws from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

function envLocal(): Record<string, string> {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const E = envLocal();
const ENABLED =
  process.env.FLOWCARE_LIVE_DB === '1' &&
  Boolean(E.NEXT_PUBLIC_SUPABASE_URL && E.NEXT_PUBLIC_SUPABASE_ANON_KEY && E.SUPABASE_DB_PASSWORD);
const d = ENABLED ? describe : describe.skip;

const URL = E.NEXT_PUBLIC_SUPABASE_URL;
const ANON = E.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const A = { email: 'flowcare-ag-a@example.com', password: 'Ag-Alpha-5t8p!' };
const B = { email: 'flowcare-ag-b@example.com', password: 'Ag-Bravo-3k9w!' };

function client(): SupabaseClient {
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: ws as unknown as never },
  });
}

async function signIn(creds: { email: string; password: string }) {
  const c = client();
  const { error } = await c.auth.signInWithPassword(creds);
  if (error) {
    const up = await c.auth.signUp(creds);
    if (up.error) throw new Error(`signUp: ${up.error.message}`);
    if (!up.data.session) {
      const r = await c.auth.signInWithPassword(creds);
      if (r.error) throw new Error(`signIn: ${r.error.message}`);
    }
  }
  const { data } = await c.auth.getUser();
  return { c, id: data.user!.id };
}

d('live agent + keys', () => {
  let a: SupabaseClient, b: SupabaseClient;
  let aId: string, bId: string;
  let db: pg.Client;
  let slotId: string;

  const payload = () => ({
    slotId,
    hospitalName: 'Fixture Hospital',
    departmentName: 'General Medicine',
    patientName: 'Agent Fixture',
    agentVersion: 'fc-agent-v1',
  });

  beforeAll(async () => {
    ({ c: a, id: aId } = await signIn(A));
    ({ c: b, id: bId } = await signIn(B));

    db = new pg.Client({
      host: E.SUPABASE_DB_HOST || `aws-0-${E.SUPABASE_DB_REGION || 'ap-northeast-1'}.pooler.supabase.com`,
      port: Number(E.SUPABASE_DB_PORT || 5432),
      user: `postgres.${E.SUPABASE_PROJECT_REF}`,
      password: E.SUPABASE_DB_PASSWORD,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 20_000,
    });
    await db.connect();

    slotId = (
      await db.query(
        `select s.id from public.slots s
           join public.departments d on d.id = s.department_id
           join public.hospitals h on h.id = d.hospital_id
          where h.booking_integrated limit 1`,
      )
    ).rows[0].id;

    const ids = [aId, bId];
    await db.query('delete from public.agent_proposals where owner_id = any($1::uuid[])', [ids]);
    await db.query('delete from public.user_ai_keys where owner_id = any($1::uuid[])', [ids]);
  }, 90_000);

  afterAll(async () => {
    if (db) {
      await db.query('delete from public.agent_proposals where owner_id = any($1::uuid[])', [[aId, bId]]);
      await db.query('delete from public.user_ai_keys where owner_id = any($1::uuid[])', [[aId, bId]]);
      await db.end();
    }
  });

  // ------------------------------------------------------------- API keys
  it('a stored key is private to its owner', async () => {
    const { error } = await a.rpc('save_ai_key', {
      p_provider: 'gemini',
      p_ciphertext: 'BASE64CIPHERTEXTPLACEHOLDER==',
      p_hint: 'ab12',
      p_label: 'my key',
    });
    expect(error).toBeNull();

    const mine = await a.from('user_ai_keys').select('provider,key_hint,status');
    expect(mine.data!.length).toBe(1);
    expect(mine.data![0].status).toBe('unvalidated');

    // B cannot see it, not even the ciphertext
    const theirs = await b.from('user_ai_keys').select('ciphertext').eq('owner_id', aId);
    expect(theirs.data).toEqual([]);
  });

  it('a newly saved key is never marked valid without a real provider call', async () => {
    const row = await a.from('user_ai_keys').select('status,last_validated_at').eq('provider', 'gemini').single();
    expect(row.data!.status).toBe('unvalidated');
    expect(row.data!.last_validated_at).toBeNull();
  });

  it('replacing a key resets any previous validation result', async () => {
    await a.rpc('mark_ai_key', { p_provider: 'gemini', p_ok: true, p_error: null });
    expect((await a.from('user_ai_keys').select('status').eq('provider', 'gemini').single()).data!.status).toBe('valid');

    await a.rpc('save_ai_key', {
      p_provider: 'gemini', p_ciphertext: 'NEWCIPHERTEXTVALUE1234==', p_hint: 'cd34',
    });
    const after = await a.from('user_ai_keys').select('status,last_validated_at,key_hint').eq('provider', 'gemini').single();
    expect(after.data!.status).toBe('unvalidated');
    expect(after.data!.last_validated_at).toBeNull();
    expect(after.data!.key_hint).toBe('cd34');
  });

  it('rejects an unknown provider and a malformed hint', async () => {
    const badProvider = await a.rpc('save_ai_key', {
      p_provider: 'skynet', p_ciphertext: 'XXXXXXXXXXXXXXXX', p_hint: 'ab12',
    });
    expect(badProvider.error).not.toBeNull();

    const badHint = await a.rpc('save_ai_key', {
      p_provider: 'openai', p_ciphertext: 'XXXXXXXXXXXXXXXX', p_hint: 'not a hint!',
    });
    expect(badHint.error).not.toBeNull();
    expect(badHint.error!.message).toContain('INVALID_INPUT');
  });

  it('one key per provider per user, not a growing pile', async () => {
    await a.rpc('save_ai_key', { p_provider: 'openai', p_ciphertext: 'CIPHER1CIPHER1CIPHER', p_hint: 'aaaa' });
    await a.rpc('save_ai_key', { p_provider: 'openai', p_ciphertext: 'CIPHER2CIPHER2CIPHER', p_hint: 'bbbb' });
    const rows = await a.from('user_ai_keys').select('provider').eq('provider', 'openai');
    expect(rows.data!.length).toBe(1);
  });

  it('a deleted key is gone', async () => {
    await a.rpc('delete_ai_key', { p_provider: 'openai' });
    expect((await a.from('user_ai_keys').select('id').eq('provider', 'openai')).data).toEqual([]);
    const again = await a.rpc('delete_ai_key', { p_provider: 'openai' });
    expect(again.error).not.toBeNull();
    expect(again.error!.message).toContain('NOT_FOUND');
  });

  // ------------------------------------------------- agent write boundary
  it('a proposal is inert until confirmed', async () => {
    const before = (await db.query('select count(*)::int n from public.appointments')).rows[0].n;

    const { data, error } = await a.rpc('create_agent_proposal', {
      p_kind: 'book_appointment',
      p_payload: payload(),
      p_summary: 'Request an appointment for Agent Fixture.',
      p_ttl_seconds: 600,
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.status).toBe('pending');

    // creating a proposal must not have booked anything
    const after = (await db.query('select count(*)::int n from public.appointments')).rows[0].n;
    expect(after).toBe(before);

    await a.rpc('close_agent_proposal', { p_id: row.id, p_status: 'cancelled' });
  });

  it('confirmation takes an id, so a payload cannot be smuggled in', async () => {
    const { data } = await a.rpc('create_agent_proposal', {
      p_kind: 'book_appointment', p_payload: payload(), p_summary: 'Original request.',
    });
    const row = Array.isArray(data) ? data[0] : data;

    // There is no parameter through which a caller could substitute a
    // different slot, name or hospital at confirmation time.
    const args = await db.query(
      `select pg_get_function_identity_arguments(p.oid) a
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='confirm_agent_proposal'`,
    );
    expect(args.rows[0].a).toBe('p_id uuid');

    const confirmed = await a.rpc('confirm_agent_proposal', { p_id: row.id });
    expect(confirmed.error).toBeNull();
    // the stored payload is unchanged by confirmation
    const stored = await db.query('select payload, status from public.agent_proposals where id=$1', [row.id]);
    expect(stored.rows[0].payload.slotId).toBe(slotId);
    expect(stored.rows[0].status).toBe('confirmed');
  });

  it('a proposal cannot be confirmed twice', async () => {
    const { data } = await a.rpc('create_agent_proposal', {
      p_kind: 'book_appointment', p_payload: payload(), p_summary: 'Once only.',
    });
    const row = Array.isArray(data) ? data[0] : data;

    expect((await a.rpc('confirm_agent_proposal', { p_id: row.id })).error).toBeNull();
    const second = await a.rpc('confirm_agent_proposal', { p_id: row.id });
    expect(second.error).not.toBeNull();
    expect(second.error!.message).toContain('INVALID_TRANSITION');
  });

  it('an expired proposal cannot be confirmed', async () => {
    const { data } = await a.rpc('create_agent_proposal', {
      p_kind: 'book_appointment', p_payload: payload(), p_summary: 'Stale.',
    });
    const row = Array.isArray(data) ? data[0] : data;

    // move the clock past the window (created_at must stay before expires_at)
    await db.query(
      `update public.agent_proposals
          set created_at = now() - interval '2 hours',
              expires_at = now() - interval '1 minute'
        where id = $1`,
      [row.id],
    );

    // Expiry is reported as a returned status, not as a raised error: a raise
    // would roll back the UPDATE that records the expiry.
    const late = await a.rpc('confirm_agent_proposal', { p_id: row.id });
    expect(late.error).toBeNull();
    const out = Array.isArray(late.data) ? late.data[0] : late.data;
    expect(out.status).toBe('expired');

    // and it is actually persisted, not just reported
    const after = await db.query('select status from public.agent_proposals where id=$1', [row.id]);
    expect(after.rows[0].status).toBe('expired');

    // an expired proposal can never later become confirmed
    const retry = await a.rpc('confirm_agent_proposal', { p_id: row.id });
    expect(retry.error).not.toBeNull();
    expect(retry.error!.message).toContain('INVALID_TRANSITION');
  });

  it('one user cannot confirm another user\'s proposal', async () => {
    const { data } = await a.rpc('create_agent_proposal', {
      p_kind: 'book_appointment', p_payload: payload(), p_summary: 'Mine, not yours.',
    });
    const row = Array.isArray(data) ? data[0] : data;

    const stolen = await b.rpc('confirm_agent_proposal', { p_id: row.id });
    expect(stolen.error).not.toBeNull();
    expect(stolen.error!.message).toContain('NOT_FOUND');

    // and B cannot even see that it exists
    expect((await b.from('agent_proposals').select('id').eq('id', row.id)).data).toEqual([]);

    await a.rpc('close_agent_proposal', { p_id: row.id, p_status: 'cancelled' });
  });

  it('only the two known action kinds are accepted', async () => {
    const bad = await a.rpc('create_agent_proposal', {
      p_kind: 'delete_everything', p_payload: { x: 1 }, p_summary: 'nope',
    });
    expect(bad.error).not.toBeNull();
    expect(bad.error!.message).toContain('INVALID_INPUT');
  });

  it('pending proposals are capped so a user cannot be spammed into confirming', async () => {
    await db.query('delete from public.agent_proposals where owner_id=$1', [aId]);
    for (let i = 0; i < 5; i++) {
      const r = await a.rpc('create_agent_proposal', {
        p_kind: 'book_appointment', p_payload: payload(), p_summary: `Proposal ${i}`,
      });
      expect(r.error).toBeNull();
    }
    const sixth = await a.rpc('create_agent_proposal', {
      p_kind: 'book_appointment', p_payload: payload(), p_summary: 'One too many',
    });
    expect(sixth.error).not.toBeNull();
    expect(sixth.error!.message).toContain('LIMIT_REACHED');
  });

  it('a cancelled proposal records that it was decided', async () => {
    await db.query('delete from public.agent_proposals where owner_id=$1', [aId]);
    const { data } = await a.rpc('create_agent_proposal', {
      p_kind: 'book_appointment', p_payload: payload(), p_summary: 'To discard.',
    });
    const row = Array.isArray(data) ? data[0] : data;

    const closed = await a.rpc('close_agent_proposal', { p_id: row.id, p_status: 'cancelled' });
    expect(closed.error).toBeNull();
    const out = Array.isArray(closed.data) ? closed.data[0] : closed.data;
    expect(out.status).toBe('cancelled');
    expect(out.decided_at).not.toBeNull();
  });
});
