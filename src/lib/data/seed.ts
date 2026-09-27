/**
 * DEMO DATA — SYNTHETIC, NOT REAL.
 * -------------------------------------------------------------------------
 * Every hospital, department, session, appointment and review in this file is
 * invented for local development. Hospital names are deliberately fictional so
 * that no synthetic rating or wait time is ever attached to a real
 * organisation. Each record carries `isDemoRecord: true` and the UI renders a
 * persistent "Demo data" banner whenever the demo repository is active.
 *
 * Reviews here are SYNTHETIC and are never presented as real patient
 * feedback — see the DemoDataBanner component and docs/security.md.
 */
import type {
  Appointment, ClinicSession, Hospital, HospitalReview, ModerationEvent,
  QueueSnapshot, ReviewReport,
} from '@/lib/types';

/** Deterministic PRNG (mulberry32) so the demo dataset is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

interface Spec {
  slug: string; name: string; type: Hospital['type']; area: string; city: string; state: string;
  lat: number; lng: number; depts: string[]; services: string[]; access: string[]; langs: string[];
  emergency: boolean; beds: number | null; placeId: string | null; verified: boolean;
  reviewCount: number; ratingBias: number; desc: string;
}

const SPECS: Spec[] = [
  { slug: 'deccan-gymkhana-multispecialty', name: 'Deccan Gymkhana Multispecialty Centre', type: 'multispecialty', area: 'Deccan Gymkhana', city: 'Pune', state: 'Maharashtra', lat: 18.5167, lng: 73.8413,
    depts: ['cardiology', 'general-medicine', 'orthopaedics', 'dermatology', 'ent', 'paediatrics'],
    services: ['pharmacy', 'diagnostic-lab', 'radiology', 'ct-scan', 'health-checkup', 'ambulance'],
    access: ['wheelchair-accessible-entrance', 'wheelchair-accessible-parking', 'lift-access', 'ramp-access'],
    langs: ['en', 'hi', 'mr'], emergency: true, beds: 180, placeId: 'DEMO_PLACE_deccan_gymkhana', verified: true,
    reviewCount: 34, ratingBias: 0.45, desc: 'Outpatient-focused multispecialty centre with same-day diagnostics and a dedicated OPD block.' },

  { slug: 'koregaon-park-cardiac', name: 'Koregaon Park Institute of Cardiac Sciences', type: 'specialty', area: 'Koregaon Park', city: 'Pune', state: 'Maharashtra', lat: 18.5362, lng: 73.8939,
    depts: ['cardiology', 'general-medicine', 'pulmonology'],
    services: ['diagnostic-lab', 'radiology', 'ct-scan', 'health-checkup', 'pharmacy'],
    access: ['wheelchair-accessible-entrance', 'lift-access', 'wheelchair-accessible-restroom'],
    langs: ['en', 'hi'], emergency: true, beds: 95, placeId: 'DEMO_PLACE_kp_cardiac', verified: true,
    reviewCount: 21, ratingBias: 0.55, desc: 'Cardiology-led institute running daily cardiac OPD clinics and non-invasive testing.' },

  { slug: 'kothrud-family-health', name: 'Kothrud Family Health Hospital', type: 'multispecialty', area: 'Kothrud', city: 'Pune', state: 'Maharashtra', lat: 18.5074, lng: 73.8077,
    depts: ['general-medicine', 'paediatrics', 'gynaecology', 'dermatology', 'physiotherapy'],
    services: ['pharmacy', 'diagnostic-lab', 'vaccination', 'ultrasound', 'physio-gym'],
    access: ['wheelchair-accessible-entrance', 'ramp-access', 'lift-access'],
    langs: ['en', 'hi', 'mr'], emergency: false, beds: 60, placeId: 'DEMO_PLACE_kothrud_family', verified: true,
    reviewCount: 12, ratingBias: 0.1, desc: 'Neighbourhood family hospital with evening OPD hours and paediatric vaccination clinics.' },

  { slug: 'baner-ridge-multispecialty', name: 'Baner Ridge Multispecialty Hospital', type: 'multispecialty', area: 'Baner', city: 'Pune', state: 'Maharashtra', lat: 18.559, lng: 73.7868,
    depts: ['cardiology', 'orthopaedics', 'neurology', 'general-medicine', 'gastroenterology', 'urology'],
    services: ['pharmacy', 'diagnostic-lab', 'mri', 'ct-scan', 'radiology', 'day-care-surgery', 'ambulance'],
    access: ['wheelchair-accessible-entrance', 'wheelchair-accessible-parking', 'wheelchair-accessible-restroom', 'lift-access', 'sign-language-support'],
    langs: ['en', 'hi', 'mr', 'gu'], emergency: true, beds: 240, placeId: 'DEMO_PLACE_baner_ridge', verified: true,
    reviewCount: 47, ratingBias: 0.3, desc: 'Large multispecialty campus; OPD, day-care surgery and advanced imaging under one roof.' },

  { slug: 'hadapsar-community-care', name: 'Hadapsar Community Care Hospital', type: 'trust', area: 'Hadapsar', city: 'Pune', state: 'Maharashtra', lat: 18.5089, lng: 73.926,
    depts: ['general-medicine', 'paediatrics', 'ophthalmology', 'dentistry'],
    services: ['pharmacy', 'diagnostic-lab', 'vaccination', 'blood-bank'],
    access: ['ramp-access', 'wheelchair-accessible-entrance'],
    langs: ['hi', 'mr', 'en'], emergency: false, beds: 75, placeId: null, verified: true,
    reviewCount: 3, ratingBias: 0.2, desc: 'Charitable trust hospital offering subsidised outpatient consultations.' },

  { slug: 'viman-nagar-skin-allergy', name: 'Viman Nagar Skin & Allergy Clinic', type: 'clinic', area: 'Viman Nagar', city: 'Pune', state: 'Maharashtra', lat: 18.5679, lng: 73.9143,
    depts: ['dermatology'],
    services: ['pharmacy', 'diagnostic-lab'],
    access: ['lift-access'],
    langs: ['en', 'hi'], emergency: false, beds: null, placeId: 'DEMO_PLACE_viman_skin', verified: true,
    reviewCount: 9, ratingBias: 0.6, desc: 'Single-specialty dermatology clinic with patch-testing and teledermatology follow-ups.' },

  { slug: 'shivajinagar-government-general', name: 'Shivajinagar Government General Hospital', type: 'government', area: 'Shivajinagar', city: 'Pune', state: 'Maharashtra', lat: 18.5308, lng: 73.8478,
    depts: ['general-medicine', 'orthopaedics', 'gynaecology', 'paediatrics', 'psychiatry', 'ent', 'ophthalmology'],
    services: ['pharmacy', 'diagnostic-lab', 'radiology', 'blood-bank', 'ambulance', 'dialysis'],
    access: ['ramp-access', 'wheelchair-accessible-entrance', 'braille-signage'],
    langs: ['mr', 'hi', 'en'], emergency: true, beds: 420, placeId: 'DEMO_PLACE_shivajinagar_govt', verified: true,
    reviewCount: 28, ratingBias: -0.5, desc: 'Public general hospital; high OPD volume with published token-queue information.' },

  { slug: 'aundh-orthopaedic-trauma', name: 'Aundh Orthopaedic & Trauma Centre', type: 'specialty', area: 'Aundh', city: 'Pune', state: 'Maharashtra', lat: 18.559, lng: 73.8078,
    depts: ['orthopaedics', 'physiotherapy', 'general-medicine'],
    services: ['radiology', 'mri', 'physio-gym', 'pharmacy', 'day-care-surgery'],
    access: ['wheelchair-accessible-entrance', 'wheelchair-accessible-parking', 'wheelchair-accessible-restroom', 'lift-access', 'ramp-access'],
    langs: ['en', 'hi', 'mr'], emergency: false, beds: 55, placeId: 'DEMO_PLACE_aundh_ortho', verified: true,
    reviewCount: 16, ratingBias: 0.4, desc: 'Orthopaedic OPD and rehabilitation centre with on-site physiotherapy gym.' },

  { slug: 'wakad-mother-child', name: 'Wakad Mother & Child Hospital', type: 'specialty', area: 'Wakad', city: 'Pune', state: 'Maharashtra', lat: 18.5989, lng: 73.7629,
    depts: ['gynaecology', 'paediatrics', 'general-medicine'],
    services: ['ultrasound', 'diagnostic-lab', 'vaccination', 'pharmacy'],
    access: ['lift-access', 'wheelchair-accessible-entrance', 'wheelchair-accessible-restroom'],
    langs: ['en', 'hi', 'mr'], emergency: false, beds: 70, placeId: 'DEMO_PLACE_wakad_mc', verified: true,
    reviewCount: 6, ratingBias: 0.35, desc: 'Mother-and-child hospital with antenatal OPD packages and immunisation clinics.' },

  { slug: 'camp-eye-ent', name: 'Camp Eye and ENT Institute', type: 'specialty', area: 'Camp', city: 'Pune', state: 'Maharashtra', lat: 18.5145, lng: 73.879,
    depts: ['ophthalmology', 'ent'],
    services: ['day-care-surgery', 'pharmacy', 'diagnostic-lab'],
    access: ['wheelchair-accessible-entrance', 'braille-signage', 'lift-access'],
    langs: ['en', 'hi', 'mr', 'ur'], emergency: false, beds: 40, placeId: null, verified: true,
    reviewCount: 2, ratingBias: 0.5, desc: 'Eye and ENT day-care institute; cataract and audiology clinics.' },

  { slug: 'pimpri-teaching-research', name: 'Pimpri Teaching Hospital & Research Centre', type: 'teaching', area: 'Pimpri', city: 'Pimpri-Chinchwad', state: 'Maharashtra', lat: 18.6279, lng: 73.8009,
    depts: ['general-medicine', 'cardiology', 'neurology', 'nephrology', 'oncology', 'endocrinology', 'psychiatry', 'paediatrics'],
    services: ['pharmacy', 'diagnostic-lab', 'mri', 'ct-scan', 'radiology', 'dialysis', 'blood-bank', 'ambulance'],
    access: ['wheelchair-accessible-entrance', 'wheelchair-accessible-parking', 'lift-access', 'ramp-access', 'sign-language-support'],
    langs: ['en', 'hi', 'mr'], emergency: true, beds: 650, placeId: 'DEMO_PLACE_pimpri_teaching', verified: true,
    reviewCount: 41, ratingBias: 0.15, desc: 'Teaching hospital with subspecialty OPD clinics and resident-led follow-up services.' },

  { slug: 'magarpatta-daycare-surgical', name: 'Magarpatta Daycare Surgical Centre', type: 'clinic', area: 'Magarpatta', city: 'Pune', state: 'Maharashtra', lat: 18.5158, lng: 73.928,
    depts: ['general-medicine', 'urology', 'gastroenterology'],
    services: ['day-care-surgery', 'diagnostic-lab', 'ultrasound', 'pharmacy'],
    access: ['lift-access', 'wheelchair-accessible-entrance', 'wheelchair-accessible-parking'],
    langs: ['en', 'hi'], emergency: false, beds: 25, placeId: 'DEMO_PLACE_magarpatta_daycare', verified: false,
    reviewCount: 0, ratingBias: 0, desc: 'Day-care surgical centre currently completing FlowCare operational onboarding.' },

  { slug: 'katraj-trust-charitable', name: 'Katraj Trust Charitable Hospital', type: 'trust', area: 'Katraj', city: 'Pune', state: 'Maharashtra', lat: 18.4529, lng: 73.86,
    depts: ['general-medicine', 'dentistry', 'ophthalmology', 'physiotherapy'],
    services: ['pharmacy', 'diagnostic-lab', 'health-checkup'],
    access: ['ramp-access'],
    langs: ['mr', 'hi'], emergency: false, beds: 50, placeId: null, verified: true,
    reviewCount: 8, ratingBias: -0.2, desc: 'Charitable hospital with weekday morning OPD and low-cost dental camps.' },

  { slug: 'nashik-road-wellness', name: 'Nashik Road Wellness Hospital', type: 'multispecialty', area: 'Nashik Road', city: 'Nashik', state: 'Maharashtra', lat: 19.9475, lng: 73.838,
    depts: ['general-medicine', 'cardiology', 'orthopaedics', 'dermatology'],
    services: ['pharmacy', 'diagnostic-lab', 'radiology', 'health-checkup'],
    access: ['wheelchair-accessible-entrance', 'lift-access'],
    langs: ['mr', 'hi', 'en'], emergency: true, beds: 120, placeId: 'DEMO_PLACE_nashik_wellness', verified: true,
    reviewCount: 14, ratingBias: 0.25, desc: 'Regional multispecialty hospital serving the Nashik Road corridor.' },

  { slug: 'andheri-east-metro', name: 'Andheri East Metro Hospital', type: 'multispecialty', area: 'Andheri East', city: 'Mumbai', state: 'Maharashtra', lat: 19.1136, lng: 72.8697,
    depts: ['cardiology', 'general-medicine', 'orthopaedics', 'neurology', 'dermatology', 'ent'],
    services: ['pharmacy', 'diagnostic-lab', 'mri', 'ct-scan', 'day-care-surgery', 'ambulance'],
    access: ['wheelchair-accessible-entrance', 'wheelchair-accessible-parking', 'lift-access', 'wheelchair-accessible-restroom'],
    langs: ['en', 'hi', 'mr', 'gu'], emergency: true, beds: 300, placeId: 'DEMO_PLACE_andheri_metro', verified: true,
    reviewCount: 25, ratingBias: 0.2, desc: 'Metro-area multispecialty hospital with extended OPD hours.' },
];

const HOURS_STANDARD = {
  Monday: '08:00–20:00', Tuesday: '08:00–20:00', Wednesday: '08:00–20:00',
  Thursday: '08:00–20:00', Friday: '08:00–20:00', Saturday: '08:00–17:00', Sunday: 'Closed',
};
const HOURS_24 = {
  Monday: 'Open 24 hours', Tuesday: 'Open 24 hours', Wednesday: 'Open 24 hours',
  Thursday: 'Open 24 hours', Friday: 'Open 24 hours', Saturday: 'Open 24 hours', Sunday: 'Open 24 hours',
};

export const DEMO_USERS = {
  patient: { id: 'demo-patient-0001', name: 'Demo Patient', role: 'patient' as const, email: 'patient@demo.flowcare.local' },
  patient2: { id: 'demo-patient-0002', name: 'Second Patient', role: 'patient' as const, email: 'patient2@demo.flowcare.local' },
  staff: { id: 'demo-staff-0001', name: 'Demo Staff (Baner Ridge)', role: 'staff' as const, email: 'staff@demo.flowcare.local', hospitalId: 'baner-ridge-multispecialty' },
  admin: { id: 'demo-admin-0001', name: 'Demo Admin', role: 'admin' as const, email: 'admin@demo.flowcare.local', hospitalId: 'baner-ridge-multispecialty' },
};

function buildHospitals(): Hospital[] {
  return SPECS.map((s) => ({
    id: s.slug,
    slug: s.slug,
    name: s.name,
    type: s.type,
    addressLine: `${s.area}, ${s.city}`,
    city: s.city,
    state: s.state,
    postalCode: null,
    location: { lat: s.lat, lng: s.lng },
    phone: `+91 20 4${String(1000000 + Math.abs(hash(s.slug)) % 899999)}`,
    website: `https://example.invalid/${s.slug}`,
    flowcareVerified: s.verified,
    onboardedAt: s.verified ? iso(daysAgo(400 + (Math.abs(hash(s.slug)) % 300))) : null,
    departments: s.depts.map((d, i) => ({
      id: `${s.slug}:dept:${d}`, hospitalId: s.slug, specialty: d,
      name: d.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
      active: !(s.slug === 'magarpatta-daycare-surgical' && i > 0),
    })),
    services: s.services.map((sv) => ({
      id: `${s.slug}:svc:${sv}`, hospitalId: s.slug, slug: sv,
      name: sv.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
    })),
    accessibility: s.access,
    languages: s.langs,
    operatingHours: s.emergency ? HOURS_24 : HOURS_STANDARD,
    emergencyServices: s.emergency,
    bedCount: s.beds,
    description: s.desc,
    placeLink: s.placeId
      ? {
          hospitalId: s.slug, placeId: s.placeId, matchMethod: 'manual_admin',
          matchConfidence: 1, verifiedBy: DEMO_USERS.admin.id,
          verifiedAt: iso(daysAgo(30)), cachedLat: s.lat, cachedLng: s.lng,
          cachedCoordsAt: iso(daysAgo(2)),
        }
      : { hospitalId: s.slug, placeId: '', matchMethod: 'unlinked', matchConfidence: null, verifiedBy: null, verifiedAt: null, cachedLat: null, cachedLng: null, cachedCoordsAt: null },
    isDemoRecord: true,
  }));
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function buildSessions(hospitals: Hospital[]): ClinicSession[] {
  const out: ClinicSession[] = [];
  for (const h of hospitals) {
    const r = rng(Math.abs(hash(h.id)));
    // Deliberate data states for testing:
    //  - magarpatta: no sessions at all -> availability 'unknown'
    //  - katraj: all sessions full -> 'none'
    if (h.id === 'magarpatta-daycare-surgical') continue;
    for (const dept of h.departments.filter((d) => d.active)) {
      for (let day = 0; day < 21; day++) {
        const d = daysAhead(day);
        if (d.getDay() === 0 && !h.emergencyServices) continue;
        if (r() < 0.35) continue;
        const capacity = 8 + Math.floor(r() * 22);
        // katraj is deliberately saturated so the 'none' availability state is
        // always exercised; shivajinagar sits near the 'limited' boundary.
        const fullBias = h.id === 'shivajinagar-government-general' ? 0.93 : 0.55;
        const booked = h.id === 'katraj-trust-charitable'
          ? capacity
          : Math.min(capacity, Math.round(capacity * (fullBias * (0.6 + r() * 0.6))));
        out.push({
          id: `${dept.id}:${dateOnly(d)}`,
          hospitalId: h.id,
          departmentId: dept.id,
          date: dateOnly(d),
          startTime: r() < 0.5 ? '09:30' : '16:00',
          endTime: r() < 0.5 ? '13:00' : '20:00',
          capacity,
          booked,
          status: booked >= capacity ? 'full' : 'open',
        });
      }
    }
  }
  return out;
}

function buildAppointments(hospitals: Hospital[]): Appointment[] {
  const out: Appointment[] = [];
  let n = 0;
  for (const h of hospitals) {
    const r = rng(Math.abs(hash(h.id + ':appt')));
    const depts = h.departments.filter((d) => d.active);
    if (!depts.length) continue;
    const count = Math.max(2, Math.round(r() * 10));
    for (let i = 0; i < count; i++) {
      const dept = depts[Math.floor(r() * depts.length)];
      const past = r() < 0.75;
      const when = past ? daysAgo(3 + Math.floor(r() * 500)) : daysAhead(1 + Math.floor(r() * 14));
      n += 1;
      out.push({
        id: `appt-${h.id}-${i}`,
        hospitalId: h.id,
        patientId: i === 0 ? DEMO_USERS.patient.id : i === 1 ? DEMO_USERS.patient2.id : `demo-patient-${String(1000 + n)}`,
        departmentId: dept.id,
        sessionId: `${dept.id}:${dateOnly(when)}`,
        scheduledFor: iso(when),
        status: past ? (r() < 0.9 ? 'completed' : 'no_show') : 'booked',
        completedAt: past ? iso(when) : null,
      });
    }
  }
  return out;
}

const COMMENTS = [
  'OPD registration was quick and the token queue moved on time.',
  'Consultation started about 40 minutes after my slot, but staff kept us informed.',
  'Clean outpatient area, clear signage, easy to find the department.',
  'Front-desk staff were patient and explained the billing before the visit.',
  'Had to wait a long time for the report collection counter.',
  'Appointment rescheduling through FlowCare worked without a phone call.',
  'Parking was difficult, everything else was smooth.',
  'Doctor spent enough time and the follow-up was scheduled in the app.',
  null, null,
];

function buildReviews(hospitals: Hospital[], appts: Appointment[]): HospitalReview[] {
  const out: HospitalReview[] = [];
  for (const h of hospitals) {
    const spec = SPECS.find((s) => s.slug === h.id)!;
    const r = rng(Math.abs(hash(h.id + ':rev')));
    const pool = appts.filter((a) => a.hospitalId === h.id && a.status === 'completed');
    for (let i = 0; i < spec.reviewCount; i++) {
      const base = 3.6 + spec.ratingBias + (r() - 0.5) * 1.6;
      const clamp = (x: number) => Math.min(5, Math.max(1, Math.round(x)));
      const overall = clamp(base);
      const appt = pool[i % Math.max(1, pool.length)];
      const ageDays = 5 + Math.floor(r() * 700);
      const status = r() < 0.04 ? 'flagged' : r() < 0.06 ? 'hidden' : 'published';
      out.push({
        id: `rev-${h.id}-${i}`,
        hospitalId: h.id,
        authorId: appt ? appt.patientId : `demo-patient-${9000 + i}`,
        authorHandle: `Verified patient · ${String.fromCharCode(65 + Math.floor(r() * 26))}.${String.fromCharCode(65 + Math.floor(r() * 26))}.`,
        appointmentId: appt ? appt.id : `appt-${h.id}-synthetic-${i}`,
        ratings: {
          overall,
          waiting: clamp(base - 0.6 + r() * 0.8),
          staff: clamp(base + 0.2 + (r() - 0.5) * 0.6),
          appointment: clamp(base + 0.1 + (r() - 0.5) * 0.8),
          facility: clamp(base + (r() - 0.5) * 0.8),
        },
        comment: COMMENTS[Math.floor(r() * COMMENTS.length)] ?? null,
        createdAt: iso(daysAgo(ageDays)),
        status: status as HospitalReview['status'],
        verifiedVisit: true,
        helpfulCount: Math.floor(r() * 12),
      });
    }
  }
  return out;
}

function buildQueues(hospitals: Hospital[]): QueueSnapshot[] {
  return hospitals.map((h) => {
    const publishes = ['shivajinagar-government-general', 'baner-ridge-multispecialty', 'pimpri-teaching-research', 'deccan-gymkhana-multispecialty'].includes(h.id);
    const r = rng(Math.abs(hash(h.id + ':q')));
    return {
      hospitalId: h.id,
      published: publishes,
      waitingCount: publishes ? 4 + Math.floor(r() * 40) : null,
      medianWaitMinutes: publishes ? 12 + Math.floor(r() * 70) : null,
      observedAt: publishes ? iso(new Date(Date.now() - Math.floor(r() * 25) * 60_000)) : null,
    };
  });
}

const hospitals = buildHospitals();
const sessions = buildSessions(hospitals);
const appointments = buildAppointments(hospitals);
const reviews = buildReviews(hospitals, appointments);
const queues = buildQueues(hospitals);

export const SEED = {
  hospitals,
  sessions,
  appointments,
  reviews,
  queues,
  reviewReports: [] as ReviewReport[],
  moderationEvents: [] as ModerationEvent[],
};
