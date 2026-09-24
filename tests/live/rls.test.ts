/**
 * LIVE Row Level Security verification against the real Supabase project.
 *
 * This is the suite the readiness table kept marking "externally unverified".
 * Everything else in tests/ runs against the in-process demo repository and
 * therefore proves things about the APPLICATION layer only. These tests prove
 * things about the DATABASE: they speak PostgREST over HTTPS as real signed-in
 * users, so RLS policies, table grants and SECURITY DEFINER functions are all
 * genuinely exercised.
 *
 * Opt-in. Without FLOWCARE_LIVE_DB=1 and a populated .env.local the whole file
 * is skipped, so the offline suite stays hermetic.
 *
 *   FLOWCARE_LIVE_DB=1 npx vitest run tests/rls.live.test.ts
 *
 * Note on skips: the enabled/disabled decision is made at module scope with a
 * top-level await, NOT with it.runIf(), because runIf is evaluated at
 * collection time and would silently mark everything "skipped" while looking
 * green.
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

const USER_A = { email: 'flowcare-rls-a@example.com', password: 'Rls-Test-A-8f3k2!' };
const USER_B = { email: 'flowcare-rls-b@example.com', password: 'Rls-Test-B-2p9x7!' };

function browserClient(): SupabaseClient {
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Node 20 has no global WebSocket; supabase-js builds a realtime client
    // eagerly even though these tests never subscribe to anything.
    realtime: { transport: ws as unknown as never },
  });
}

async function signIn(creds: { email: string; password: string }): Promise<SupabaseClient> {
  const c = browserClient();
  let { error } = await c.auth.signInWithPassword(creds);
  if (error) {
    const up = await c.auth.signUp(creds);
    if (up.error) throw new Error(`signUp failed: ${up.error.message}`);
    if (!up.data.session) {
      const retry = await c.auth.signInWithPassword(creds);
      if (retry.error) throw new Error(`signIn after signUp failed: ${retry.error.message}`);
    }
  }
  const { data } = await c.auth.getUser();
  if (!data.user) throw new Error('no user after sign-in');
  return c;
}

async function admin() {
  const client = new pg.Client({
    host: E.SUPABASE_DB_HOST || `aws-0-${E.SUPABASE_DB_REGION || 'ap-northeast-1'}.pooler.supabase.com`,
    port: Number(E.SUPABASE_DB_PORT || 5432),
    user: `postgres.${E.SUPABASE_PROJECT_REF}`,
    password: E.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
  });
  await client.connect();
  return client;
}

d('live RLS — real Supabase, real users, real policies', () => {
  let anonC: SupabaseClient;
  let a: SupabaseClient;
  let b: SupabaseClient;
  let aId: string;
  let bId: string;
  let db: pg.Client;
  let bookableHospital: string; // the [TEST] hospital that has departments/slots
  let osmHospital: string; // a discovery-only imported hospital
  let completedVisitHospital: string;

  beforeAll(async () => {
    anonC = browserClient();
    a = await signIn(USER_A);
    b = await signIn(USER_B);
    aId = (await a.auth.getUser()).data.user!.id;
    bId = (await b.auth.getUser()).data.user!.id;
    db = await admin();

    bookableHospital = (
      await db.query("select id from public.hospitals where booking_integrated order by name limit 1")
    ).rows[0].id;
    osmHospital = (
      await db.query("select id from public.hospitals where location_source='openstreetmap' order by name limit 1")
    ).rows[0].id;
    completedVisitHospital = bookableHospital;

    // Fixture: give user A a genuinely completed visit at the bookable
    // hospital, so review eligibility has something real to find.
    await db.query('begin');
    const slot = (
      await db.query(
        `select s.id slot_id, s.department_id, d.hospital_id
           from public.slots s join public.departments d on d.id=s.department_id
          where d.hospital_id=$1 limit 1`,
        [bookableHospital],
      )
    ).rows[0];
    const appt = (
      await db.query(
        `insert into public.appointments
           (hospital_id, department_id, slot_id, patient_id, patient_name, status)
         values ($1,$2,$3,$4,'RLS Fixture A','completed') returning id`,
        [slot.hospital_id, slot.department_id, slot.slot_id, aId],
      )
    ).rows[0];
    await db.query(
      `insert into public.visits (appointment_id, state, checked_in_at, service_started_at, completed_at)
       values ($1,'completed', now() - interval '3 hours', now() - interval '2 hours', now() - interval '1 hour')
       on conflict (appointment_id) do nothing`,
      [appt.id],
    );
    // Clean slate for repeat runs.
    await db.query('delete from public.hospital_reviews where author_id = any($1::uuid[])', [[aId, bId]]);
    await db.query('delete from public.care_contexts where owner_id = any($1::uuid[])', [[aId, bId]]);
    await db.query('delete from public.visit_records where owner_id = any($1::uuid[])', [[aId, bId]]);
    await db.query('delete from public.hospital_favorites where user_id = any($1::uuid[])', [[aId, bId]]);
    await db.query('delete from public.facility_corrections where reporter_id = any($1::uuid[])', [[aId, bId]]);
    await db.query('commit');
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
  });

  // ---------------------------------------------------------------------
  // Public read surface
  // ---------------------------------------------------------------------
  it('anon can read published hospitals', async () => {
    const { data, error } = await anonC.from('hospitals').select('id,name,city').limit(5);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it('anon cannot read appointments at all — grant-level denial, not just RLS', async () => {
    const { error } = await anonC.from('appointments').select('id').limit(1);
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501'); // permission denied for table
  });

  it('an unpublished hospital is invisible to anon', async () => {
    const created = await db.query(
      `insert into public.hospitals (name, timezone, published)
       values ('[RLS] Hidden Hospital','Asia/Kolkata',false) returning id`,
    );
    const hidden = created.rows[0].id;
    try {
      const { data, error } = await anonC.from('hospitals').select('id').eq('id', hidden);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await db.query('delete from public.hospitals where id=$1', [hidden]);
    }
  });

  it('facility facts are readable for published hospitals and carry provenance', async () => {
    const { data, error } = await anonC
      .from('hospital_service_verifications')
      .select('service_slug,verification,source,source_url,verified_at')
      .limit(20);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect(row.source).toBe('openstreetmap');
      expect(row.source_url).toMatch(/^https:\/\/www\.openstreetmap\.org\//);
      // the core F18 invariant: unverified can never be dated
      if (row.verification === 'unverified') expect(row.verified_at).toBeNull();
    }
  });

  // ---------------------------------------------------------------------
  // Writes must go through RPC — direct table writes are ungranted
  // ---------------------------------------------------------------------
  it('a signed-in user cannot INSERT directly into a patient-owned table', async () => {
    const { error } = await a.from('care_contexts').insert({ owner_id: aId, label: 'direct write' });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('a signed-in user cannot INSERT a review directly', async () => {
    const { error } = await a
      .from('hospital_reviews')
      .insert({ hospital_id: completedVisitHospital, author_id: aId, overall: 5 });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('anon cannot call an authenticated-only RPC', async () => {
    const { error } = await anonC.rpc('save_care_context', { p_label: 'nope' });
    expect(error).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // Cross-user isolation — the claim the offline suite could never prove
  // ---------------------------------------------------------------------
  it('user B cannot see user A\'s care context', async () => {
    const created = await a.rpc('save_care_context', {
      p_label: 'Mother, knee pain',
      p_needs: ['orthopaedics'],
      p_locality: 'Kothrud',
    });
    expect(created.error).toBeNull();

    const mine = await a.from('care_contexts').select('id,label');
    expect(mine.error).toBeNull();
    expect(mine.data!.some((r) => r.label === 'Mother, knee pain')).toBe(true);

    const theirs = await b.from('care_contexts').select('id,label');
    expect(theirs.error).toBeNull();
    expect(theirs.data).toEqual([]);
  });

  it('user B cannot see user A\'s saved hospitals', async () => {
    const fav = await a.rpc('set_favorite', { p_hospital: osmHospital, p_on: true });
    expect(fav.error).toBeNull();

    const mine = await a.from('hospital_favorites').select('hospital_id');
    expect(mine.data!.length).toBe(1);

    const theirs = await b.from('hospital_favorites').select('hospital_id');
    expect(theirs.data).toEqual([]);
  });

  it('user B cannot see user A\'s visit history', async () => {
    const added = await a.rpc('add_visit_record', {
      p_hospital: osmHospital,
      p_visited_on: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      p_department: 'General medicine',
    });
    expect(added.error).toBeNull();

    expect((await a.from('visit_records').select('id')).data!.length).toBe(1);
    expect((await b.from('visit_records').select('id')).data).toEqual([]);
  });

  it('user B cannot delete user A\'s care context', async () => {
    const mine = await a.from('care_contexts').select('id').limit(1);
    const targetId = mine.data![0].id;
    const { error } = await b.rpc('delete_care_context', { p_id: targetId });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('NOT_FOUND');
    // and it is still there
    expect((await a.from('care_contexts').select('id').eq('id', targetId)).data!.length).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Review eligibility
  // ---------------------------------------------------------------------
  it('a user with no completed visit cannot review', async () => {
    const { error } = await b.rpc('submit_review', {
      p_hospital: completedVisitHospital,
      p_overall: 5,
      p_body: 'Never been here.',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('NO_ELIGIBLE_VISIT');
  });

  it('a user with a completed visit can review, and the review is bound to that visit', async () => {
    const { data, error } = await a.rpc('submit_review', {
      p_hospital: completedVisitHospital,
      p_overall: 4,
      p_waiting: 3,
      p_staff: 5,
      p_body: 'Seen close to the appointment time.',
    });
    expect(error).toBeNull();
    expect(data.overall).toBe(4);
    expect(data.visit_id).toBeTruthy();

    const check = await db.query(
      `select v.state from public.visits v where v.id=$1`, [data.visit_id],
    );
    expect(check.rows[0].state).toBe('completed');
  });

  it('a review cannot be written for a hospital the user never completed a visit at', async () => {
    const { error } = await a.rpc('submit_review', { p_hospital: osmHospital, p_overall: 5 });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('NO_ELIGIBLE_VISIT');
  });

  // ---------------------------------------------------------------------
  // Moderation authorization
  // ---------------------------------------------------------------------
  it('a non-moderator cannot moderate a review, and gets NOT_FOUND rather than FORBIDDEN', async () => {
    const review = await db.query(
      'select id from public.hospital_reviews where author_id=$1 limit 1', [aId],
    );
    const { error } = await b.rpc('moderate_review', {
      p_review: review.rows[0].id,
      p_action: 'remove',
      p_reason: 'i just do not like it',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('NOT_FOUND');
  });

  it('a member with reviews:moderate can hide a review, and it is audited', async () => {
    const review = (
      await db.query('select id, hospital_id from public.hospital_reviews where author_id=$1 limit 1', [aId])
    ).rows[0];

    await db.query(
      `insert into public.memberships (hospital_id, user_id, status, permissions)
       values ($1,$2,'active', array['reviews:moderate'])
       on conflict (hospital_id, user_id) do update
         set status='active', permissions=array['reviews:moderate']`,
      [review.hospital_id, bId],
    );
    try {
      const { data, error } = await b.rpc('moderate_review', {
        p_review: review.id,
        p_action: 'hide',
        p_reason: 'Contains another patient\'s name.',
      });
      expect(error).toBeNull();
      expect(data.status).toBe('hidden');

      const ev = await db.query(
        `select actor_kind, action, actor_id from public.review_moderation_events
          where review_id=$1 order by occurred_at desc limit 1`, [review.id],
      );
      expect(ev.rows[0].actor_kind).toBe('human');
      expect(ev.rows[0].action).toBe('hidden');
      expect(ev.rows[0].actor_id).toBe(bId);

      // hidden review disappears from the public surface...
      const pub = await anonC.from('hospital_reviews').select('id').eq('id', review.id);
      // Regression guard for 0005: an anonymous read of a hidden review must
      // return no rows, NOT raise AUTH_REQUIRED out of the policy predicate.
      expect(pub.error).toBeNull();
      expect(pub.data).toEqual([]);
      // ...but its author can still see it, so moderation is not silent
      const own = await a.from('hospital_reviews').select('id,status').eq('id', review.id);
      expect(own.data!.length).toBe(1);
      expect(own.data![0].status).toBe('hidden');
    } finally {
      await db.query('delete from public.review_moderation_events where review_id=$1', [review.id]);
      await db.query('delete from public.memberships where hospital_id=$1 and user_id=$2', [
        review.hospital_id, bId,
      ]);
    }
  });

  it('the database itself refuses to let an AI finalise a moderation decision', async () => {
    const review = (
      await db.query('select id from public.hospital_reviews where author_id=$1 limit 1', [aId])
    ).rows[0];
    await expect(
      db.query(
        `insert into public.review_moderation_events (review_id, actor_id, actor_kind, action, reason)
         values ($1, null, 'ai_flag', 'removed', 'model says spam')`,
        [review.id],
      ),
    ).rejects.toThrow(/moderation_ai_cannot_finalise/);
  });

  // ---------------------------------------------------------------------
  // Corrections — nothing self-publishes
  // ---------------------------------------------------------------------
  it('a submitted correction lands as pending and cannot be self-reviewed', async () => {
    const sub = await a.rpc('submit_correction', {
      p_hospital: osmHospital,
      p_field: 'locality',
      p_proposed: 'Shivajinagar',
      p_comment: 'Signboard on site says Shivajinagar.',
    });
    expect(sub.error).toBeNull();
    expect(sub.data.decision).toBe('pending');
    expect(sub.data.reviewer_id).toBeNull();

    // the reporter, even given the permission, cannot review their own
    await db.query(
      `insert into public.memberships (hospital_id, user_id, status, permissions)
       values ($1,$2,'active', array['corrections:review'])
       on conflict (hospital_id, user_id) do update
         set status='active', permissions=array['corrections:review']`,
      [osmHospital, aId],
    );
    try {
      const { error } = await a.rpc('review_correction', {
        p_id: sub.data.id, p_decision: 'accepted',
      });
      expect(error).not.toBeNull();
      expect(error!.message).toContain('SELF_REVIEW_FORBIDDEN');
    } finally {
      await db.query('delete from public.memberships where hospital_id=$1 and user_id=$2', [osmHospital, aId]);
    }
  });

  it('the database rejects a non-pending correction that has no human reviewer', async () => {
    await expect(
      db.query(
        `insert into public.facility_corrections
           (hospital_id, reporter_id, field, proposed_value, decision)
         values ($1,$2,'city','Pune','accepted')`,
        [osmHospital, aId],
      ),
    ).rejects.toThrow(/correction_decision_requires_reviewer/);
  });

  // ---------------------------------------------------------------------
  // Telemetry privacy
  // ---------------------------------------------------------------------
  it('nobody but service_role can read discovery telemetry', async () => {
    const asAnon = await anonC.from('discovery_events').select('id').limit(1);
    expect(asAnon.error).not.toBeNull();
    const asUser = await a.from('discovery_events').select('id').limit(1);
    expect(asUser.error).not.toBeNull();
  });

  it('telemetry accepts allowlisted names and rejects anything else', async () => {
    const ok = await anonC.rpc('record_discovery_event', {
      p_name: 'hospital_viewed', p_session: 'sess-abcdef12',
    });
    expect(ok.error).toBeNull();

    const bad = await anonC.rpc('record_discovery_event', {
      p_name: 'search_text:diabetes treatment', p_session: 'sess-abcdef12',
    });
    expect(bad.error).not.toBeNull();
    expect(bad.error!.message).toContain('INVALID_INPUT');
  });
});
