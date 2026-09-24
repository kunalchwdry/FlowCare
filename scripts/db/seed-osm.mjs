/**
 * Seed real Pune-district hospitals from OpenStreetMap.
 *
 * WHY OSM AND NOT GOOGLE
 *   Google Maps Service Terms 14 forbid warehousing Places content: only the
 *   place ID (refresh >12 months) and lat/lng (<=30 days) may be persisted.
 *   Seeding a database from Places would breach that. OpenStreetMap is ODbL —
 *   storable and redistributable with attribution — so it is the only source
 *   here. No Google field is read, cached or written by this script.
 *
 * WHAT IS AND IS NOT CLAIMED
 *   Every row written is a value that exists in OSM, with source_url pointing
 *   at the exact element. Nothing is inferred, averaged or invented.
 *   - OSM `check_date` becomes `verified_at`. Where a mapper never recorded
 *     one, the fact stays NULL => unverified => never rendered as fresh.
 *   - Accessibility is imported ONLY for elements carrying a check_date,
 *     because an undated wheelchair tag cannot satisfy the schema rule that
 *     an unverified component must read 'not_assessed'. Absence of a row
 *     means unknown, which is the honest state.
 *   - Charges, scheme empanelment, prep requirements and wayfinding are NOT
 *     seeded at all. OSM does not carry them, so FlowCare has nothing to say
 *     and says nothing, rather than guessing.
 *   - A `name:mr` tag is NOT treated as evidence of Marathi-speaking staff or
 *     signage. It is a name translation, and reading service quality into it
 *     would be exactly the kind of invention this project forbids.
 *
 *   Imported hospitals are discovery-only: booking_integrated = false, no
 *   departments, no slots, so availability resolves to 'unknown'.
 *
 * Idempotent: re-running upserts on (osm_type, osm_id) and never duplicates.
 *
 *   node scripts/db/seed-osm.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { connect } from './client.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DATA = path.join(ROOT, 'data/osm-pune-hospitals.json');
const dry = process.argv.includes('--dry');

const ATTRIBUTION = 'OpenStreetMap contributors, ODbL';
const osmUrl = (t, id) => `https://www.openstreetmap.org/${t}/${id}`;

const titleCity = (c) => {
  if (!c) return null;
  const s = c.trim().replace(/\s*,.*$/, '');
  if (/^pune$/i.test(s)) return 'Pune';
  if (/^pcmc$/i.test(s) || /pimpri/i.test(s)) return 'Pimpri-Chinchwad';
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const OPERATOR_TYPE = { public: 'public', government: 'government', private: 'private', business: 'business', ngo: 'ngo' };

// OSM healthcare:speciality -> FlowCare service slug + label.
const SPECIALITY = {
  general: ['general-medicine', 'General medicine'],
  medical: ['general-medicine', 'General medicine'],
  multispeciality: ['multispecialty', 'Multispecialty'],
  gynaecology: ['gynaecology', 'Gynaecology'],
  obstetrics: ['obstetrics', 'Obstetrics'],
  paediatrics: ['paediatrics', 'Paediatrics'],
  orthopaedics: ['orthopaedics', 'Orthopaedics'],
  ophthalmology: ['ophthalmology', 'Ophthalmology'],
  oncology: ['oncology', 'Oncology'],
  cardiology: ['cardiology', 'Cardiology'],
  dentist: ['dentistry', 'Dentistry'],
  dental: ['dentistry', 'Dentistry'],
  optometry: ['optometry', 'Optometry'],
  pathology: ['pathology', 'Pathology'],
  proctology: ['proctology', 'Proctology'],
  urology: ['urology', 'Urology'],
  gastroenterology: ['gastroenterology', 'Gastroenterology'],
  psychiatry: ['psychiatry', 'Psychiatry'],
  dermatology: ['dermatology', 'Dermatology'],
  neurology: ['neurology', 'Neurology'],
  nephrology: ['nephrology', 'Nephrology'],
  pharmacy: ['pharmacy', 'Pharmacy'],
};

const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const c = await connect();
const stat = { hospitals: 0, services: 0, accessibility: 0, arrival: 0, support: 0, skipped: 0 };

await c.query('begin');
try {
  for (const h of rows) {
    const url = osmUrl(h.osm_type, h.osm_id);
    const checked = h.check_date && /^\d{4}-\d{2}-\d{2}$/.test(h.check_date) ? h.check_date : null;
    const address = h.addr_full || [h.street, h.postcode].filter(Boolean).join(', ') || null;

    const res = await c.query(
      `insert into public.hospitals
         (name, timezone, published, slug, city, locality, address, lat, lng,
          osm_type, osm_id, location_source, location_checked_on,
          phone, website, email, operator, operator_type,
          contact_source, contact_checked_on, booking_integrated)
       values ($1,'Asia/Kolkata',true,$2,$3,$4,$5,$6,$7,$8,$9,'openstreetmap',$10,
               $11,$12,$13,$14,$15,'openstreetmap',$16,false)
       on conflict (osm_type, osm_id) where osm_id is not null do update set
         name=excluded.name, slug=excluded.slug, city=excluded.city,
         locality=excluded.locality, address=excluded.address,
         lat=excluded.lat, lng=excluded.lng,
         location_checked_on=excluded.location_checked_on,
         phone=excluded.phone, website=excluded.website, email=excluded.email,
         operator=excluded.operator, operator_type=excluded.operator_type,
         contact_checked_on=excluded.contact_checked_on
       returning id`,
      [
        h.name, h.slug, titleCity(h.city) || 'Pune', h.street || h.district || null,
        address, h.lat, h.lng, h.osm_type, h.osm_id, checked,
        h.phone || null,
        h.website && /^https?:\/\//i.test(h.website) ? h.website : null,
        h.email || null, h.operator || null,
        OPERATOR_TYPE[h.operator_type] || null,
        checked,
      ],
    );
    const id = res.rows[0].id;
    stat.hospitals += 1;

    // ---- services -------------------------------------------------------
    const specs = new Set();
    for (const raw of String(h.speciality || '').split(';')) {
      const key = raw.trim().toLowerCase();
      if (SPECIALITY[key]) specs.add(key);
    }
    if (h.emergency === 'yes') specs.add('__emergency');

    for (const key of specs) {
      const [slug, label] = key === '__emergency'
        ? ['emergency-care', 'Emergency care']
        : SPECIALITY[key];
      // check_date present => a mapper confirmed the tag on that date.
      const verification = checked ? 'self_reported' : 'unverified';
      await c.query(
        `insert into public.hospital_service_verifications
           (hospital_id, service_slug, label, verification, source, source_url, verified_at, verified_by_role)
         values ($1,$2,$3,$4,'openstreetmap',$5,$6,$7)
         on conflict (hospital_id, service_slug) do update set
           label=excluded.label, verification=excluded.verification,
           source_url=excluded.source_url, verified_at=excluded.verified_at,
           verified_by_role=excluded.verified_by_role`,
        [id, slug, label, verification, url,
         checked ? `${checked}T00:00:00Z` : null,
         checked ? 'volunteer_mapper' : null],
      );
      stat.services += 1;
    }

    // ---- accessibility (dated observations only) ------------------------
    if (checked && h.wheelchair) {
      const status = h.wheelchair === 'yes' ? 'present'
        : h.wheelchair === 'limited' ? 'partial'
        : h.wheelchair === 'no' ? 'absent' : null;
      if (status) {
        await c.query(
          `insert into public.hospital_accessibility_components
             (hospital_id, component, status, note, source, source_url, verified_at, verified_by_role)
           values ($1,'step_free_entrance',$2,$3,'openstreetmap',$4,$5,'volunteer_mapper')
           on conflict (hospital_id, component) do update set
             status=excluded.status, note=excluded.note,
             source_url=excluded.source_url, verified_at=excluded.verified_at,
             verified_by_role=excluded.verified_by_role`,
          [id, status,
           `OpenStreetMap wheelchair=${h.wheelchair}. Describes entrance access only; it says nothing about toilets, lifts or consulting rooms.`,
           url, `${checked}T00:00:00Z`],
        );
        stat.accessibility += 1;
      }
    }

    // ---- F10 support channels ------------------------------------------
    // Only channels that genuinely exist in the source. A hospital with no
    // phone in OSM gets NO row, and the UI must render that as
    // "not connected" rather than as an empty field or an invented number.
    for (const [type, val] of [['phone', h.phone], ['email', h.email], ['website', h.website]]) {
      if (!val) continue;
      if (type === 'website' && !/^https?:\/\//i.test(val)) continue;
      await c.query(
        `insert into public.hospital_support_channels
           (hospital_id, purpose, channel_type, value, languages, hours_note,
            source, source_url, verified_at, verified_by_role)
         values ($1,'general',$2,$3,'{}',$4,'openstreetmap',$5,$6,$7)
         on conflict (hospital_id, purpose, channel_type) do update set
           value=excluded.value, hours_note=excluded.hours_note,
           source_url=excluded.source_url, verified_at=excluded.verified_at,
           verified_by_role=excluded.verified_by_role`,
        [id, type, String(val).slice(0, 300),
         h.opening_hours ? `OpenStreetMap opening_hours: ${h.opening_hours}` : null,
         url, checked ? `${checked}T00:00:00Z` : null, checked ? 'volunteer_mapper' : null],
      );
      stat.support += 1;
    }

    // ---- arrival pack: opening hours only -------------------------------
    if (h.opening_hours) {
      await c.query(
        `insert into public.hospital_arrival_packs
           (hospital_id, opd_timing_note, what_to_bring, source, source_url, verified_at, verified_by_role)
         values ($1,$2,'{}','openstreetmap',$3,$4,$5)
         on conflict (hospital_id) do update set
           opd_timing_note=excluded.opd_timing_note, source_url=excluded.source_url,
           verified_at=excluded.verified_at, verified_by_role=excluded.verified_by_role`,
        [id, `Opening hours recorded in OpenStreetMap as "${h.opening_hours}". These are building hours, not per-department OPD hours, and FlowCare does not infer appointment availability from them.`,
         url, checked ? `${checked}T00:00:00Z` : null, checked ? 'volunteer_mapper' : null],
      );
      stat.arrival += 1;
    }
  }

  if (dry) { await c.query('rollback'); console.log('-- dry run, rolled back --'); }
  else { await c.query('commit'); }
} catch (e) {
  await c.query('rollback');
  console.error('SEED FAILED:', e.code, e.message, e.detail || '');
  await c.end();
  process.exit(1);
}

const summary = await c.query(`
  select
    (select count(*) from public.hospitals where location_source='openstreetmap')::int as osm_hospitals,
    (select count(*) from public.hospitals where booking_integrated)::int              as bookable,
    (select count(*) from public.hospital_service_verifications)::int                  as services,
    (select count(*) from public.hospital_service_verifications where verified_at is null)::int as services_unverified,
    (select count(*) from public.hospital_accessibility_components)::int               as accessibility,
    (select count(*) from public.hospital_arrival_packs)::int                          as arrival,
    (select count(*) from public.hospital_support_channels)::int                       as support_channels,
    (select count(*) from public.hospitals h where h.location_source='openstreetmap'
       and not exists (select 1 from public.hospital_support_channels sc where sc.hospital_id=h.id))::int as hospitals_with_no_channel`);
await c.end();
console.log('attribution:', ATTRIBUTION);
console.log('written:', stat);
console.log('db now:', summary.rows[0]);
