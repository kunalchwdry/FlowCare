/**
 * The single source of truth for what a discovery query may contain.
 *
 * SECURITY NOTE: this schema is the boundary between untrusted text (user
 * input, LLM output) and the data layer. The LLM never emits SQL, table
 * names, column names or operators - it may only emit a JSON object that
 * survives `DiscoveryFiltersSchema.parse`. Anything else is rejected and we
 * fall back to the deterministic parser.
 */
import { z } from 'zod';

/** Allowlist of specialties FlowCare can actually filter on. */
export const SPECIALTIES = [
  'cardiology', 'dermatology', 'orthopaedics', 'paediatrics', 'gynaecology',
  'general-medicine', 'ent', 'ophthalmology', 'neurology', 'gastroenterology',
  'pulmonology', 'endocrinology', 'nephrology', 'psychiatry', 'dentistry',
  'physiotherapy', 'urology', 'oncology',
] as const;
export type Specialty = (typeof SPECIALTIES)[number];

export const HOSPITAL_TYPES = [
  'multispecialty', 'specialty', 'clinic', 'government', 'trust', 'teaching',
] as const;

export const SERVICES = [
  'pharmacy', 'diagnostic-lab', 'radiology', 'mri', 'ct-scan', 'ultrasound',
  'day-care-surgery', 'vaccination', 'health-checkup', 'ambulance',
  'blood-bank', 'dialysis', 'physio-gym',
] as const;

export const ACCESSIBILITY_FEATURES = [
  'wheelchair-accessible-entrance', 'wheelchair-accessible-parking',
  'wheelchair-accessible-restroom', 'lift-access', 'ramp-access',
  'sign-language-support', 'braille-signage',
] as const;

export const LANGUAGES = ['en', 'hi', 'mr', 'gu', 'ta', 'te', 'kn', 'bn', 'ur'] as const;

export const AVAILABILITY_STATES = ['available', 'limited', 'none', 'unknown'] as const;

export const SORT_FIELDS = [
  'relevance', 'distance', 'flowcare_rating', 'google_rating',
  'review_count', 'availability', 'name',
] as const;

const slug = (allowed: readonly string[]) => z.enum(allowed as [string, ...string[]]);

export const DiscoveryFiltersSchema = z
  .object({
    /** Free-text name/keyword fragment. Length-capped; used for literal matching only. */
    q: z.string().trim().max(120).optional(),

    city: z.string().trim().max(80).optional(),
    /** Area / locality within a city. */
    area: z.string().trim().max(80).optional(),

    specialties: z.array(slug(SPECIALTIES)).max(6).optional(),
    services: z.array(slug(SERVICES)).max(8).optional(),
    hospitalTypes: z.array(slug(HOSPITAL_TYPES)).max(6).optional(),
    accessibility: z.array(slug(ACCESSIBILITY_FEATURES)).max(7).optional(),
    languages: z.array(slug(LANGUAGES)).max(9).optional(),

    /** Anchor point for distance. Coarsened to ~1.1 km before storage/logging. */
    near: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
    radiusKm: z.number().positive().max(100).optional(),

    availability: z.array(slug(AVAILABILITY_STATES)).max(4).optional(),
    /** Only hospitals with a bookable FlowCare session within N days. */
    availableWithinDays: z.number().int().min(1).max(60).optional(),

    minFlowcareRating: z.number().min(1).max(5).optional(),
    minGoogleRating: z.number().min(1).max(5).optional(),
    minReviewCount: z.number().int().min(0).max(10000).optional(),

    openNow: z.boolean().optional(),
    emergencyServices: z.boolean().optional(),
    flowcareVerifiedOnly: z.boolean().optional(),

    sort: slug(SORT_FIELDS).default('relevance'),
    page: z.number().int().min(1).max(200).default(1),
    pageSize: z.number().int().min(1).max(50).default(12),
  })
  .strict();

export type DiscoveryFilters = z.infer<typeof DiscoveryFiltersSchema>;

/**
 * What the LLM is allowed to produce. Deliberately a strict SUBSET of the
 * filter schema: no pagination, no sort injection, and critically no way to
 * name a hospital id. Free text `q` is length-limited.
 */
export const AiFilterSchema = DiscoveryFiltersSchema.pick({
  q: true, city: true, area: true, specialties: true, services: true,
  hospitalTypes: true, accessibility: true, languages: true, radiusKm: true,
  availability: true, availableWithinDays: true, minFlowcareRating: true,
  minGoogleRating: true, minReviewCount: true, openNow: true,
  emergencyServices: true,
}).extend({
  /** The model may express "near me" but cannot fabricate coordinates. */
  useUserLocation: z.boolean().optional(),
  /** Soft preference signals used by the transparent matcher, not hard filters. */
  preference: z
    .object({
      prioritise: z
        .array(z.enum(['distance', 'rating', 'availability', 'review_count', 'accessibility', 'language']))
        .max(6)
        .optional(),
    })
    .strict()
    .optional(),
}).strict();

export type AiFilters = z.infer<typeof AiFilterSchema>;

