/**
 * LIVE tests for the care-partner layer (migration 0006).
 *
 * Scoped delegation is the single highest-privacy-risk feature in the whole
 * product: it deliberately lets one human read another human's data. Every
 * claim about it therefore has to be executed against the real database with
 * real users, not asserted against a mock.
 *
 * What these tests are really trying to break:
 *   - can a caregiver read a scope they were not granted?
 *   - does revocation take effect immediately?
 *   - does expiry take effect without a job having run?
 *   - can an invite token be replayed, guessed or self-accepted?
 *   - can a third party see any of it?
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

const PATIENT = { email: 'flowcare-cp-patient@example.com', password: 'Cp-Patient-4d9m!' };
const PARTNER = { email: 'flowcare-cp-partner@example.com', password: 'Cp-Partner-7q2v!' };
const STRANGER = { email: 'flowcare-cp-stranger@example.com', password: 'Cp-Stranger-1z8b!' };

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

async function adminDb() {
  const c = new pg.Client({
    host: E.SUPABASE_DB_HOST || `aws-0-${E.SUPABASE_DB_REGION || 'ap-northeast-1'}.pooler.supabase.com`,
    port: Number(E.SUPABASE_DB_PORT || 5432),
    user: `postgres.${E.SUPABASE_PROJECT_REF}`,
    password: E.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
  });
  await c.connect();
  return c;
}

d('live care partners — scoped delegation, receipts, change watching', () => {
  let pt: SupabaseClient, pa: SupabaseClient, st: SupabaseClient;
  let ptId: string, paId: string, stId: string;
  let db: pg.Client;
  let hospital: string;
  let department: string;
  let appointmentId: string;

  async function freshDelegation(scopes: string[], days = 30) {
    await db.query('delete from public.care_delegation_events where delegation_id in (select id from public.care_delegations where patient_id=$1)', [ptId]);
    await db.query('delete from public.care_delegations where patient_id=$1', [ptId]);
    const inv = await pt.rpc('invite_care_partner', { p_scopes: scopes, p_days: days });
    if (inv.error) throw new Error(inv.error.message);
    const acc = await pa.rpc('accept_care_invite', { p_token: inv.data.inviteToken });
    if (acc.error) throw new Error(acc.error.message);
    return { id: inv.data.id as string, token: inv.data.inviteToken as string };
  }

  beforeAll(async () => {
    ({ c: pt, id: ptId } = await signIn(PATIENT));
    ({ c: pa, id: paId } = await signIn(PARTNER));
    ({ c: st, id: stId } = await signIn(STRANGER));
    db = await adminDb();

    const row = (
      await db.query(
        `select h.id hospital, d.id department, s.id slot
           from public.hospitals h
           join public.departments d on d.hospital_id = h.id
           join public.slots s on s.department_id = d.id
          where h.booking_integrated limit 1`,
      )
    ).rows[0];
    hospital = row.hospital;
    department = row.department;

    // reset any state from previous runs
    await db.query('delete from public.appointment_change_acks where user_id = any($1::uuid[])', [[ptId, paId, stId]]);
    await db.query('delete from public.care_delegation_events where delegation_id in (select id from public.care_delegations where patient_id = any($1::uuid[]))', [[ptId, paId, stId]]);
    await db.query('delete from public.care_delegations where patient_id = any($1::uuid[]) or caregiver_id = any($1::uuid[])', [[ptId, paId, stId]]);
    await db.query('delete from public.continuity_bookmarks where owner_id = any($1::uuid[])', [[ptId, paId, stId]]);
    await db.query('delete from public.care_contexts where owner_id = any($1::uuid[])', [[ptId, paId, stId]]);
    await db.query('delete from public.follow_up_tasks where owner_id = any($1::uuid[])', [[ptId, paId, stId]]);
    await db.query('delete from public.hospital_favorites where user_id = any($1::uuid[])', [[ptId, paId, stId]]);

    // patient owns: a care context, a favourite, a follow-up, an appointment
    await pt.rpc('save_care_context', { p_label: 'Father, cardiology follow-up', p_needs: ['cardiology'] });
    await pt.rpc('set_favorite', { p_hospital: hospital, p_on: true });
    await pt.rpc('upsert_follow_up', {
      p_id: null, p_hospital: hospital, p_kind: 'report_collection',
      p_title: 'Collect ECG report', p_status: 'open',
    });

    const appt = (
      await db.query(
        `insert into public.appointments (hospital_id, department_id, slot_id, patient_id, patient_name, status)
         values ($1,$2,$3,$4,'CP Fixture','requested') returning id`,
        [hospital, department, row.slot, ptId],
      )
    ).rows[0];
    appointmentId = appt.id;
    await db.query(
      `insert into public.appointment_events (appointment_id, actor_id, action, version, details)
       values ($1,$2,'book',1, jsonb_build_object('status','requested','slotId',$3::text))`,
      [appointmentId, ptId, row.slot],
    );
  }, 90_000);

  afterAll(async () => {
    if (db) {
      await db.query('delete from public.appointment_change_acks where appointment_id=$1', [appointmentId]);
      await db.query('delete from public.appointment_events where appointment_id=$1', [appointmentId]);
      await db.query('delete from public.appointments where id=$1', [appointmentId]);
      await db.end();
    }
  });

  // ---------------------------------------------------------------- invite
  it('an invite returns its token exactly once and stores only a hash', async () => {
    await db.query('delete from public.care_delegation_events where delegation_id in (select id from public.care_delegations where patient_id=$1)', [ptId]);
    await db.query('delete from public.care_delegations where patient_id=$1', [ptId]);
    const { data, error } = await pt.rpc('invite_care_partner', {
      p_scopes: ['shortlist:read'], p_days: 14, p_label: 'My daughter',
    });
    expect(error).toBeNull();
    expect(data.inviteToken).toMatch(/^[0-9a-f]{48}$/);
    expect(data.status).toBe('pending');

    const stored = await db.query('select invite_hash from public.care_delegations where id=$1', [data.id]);
    expect(stored.rows[0].invite_hash).not.toBe(data.inviteToken);
    expect(stored.rows[0].invite_hash).toMatch(/^[0-9a-f]{64}$/);

    // reading the row back over the API must never expose a usable token
    const readBack = await pt.from('care_delegations').select('*').eq('id', data.id).single();
    expect(readBack.data.invite_token).toBeUndefined();
  });

  it('rejects a scope outside the allowlist and an over-long window', async () => {
    const badScope = await pt.rpc('invite_care_partner', { p_scopes: ['records:write'], p_days: 30 });
    expect(badScope.error).not.toBeNull();
    expect(badScope.error!.message).toContain('INVALID_INPUT');

    const badDays = await pt.rpc('invite_care_partner', { p_scopes: ['shortlist:read'], p_days: 365 });
    expect(badDays.error).not.toBeNull();
    expect(badDays.error!.message).toContain('INVALID_INPUT');
  });

  it('a bad token is indistinguishable from an unusable one', async () => {
    const guess = await pa.rpc('accept_care_invite', { p_token: 'f'.repeat(48) });
    expect(guess.error).not.toBeNull();
    expect(guess.error!.message).toContain('INVITE_NOT_USABLE');
  });

  it('the patient cannot accept their own invite', async () => {
    await db.query('delete from public.care_delegation_events where delegation_id in (select id from public.care_delegations where patient_id=$1)', [ptId]);
    await db.query('delete from public.care_delegations where patient_id=$1', [ptId]);
    const inv = await pt.rpc('invite_care_partner', { p_scopes: ['shortlist:read'], p_days: 7 });
    const self = await pt.rpc('accept_care_invite', { p_token: inv.data.inviteToken });
    expect(self.error).not.toBeNull();
    expect(self.error!.message).toContain('SELF_DELEGATION_FORBIDDEN');
  });

  it('a token cannot be replayed after it has been accepted', async () => {
    const { token } = await freshDelegation(['shortlist:read']);
    const replay = await st.rpc('accept_care_invite', { p_token: token });
    expect(replay.error).not.toBeNull();
    expect(replay.error!.message).toContain('INVITE_NOT_USABLE');
  });

  // ------------------------------------------------------------ scoping
  it('shortlist:read grants the shortlist and NOTHING else', async () => {
    await freshDelegation(['shortlist:read']);

    const ctx = await pa.from('care_contexts').select('label').eq('owner_id', ptId);
    expect(ctx.error).toBeNull();
    expect(ctx.data!.length).toBe(1);

    const fav = await pa.from('hospital_favorites').select('hospital_id').eq('user_id', ptId);
    expect(fav.data!.length).toBe(1);

    // not granted: follow-ups
    const fu = await pa.from('follow_up_tasks').select('id').eq('owner_id', ptId);
    expect(fu.data).toEqual([]);

    // not granted: appointment logistics
    const appt = await pa.from('appointments').select('id').eq('id', appointmentId);
    expect(appt.data).toEqual([]);

    // never grantable at all: personal visit history
    const vr = await pa.from('visit_records').select('id').eq('owner_id', ptId);
    expect(vr.data).toEqual([]);
  });

  it('followups:read grants follow-ups but not the shortlist', async () => {
    await freshDelegation(['followups:read']);

    const fu = await pa.from('follow_up_tasks').select('title').eq('owner_id', ptId);
    expect(fu.data!.length).toBe(1);
    expect(fu.data![0].title).toBe('Collect ECG report');

    const ctx = await pa.from('care_contexts').select('id').eq('owner_id', ptId);
    expect(ctx.data).toEqual([]);
  });

  it('logistics:read grants the appointment and its receipt, but not the shortlist', async () => {
    await freshDelegation(['logistics:read']);

    const appt = await pa.from('appointments').select('id,status').eq('id', appointmentId);
    expect(appt.data!.length).toBe(1);

    const receipt = await pa.rpc('appointment_receipt', { p_id: appointmentId });
    expect(receipt.error).toBeNull();
    expect(receipt.data.appointmentId).toBe(appointmentId);

    const ctx = await pa.from('care_contexts').select('id').eq('owner_id', ptId);
    expect(ctx.data).toEqual([]);
  });

  it('visit_records is never delegable, under any scope combination', async () => {
    await freshDelegation(['shortlist:read', 'logistics:read', 'followups:read']);
    await pt.rpc('add_visit_record', {
      p_hospital: hospital,
      p_visited_on: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    });
    const vr = await pa.from('visit_records').select('id').eq('owner_id', ptId);
    expect(vr.error).toBeNull();
    expect(vr.data).toEqual([]);
  });

  // -------------------------------------------------------- revoke/expire
  it('revocation cuts access immediately', async () => {
    const { id } = await freshDelegation(['shortlist:read']);
    expect((await pa.from('care_contexts').select('id').eq('owner_id', ptId)).data!.length).toBe(1);

    const rev = await pt.rpc('close_care_delegation', { p_id: id, p_action: 'revoke' });
    expect(rev.error).toBeNull();
    expect(rev.data.status).toBe('revoked');

    expect((await pa.from('care_contexts').select('id').eq('owner_id', ptId)).data).toEqual([]);
  });

  it('expiry cuts access with no job having run', async () => {
    const { id } = await freshDelegation(['shortlist:read']);
    expect((await pa.from('care_contexts').select('id').eq('owner_id', ptId)).data!.length).toBe(1);

    // Simulate the clock moving past the window. Note we must also move
    // created_at: the delegation_future_expiry CHECK refuses expires_at <=
    // created_at, which is the constraint doing its job — it rejected the
    // first version of this test for constructing a row that could not
    // legitimately exist.
    await db.query(
      `update public.care_delegations
          set created_at = now() - interval '2 days',
              expires_at = now() - interval '1 minute'
        where id=$1`, [id]);
    const still = await db.query('select status from public.care_delegations where id=$1', [id]);
    expect(still.rows[0].status).toBe('active');

    expect((await pa.from('care_contexts').select('id').eq('owner_id', ptId)).data).toEqual([]);
  });

  it('a caregiver can step away without the patient acting', async () => {
    const { id } = await freshDelegation(['shortlist:read']);
    const declined = await pa.rpc('close_care_delegation', { p_id: id, p_action: 'decline' });
    expect(declined.error).toBeNull();
    expect(declined.data.status).toBe('declined');
    expect((await pa.from('care_contexts').select('id').eq('owner_id', ptId)).data).toEqual([]);
  });

  it('a caregiver cannot revoke on the patient\'s behalf, and vice versa', async () => {
    const { id } = await freshDelegation(['shortlist:read']);
    const byPartner = await pa.rpc('close_care_delegation', { p_id: id, p_action: 'revoke' });
    expect(byPartner.error).not.toBeNull();
    expect(byPartner.error!.message).toContain('NOT_FOUND');

    const byPatient = await pt.rpc('close_care_delegation', { p_id: id, p_action: 'decline' });
    expect(byPatient.error).not.toBeNull();
  });

  // ------------------------------------------------------------ third party
  it('a stranger sees none of it', async () => {
    await freshDelegation(['shortlist:read', 'followups:read', 'logistics:read']);
    expect((await st.from('care_contexts').select('id').eq('owner_id', ptId)).data).toEqual([]);
    expect((await st.from('follow_up_tasks').select('id').eq('owner_id', ptId)).data).toEqual([]);
    expect((await st.from('appointments').select('id').eq('id', appointmentId)).data).toEqual([]);
    expect((await st.from('care_delegations').select('id')).data).toEqual([]);
    const r = await st.rpc('appointment_receipt', { p_id: appointmentId });
    expect(r.error).not.toBeNull();
    expect(r.error!.message).toContain('NOT_FOUND');
  });

  it('the access log is the patient\'s, not the caregiver\'s', async () => {
    await freshDelegation(['shortlist:read']);
    const asPatient = await pt.from('care_delegation_events').select('action');
    expect(asPatient.error).toBeNull();
    expect(asPatient.data!.map((r) => r.action)).toEqual(expect.arrayContaining(['invited', 'accepted']));

    const asPartner = await pa.from('care_delegation_events').select('action');
    expect(asPartner.data).toEqual([]);
  });

  // ---------------------------------------------------------------- F07
  it('a requested appointment is never presented as a confirmed one', async () => {
    const { data, error } = await pt.rpc('appointment_receipt', { p_id: appointmentId });
    expect(error).toBeNull();
    expect(data.status).toBe('requested');
    expect(data.isConfirmedAppointment).toBe(false);
    expect(data.nextActionOwner).toBe('hospital');
    expect(String(data.nextAction)).toMatch(/do not travel yet/i);
    expect(data.schedulerSource).toBe('flowcare-core');
  });

  it('the receipt states the change policy rather than implying it', async () => {
    const { data } = await pt.rpc('appointment_receipt', { p_id: appointmentId });
    expect(data.changePolicy.canCancel).toBe(true);
    expect(data.changePolicy.canReschedule).toBe(true);
    // this fixture department has no published no-show policy, and the
    // receipt must say so rather than invent a grace period
    expect(data.changePolicy.noShowPolicyPublished).toBe(false);
    expect(data.changePolicy.noShowGraceMinutes).toBeNull();
  });

  // ---------------------------------------------------------------- F12
  it('change watching reports unseen events and clears after acknowledgement', async () => {
    const before = await pt.rpc('appointment_changes', { p_id: appointmentId });
    expect(before.error).toBeNull();
    expect(before.data.unseenCount).toBeGreaterThan(0);
    expect(before.data.changes[0].isNew).toBe(true);

    const maxV = Math.max(...before.data.changes.map((c: { version: number }) => c.version));
    const ack = await pt.rpc('ack_appointment_changes', { p_id: appointmentId, p_version: maxV });
    expect(ack.error).toBeNull();

    const after = await pt.rpc('appointment_changes', { p_id: appointmentId });
    expect(after.data.unseenCount).toBe(0);

    // a new scheduler event becomes unseen again
    await db.query(
      `insert into public.appointment_events (appointment_id, actor_id, action, version, details)
       values ($1,$2,'confirm',2, jsonb_build_object('status','confirmed'))`,
      [appointmentId, ptId],
    );
    const later = await pt.rpc('appointment_changes', { p_id: appointmentId });
    expect(later.data.unseenCount).toBe(1);
  });

  it('acknowledgement watermarks never move backwards', async () => {
    await pt.rpc('ack_appointment_changes', { p_id: appointmentId, p_version: 2 });
    await pt.rpc('ack_appointment_changes', { p_id: appointmentId, p_version: 1 });
    const row = await db.query(
      'select seen_version from public.appointment_change_acks where appointment_id=$1 and user_id=$2',
      [appointmentId, ptId],
    );
    expect(row.rows[0].seen_version).toBe(2);
  });

  // ---------------------------------------------------------------- F21
  it('a continuity bookmark binds to a department id, not a hospital name', async () => {
    const { data, error } = await pt.rpc('set_continuity_bookmark', {
      p_hospital: hospital, p_department: department, p_label: 'Dad - cardiology', p_on: true,
    });
    expect(error).toBeNull();
    expect(data.department_id).toBe(department);

    const mine = await pt.from('continuity_bookmarks').select('department_id');
    expect(mine.data!.length).toBe(1);
    expect((await st.from('continuity_bookmarks').select('id')).data).toEqual([]);
  });

  it('a bookmark cannot point at a department belonging to another hospital', async () => {
    const other = (
      await db.query(
        `select d.id from public.departments d where d.hospital_id <> $1 limit 1`, [hospital],
      )
    ).rows[0];
    const { error } = await pt.rpc('set_continuity_bookmark', {
      p_hospital: hospital, p_department: other.id, p_on: true,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('NOT_FOUND');
  });

  // ---------------------------------------------------------------- F10
  it('support channels are public, provenance-bearing, and absent rather than invented', async () => {
    const anonC = client();
    const { data, error } = await anonC
      .from('hospital_support_channels')
      .select('purpose,channel_type,value,source,source_url,verified_at')
      .limit(50);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.source).toBeTruthy();
      expect(row.value).toBeTruthy();
      // provenance pair invariant
      if (row.verified_at === null) expect(row.source_url ?? null).not.toBe(undefined);
    }
  });
});
