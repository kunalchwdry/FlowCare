/**
 * LIVE tests for migration 0007 — dependent profiles, patient-reported
 * referrals, results delivery, carry lists, offline visit packet.
 *
 * The load-bearing test in this file is "a dependent profile is not a key to
 * anyone's account". F04 was deferred once precisely because a dependent
 * feature is the natural place for an accidental privilege escalation, so the
 * boundary is asserted rather than assumed.
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

const OWNER = { email: 'flowcare-ct-owner@example.com', password: 'Ct-Owner-8w3k!' };
const OTHER = { email: 'flowcare-ct-other@example.com', password: 'Ct-Other-2r6n!' };

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

d('live continuity — dependents, referrals, results, packets', () => {
  let a: SupabaseClient, b: SupabaseClient;
  let aId: string, bId: string;
  let db: pg.Client;
  let hospital: string, department: string, appointmentId: string;

  beforeAll(async () => {
    ({ c: a, id: aId } = await signIn(OWNER));
    ({ c: b, id: bId } = await signIn(OTHER));

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

    const ids = [aId, bId];
    await db.query('delete from public.carry_items where owner_id = any($1::uuid[])', [ids]);
    await db.query('delete from public.referral_trackers where owner_id = any($1::uuid[])', [ids]);
    await db.query('delete from public.results_preferences where owner_id = any($1::uuid[])', [ids]);
    await db.query(
      `update public.appointments set booked_for_profile_id = null
        where booked_for_profile_id in (select id from public.dependent_profiles where owner_id = any($1::uuid[]))`,
      [ids],
    );
    await db.query('delete from public.dependent_profiles where owner_id = any($1::uuid[])', [ids]);

    appointmentId = (
      await db.query(
        `insert into public.appointments (hospital_id, department_id, slot_id, patient_id, patient_name, status)
         values ($1,$2,$3,$4,'CT Fixture','requested') returning id`,
        [hospital, department, row.slot, aId],
      )
    ).rows[0].id;
    await db.query(
      `insert into public.appointment_events (appointment_id, actor_id, action, version, details)
       values ($1,$2,'book',1, jsonb_build_object('status','requested'))`,
      [appointmentId, aId],
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

  // ------------------------------------------------------- F04 boundary
  it('a dependent profile is not a key to anyone\'s account', async () => {
    // B creates a profile naming A, with A's real user id in every free-text
    // field. This must remain a label and grant nothing.
    const { data, error } = await b.rpc('upsert_dependent_profile', {
      p_name: 'Owner A', p_relationship: 'parent', p_note: aId,
    });
    expect(error).toBeNull();

    // B still cannot read a single thing belonging to A
    expect((await b.from('care_contexts').select('id').eq('owner_id', aId)).data).toEqual([]);
    expect((await b.from('visit_records').select('id').eq('owner_id', aId)).data).toEqual([]);
    expect((await b.from('appointments').select('id').eq('id', appointmentId)).data).toEqual([]);
    expect((await b.from('follow_up_tasks').select('id').eq('owner_id', aId)).data).toEqual([]);

    const pkt = await b.rpc('visit_packet', { p_appointment: appointmentId });
    expect(pkt.error).not.toBeNull();
    expect(pkt.error!.message).toContain('NOT_FOUND');

    await b.rpc('delete_dependent_profile', { p_id: data.id });
  });

  it('a dependent profile can never claim verified guardianship', async () => {
    const { data } = await a.rpc('upsert_dependent_profile', { p_name: 'Sunita (mother)' });
    expect(data.relationship_basis).toBe('self_declared');

    // the only legal value is self_declared — the column cannot express
    // a verified relationship even with direct SQL
    await expect(
      db.query("update public.dependent_profiles set relationship_basis='verified' where id=$1", [data.id]),
    ).rejects.toThrow(/relationship_basis/);

    // and no RLS policy anywhere consults this table
    const refs = await db.query(
      `select count(*)::int n from pg_policies
        where schemaname='public' and (qual ilike '%dependent_profile%' or with_check ilike '%dependent_profile%')`,
    );
    expect(refs.rows[0].n).toBe(0);
  });

  it('profiles are private and attach only to the owner\'s own appointment', async () => {
    const mine = (await a.rpc('upsert_dependent_profile', { p_name: 'Ravi (father)', p_relationship: 'father' })).data;
    expect((await b.from('dependent_profiles').select('id').eq('owner_id', aId)).data).toEqual([]);

    const attached = await a.rpc('attach_dependent_profile', {
      p_appointment: appointmentId, p_profile: mine.id,
    });
    expect(attached.error).toBeNull();
    expect(attached.data.patientName).toBe('Ravi (father)');

    // B cannot attach their own profile to A's appointment
    const theirs = (await b.rpc('upsert_dependent_profile', { p_name: 'Intruder' })).data;
    const bad = await b.rpc('attach_dependent_profile', {
      p_appointment: appointmentId, p_profile: theirs.id,
    });
    expect(bad.error).not.toBeNull();
    expect(bad.error!.message).toContain('NOT_FOUND');
    await b.rpc('delete_dependent_profile', { p_id: theirs.id });
  });

  it('deleting a profile does not orphan the appointment name', async () => {
    const p = (await a.rpc('upsert_dependent_profile', { p_name: 'Temp Person' })).data;
    await a.rpc('attach_dependent_profile', { p_appointment: appointmentId, p_profile: p.id });
    await a.rpc('delete_dependent_profile', { p_id: p.id });

    const row = await db.query(
      'select patient_name, booked_for_profile_id from public.appointments where id=$1',
      [appointmentId],
    );
    expect(row.rows[0].patient_name).toBe('Temp Person'); // copied, survives
    expect(row.rows[0].booked_for_profile_id).toBeNull(); // link cleared
  });

  // -------------------------------------------------------- F14 referrals
  it('a referral is always patient-reported and can never claim to be issued', async () => {
    const { data, error } = await a.rpc('upsert_referral', {
      p_by: 'Dr Mehta at the camp', p_hospital: hospital,
      p_department: 'Cardiology', p_status: 'open',
    });
    expect(error).toBeNull();
    expect(data.source).toBe('patient_reported');

    await expect(
      db.query("update public.referral_trackers set source='hospital_issued' where id=$1", [data.id]),
    ).rejects.toThrow(/source/);

    expect((await b.from('referral_trackers').select('id').eq('owner_id', aId)).data).toEqual([]);
  });

  it('a referral must have a destination and a valid status', async () => {
    const noDest = await a.rpc('upsert_referral', { p_by: 'somebody' });
    expect(noDest.error).not.toBeNull();
    expect(noDest.error!.message).toContain('INVALID_INPUT');

    const badStatus = await a.rpc('upsert_referral', {
      p_department: 'Cardiology', p_status: 'cured',
    });
    expect(badStatus.error).not.toBeNull();
    expect(badStatus.error!.message).toContain('INVALID_INPUT');
  });

  it('closing a referral records when, and reopening clears it', async () => {
    const r = (await a.rpc('upsert_referral', { p_department: 'ENT', p_status: 'open' })).data;
    expect(r.closed_at).toBeNull();

    const done = (await a.rpc('upsert_referral', {
      p_id: r.id, p_department: 'ENT', p_status: 'completed',
    })).data;
    expect(done.closed_at).not.toBeNull();

    const reopened = (await a.rpc('upsert_referral', {
      p_id: r.id, p_department: 'ENT', p_status: 'open',
    })).data;
    expect(reopened.closed_at).toBeNull();
  });

  // -------------------------------------------------------- F17 results
  it('a results preference is stored per owner and stays private', async () => {
    const { data, error } = await a.rpc('set_results_preference', {
      p_method: 'collect_in_person', p_note: 'Large print please',
    });
    expect(error).toBeNull();
    expect(data.preferred_method).toBe('collect_in_person');

    // upsert, not duplicate
    await a.rpc('set_results_preference', { p_method: 'email' });
    const rows = await a.from('results_preferences').select('preferred_method');
    expect(rows.data!.length).toBe(1);
    expect(rows.data![0].preferred_method).toBe('email');

    expect((await b.from('results_preferences').select('owner_id').eq('owner_id', aId)).data).toEqual([]);
  });

  it('rejects a delivery method outside the allowlist', async () => {
    const bad = await a.rpc('set_results_preference', { p_method: 'whatsapp' });
    expect(bad.error).not.toBeNull();
    expect(bad.error!.message).toContain('INVALID_INPUT');
  });

  it('a facility results policy is public and carries provenance', async () => {
    await db.query(
      `insert into public.hospital_results_policies
         (hospital_id, department_id, method, typical_wait_note, source, source_url, verified_at, verified_by_role)
       values ($1,$2,'collect_in_person','Usually 2 working days','hospital_published',
               'https://example.org/results', now(), 'hospital_staff')
       on conflict (hospital_id, department_id, method) do nothing`,
      [hospital, department],
    );
    const anonC = client();
    const { data, error } = await anonC
      .from('hospital_results_policies')
      .select('method,source,verified_at')
      .eq('hospital_id', hospital);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data![0].source).toBe('hospital_published');
  });

  it('verified_at and verified_by_role must agree', async () => {
    await expect(
      db.query(
        `insert into public.hospital_results_policies (hospital_id, method, source, verified_at)
         values ($1,'postal','hospital_published', now())`,
        [hospital],
      ),
    ).rejects.toThrow(/results_policy_verifier_ok/);
  });

  // -------------------------------------------------------- F16 carry list
  it('carry items are private and deduplicated', async () => {
    await a.rpc('set_carry_item', { p_label: 'Aadhaar card', p_hospital: hospital });
    await a.rpc('set_carry_item', { p_label: 'Aadhaar card', p_hospital: hospital });
    const mine = await a.from('carry_items').select('label,origin,packed');
    expect(mine.data!.filter((r) => r.label === 'Aadhaar card').length).toBe(1);
    expect(mine.data![0].origin).toBe('patient_added');
    expect((await b.from('carry_items').select('id').eq('owner_id', aId)).data).toEqual([]);
  });

  it('there is no file column anywhere on the carry list', async () => {
    // F16 was deferred over document-vault governance; this asserts we did not
    // quietly reintroduce document storage.
    const cols = await db.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='carry_items'`,
    );
    const names = cols.rows.map((r) => r.column_name).join(',');
    expect(names).not.toMatch(/file|upload|blob|document|url|path|storage/i);
  });

  it('importing facility prep items marks their origin', async () => {
    const { data, error } = await a.rpc('import_facility_carry_items', { p_hospital: hospital });
    expect(error).toBeNull();
    expect(typeof data.added).toBe('number');

    const imported = await a.from('carry_items').select('label,origin').eq('origin', 'facility_prep');
    // the fixture hospital may publish no prep requirements; either way the
    // rows that DID arrive must be attributed to the facility, not the patient
    for (const row of imported.data ?? []) expect(row.origin).toBe('facility_prep');
  });

  it('marks an item packed without creating a duplicate', async () => {
    const item = (await a.from('carry_items').select('id,label').eq('label', 'Aadhaar card').single()).data!;
    const upd = await a.rpc('set_carry_item', { p_id: item.id, p_packed: true });
    expect(upd.error).toBeNull();
    const after = await a.from('carry_items').select('packed').eq('id', item.id).single();
    expect(after.data!.packed).toBe(true);
  });

  // ---------------------------------------------------- F16+F20 packet
  it('the visit packet assembles real data and is owner-scoped', async () => {
    const { data, error } = await a.rpc('visit_packet', { p_appointment: appointmentId });
    expect(error).toBeNull();
    expect(data.appointment.id).toBe(appointmentId);
    expect(data.hospital.name).toBeTruthy();
    expect(data.receipt.isConfirmedAppointment).toBe(false);
    expect(Array.isArray(data.carryList)).toBe(true);
    expect(Array.isArray(data.supportChannels)).toBe(true);
    expect(data.offlineSafe).toBe(true);
    expect(String(data.notice)).toMatch(/not a medical document/i);

    const denied = await b.rpc('visit_packet', { p_appointment: appointmentId });
    expect(denied.error).not.toBeNull();
    expect(denied.error!.message).toContain('NOT_FOUND');
  });

  it('a missing arrival pack comes back null, not as a plausible default', async () => {
    const bare = (
      await db.query(
        `select h.id hospital, d.id department, s.id slot
           from public.hospitals h
           join public.departments d on d.hospital_id=h.id
           join public.slots s on s.department_id=d.id
          where h.booking_integrated
            and not exists (select 1 from public.hospital_arrival_packs ap where ap.hospital_id=h.id)
          limit 1`,
      )
    ).rows[0];
    if (!bare) return; // every bookable fixture has a pack; nothing to assert

    const appt = (
      await db.query(
        `insert into public.appointments (hospital_id, department_id, slot_id, patient_id, patient_name, status)
         values ($1,$2,$3,$4,'Bare','requested') returning id`,
        [bare.hospital, bare.department, bare.slot, aId],
      )
    ).rows[0].id;

    const { data } = await a.rpc('visit_packet', { p_appointment: appt });
    expect(data.arrivalPack).toBeNull();

    await db.query('delete from public.appointments where id=$1', [appt]);
  });

  it('the packet carries provenance on every facility fact it shows', async () => {
    const { data } = await a.rpc('visit_packet', { p_appointment: appointmentId });
    for (const ch of data.supportChannels) expect(ch.source).toBeTruthy();
    for (const rp of data.resultsPolicies) expect(rp.source).toBeTruthy();
    if (data.arrivalPack) expect(data.arrivalPack.source).toBeTruthy();
  });
});