/** Parse URLSearchParams -> DiscoveryFilters, dropping anything unrecognised. */
export function filtersFromSearchParams(sp: URLSearchParams): DiscoveryFilters {
  const list = (k: string) => {
    const v = sp.getAll(k).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
    return v.length ? v : undefined;
  };
  const num = (k: string) => {
    const v = sp.get(k);
    if (v === null || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const bool = (k: string) => {
    const v = sp.get(k);
    if (v === null) return undefined;
    return v === 'true' || v === '1';
  };

  const lat = num('lat');
  const lng = num('lng');

  const raw: Record<string, unknown> = {
    q: sp.get('q') || undefined,
    city: sp.get('city') || undefined,
    area: sp.get('area') || undefined,
    specialties: list('specialty'),
    services: list('service'),
    hospitalTypes: list('type'),
    accessibility: list('accessibility'),
    languages: list('language'),
    near: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    radiusKm: num('radiusKm'),
    availability: list('availability'),
    availableWithinDays: num('availableWithinDays'),
    minFlowcareRating: num('minFlowcareRating'),
    minGoogleRating: num('minGoogleRating'),
    minReviewCount: num('minReviewCount'),
    openNow: bool('openNow'),
    emergencyServices: bool('emergency'),
    flowcareVerifiedOnly: bool('verified'),
    sort: sp.get('sort') || undefined,
    page: num('page'),
    pageSize: num('pageSize'),
  };

  // Drop undefined so zod defaults apply.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
  const result = DiscoveryFiltersSchema.safeParse(cleaned);
  if (result.success) return result.data;

  // Salvage: keep only what individually validates. A bad `specialty=foo` must
  // neither blank out the whole search nor silently smuggle an unknown value
  // through — it is simply dropped, and for list filters only the offending
  // ELEMENT is dropped rather than the entire filter.
  const salvaged: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cleaned)) {
    if (DiscoveryFiltersSchema.safeParse({ ...salvaged, [k]: v }).success) {
      salvaged[k] = v;
      continue;
    }
    if (Array.isArray(v)) {
      const kept = v.filter((el) => DiscoveryFiltersSchema.safeParse({ ...salvaged, [k]: [el] }).success);
      if (kept.length && DiscoveryFiltersSchema.safeParse({ ...salvaged, [k]: kept }).success) {
        salvaged[k] = kept;
      }
    }
  }
  return DiscoveryFiltersSchema.parse(salvaged);
}

export function filtersToSearchParams(f: Partial<DiscoveryFilters>): URLSearchParams {
  const sp = new URLSearchParams();
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return;
    sp.set(k, String(v));
  };
  put('q', f.q);
  put('city', f.city);
  put('area', f.area);
  if (f.specialties?.length) sp.set('specialty', f.specialties.join(','));
  if (f.services?.length) sp.set('service', f.services.join(','));
  if (f.hospitalTypes?.length) sp.set('type', f.hospitalTypes.join(','));
  if (f.accessibility?.length) sp.set('accessibility', f.accessibility.join(','));
  if (f.languages?.length) sp.set('language', f.languages.join(','));
  if (f.near) { put('lat', f.near.lat); put('lng', f.near.lng); }
  put('radiusKm', f.radiusKm);
  if (f.availability?.length) sp.set('availability', f.availability.join(','));
  put('availableWithinDays', f.availableWithinDays);
  put('minFlowcareRating', f.minFlowcareRating);
  put('minGoogleRating', f.minGoogleRating);
  put('minReviewCount', f.minReviewCount);
  if (f.openNow !== undefined) put('openNow', f.openNow);
  if (f.emergencyServices !== undefined) put('emergency', f.emergencyServices);
  if (f.flowcareVerifiedOnly !== undefined) put('verified', f.flowcareVerifiedOnly);
  if (f.sort && f.sort !== 'relevance') put('sort', f.sort);
  if (f.page && f.page > 1) put('page', f.page);
  return sp;
}

/** Human labels, reused by the UI and by the AI explanation builder. */
export const LABELS: Record<string, string> = {
  cardiology: 'Cardiology', dermatology: 'Dermatology', orthopaedics: 'Orthopaedics',
  paediatrics: 'Paediatrics', gynaecology: 'Gynaecology', 'general-medicine': 'General Medicine',
  ent: 'ENT', ophthalmology: 'Ophthalmology', neurology: 'Neurology',
  gastroenterology: 'Gastroenterology', pulmonology: 'Pulmonology',
  endocrinology: 'Endocrinology', nephrology: 'Nephrology', psychiatry: 'Psychiatry',
  dentistry: 'Dentistry', physiotherapy: 'Physiotherapy', urology: 'Urology', oncology: 'Oncology',
  multispecialty: 'Multispecialty', specialty: 'Specialty', clinic: 'Clinic',
  government: 'Government', trust: 'Trust', teaching: 'Teaching hospital',
  pharmacy: 'Pharmacy', 'diagnostic-lab': 'Diagnostic lab', radiology: 'Radiology',
  mri: 'MRI', 'ct-scan': 'CT scan', ultrasound: 'Ultrasound',
  'day-care-surgery': 'Day-care surgery', vaccination: 'Vaccination',
  'health-checkup': 'Health check-up', ambulance: 'Ambulance', 'blood-bank': 'Blood bank',
  dialysis: 'Dialysis', 'physio-gym': 'Physiotherapy gym',
  'wheelchair-accessible-entrance': 'Wheelchair-accessible entrance',
  'wheelchair-accessible-parking': 'Wheelchair-accessible parking',
  'wheelchair-accessible-restroom': 'Wheelchair-accessible restroom',
  'lift-access': 'Lift access', 'ramp-access': 'Ramp access',
  'sign-language-support': 'Sign-language support', 'braille-signage': 'Braille signage',
  en: 'English', hi: 'Hindi', mr: 'Marathi', gu: 'Gujarati', ta: 'Tamil',
  te: 'Telugu', kn: 'Kannada', bn: 'Bengali', ur: 'Urdu',
  available: 'Appointments available', limited: 'Limited availability',
  none: 'No current availability', unknown: 'Availability unknown',
};

export const label = (key: string): string => LABELS[key] ?? key;
