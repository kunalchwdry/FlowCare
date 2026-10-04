/**
 * Deterministic natural-language -> structured filter parser.
 *
 * This is the guaranteed path: it runs when no LLM is configured, when the
 * provider errors or times out, and as a validation companion to the LLM. It
 * contains no network calls and is fully unit-tested.
 */
import { SPECIALTIES, type AiFilters } from '@/lib/discovery/filters';
import { CITY_ANCHORS } from '@/lib/discovery/geo';

/** Lay term -> canonical specialty. Ordered: longer phrases first. */
export const SPECIALTY_SYNONYMS: Array<[RegExp, (typeof SPECIALTIES)[number]]> = [
  [/\b(cardio\w*|heart|cardiac|chest pain clinic)\b/i, 'cardiology'],
  [/\b(derma\w*|skin|acne|eczema|psoriasis|hair fall)\b/i, 'dermatology'],
  [/\b(ortho\w*|bone|joint|knee|fracture|spine)\b/i, 'orthopaedics'],
  [/\b(paed\w*|ped\w*|child|children|kids?|infant)\b/i, 'paediatrics'],
  [/\b(gyn\w*|obstetric\w*|women'?s health|pregnan\w*|maternity)\b/i, 'gynaecology'],
  [/\b(ent|ear nose|throat|audiolog\w*)\b/i, 'ent'],
  [/\b(ophthal\w*|eye|vision|cataract|optometr\w*)\b/i, 'ophthalmology'],
  [/\b(neuro\w*|brain|nerve|migraine|epilep\w*)\b/i, 'neurology'],
  [/\b(gastro\w*|stomach|digest\w*|liver|endoscop\w*)\b/i, 'gastroenterology'],
  [/\b(pulmo\w*|lung|respirat\w*|asthma|breathing)\b/i, 'pulmonology'],
  [/\b(endocrin\w*|diabet\w*|thyroid|hormone)\b/i, 'endocrinology'],
  [/\b(nephro\w*|kidney|renal|dialysis clinic)\b/i, 'nephrology'],
  [/\b(psychiat\w*|mental health|depress\w*|anxiety|counsell?ing)\b/i, 'psychiatry'],
  [/\b(dent\w*|teeth|tooth|oral)\b/i, 'dentistry'],
  [/\b(physio\w*|rehab\w*)\b/i, 'physiotherapy'],
  [/\b(urolog\w*|urinary|prostate)\b/i, 'urology'],
  [/\b(oncolog\w*|cancer|tumour|tumor|chemo\w*)\b/i, 'oncology'],
  [/\b(general medicine|physician|general ?practi\w*|fever clinic|gp)\b/i, 'general-medicine'],
];

const SERVICE_PATTERNS: Array<[RegExp, string]> = [
  [/\bpharmac\w*|medical store\b/i, 'pharmacy'],
  [/\b(lab|pathology|blood test)\b/i, 'diagnostic-lab'],
  [/\bx-?ray|radiolog\w*\b/i, 'radiology'],
  [/\bmri\b/i, 'mri'],
  [/\bct ?scan|cat ?scan\b/i, 'ct-scan'],
  [/\bultrasound|sonograph\w*\b/i, 'ultrasound'],
  [/\bday ?care surgery\b/i, 'day-care-surgery'],
  [/\bvaccin\w*|immunis\w*|immuniz\w*\b/i, 'vaccination'],
  [/\bhealth check(-| )?up|master health\b/i, 'health-checkup'],
  [/\bambulance\b/i, 'ambulance'],
  [/\bblood bank\b/i, 'blood-bank'],
  [/\bdialysis\b/i, 'dialysis'],
];

const TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\bmulti-?special\w*\b/i, 'multispecialty'],
  [/\bsuper-?special\w*|special(i[sz])?ed\b/i, 'specialty'],
  [/\bclinic\b/i, 'clinic'],
  [/\bgovern\w*|govt|public hospital|civil hospital\b/i, 'government'],
  [/\btrust|charitab\w*\b/i, 'trust'],
  [/\bteaching|medical college\b/i, 'teaching'],
];

const ACCESS_PATTERNS: Array<[RegExp, string]> = [
  [/\bwheel ?chair\b/i, 'wheelchair-accessible-entrance'],
  [/\bramp\b/i, 'ramp-access'],
  [/\blift|elevator\b/i, 'lift-access'],
  [/\bsign language\b/i, 'sign-language-support'],
  [/\bbraille\b/i, 'braille-signage'],
];

const LANGUAGE_PATTERNS: Array<[RegExp, string]> = [
  [/\bmarathi\b/i, 'mr'], [/\bhindi\b/i, 'hi'], [/\benglish\b/i, 'en'],
  [/\bgujarati\b/i, 'gu'], [/\btamil\b/i, 'ta'], [/\btelugu\b/i, 'te'],
  [/\bkannada\b/i, 'kn'], [/\bbengali\b/i, 'bn'], [/\burdu\b/i, 'ur'],
];

/** Phrases that mean "this person may need urgent care" — never triage, just signpost. */
const EMERGENCY_PATTERNS =
  /\b(emergency|ambulance now|right now|severe|unconscious|bleeding heavily|can'?t breathe|cannot breathe|heart attack|cardiac attack|cardiac arrest|cardiac emergency|stroke|chest pain|suicide|self[- ]harm|overdose|accident|snake\s*bite|snake has bitten|poison(?:ed|ing)?|anaphylaxis|severe allergic reaction)\b/i;

export interface FallbackParse {
  filters: AiFilters;
  /** Short, factual reasons describing what the parser did. */
  notes: string[];
  emergencySignal: boolean;
}

export function parseQueryDeterministic(raw: string): FallbackParse {
  const text = (raw ?? '').slice(0, 400);
  const notes: string[] = [];
  const filters: AiFilters = {};

  const specialties = new Set<string>();
  for (const [re, slug] of SPECIALTY_SYNONYMS) {
    if (re.test(text)) specialties.add(slug);
  }
  for (const s of SPECIALTIES) {
    if (new RegExp(`\\b${s.replace('-', '[ -]?')}\\b`, 'i').test(text)) specialties.add(s);
  }
  if (specialties.size) {
    filters.specialties = [...specialties].slice(0, 6) as AiFilters['specialties'];
    notes.push(`department: ${[...specialties].join(', ')}`);
  }

  const services = new Set<string>();
  for (const [re, slug] of SERVICE_PATTERNS) if (re.test(text)) services.add(slug);
  if (services.size) {
    filters.services = [...services].slice(0, 8) as AiFilters['services'];
    notes.push(`services: ${[...services].join(', ')}`);
  }

  const types = new Set<string>();
  for (const [re, slug] of TYPE_PATTERNS) if (re.test(text)) types.add(slug);
  if (types.size) {
    filters.hospitalTypes = [...types].slice(0, 6) as AiFilters['hospitalTypes'];
    notes.push(`hospital type: ${[...types].join(', ')}`);
  }

  const access = new Set<string>();
  for (const [re, slug] of ACCESS_PATTERNS) if (re.test(text)) access.add(slug);
  if (access.size) {
    filters.accessibility = [...access] as AiFilters['accessibility'];
    notes.push(`accessibility: ${[...access].join(', ')}`);
  }

  const langs = new Set<string>();
  for (const [re, slug] of LANGUAGE_PATTERNS) if (re.test(text)) langs.add(slug);
  if (langs.size) {
    filters.languages = [...langs] as AiFilters['languages'];
    notes.push(`language: ${[...langs].join(', ')}`);
  }

  // City: "in <city>" / "near <city>" / bare known city name.
  for (const city of Object.keys(CITY_ANCHORS)) {
    const pretty = city.replace(/-/g, '[ -]?');
    if (new RegExp(`\\b(in|at|near|around)\\s+${pretty}\\b`, 'i').test(text) || new RegExp(`\\b${pretty}\\b`, 'i').test(text)) {
      filters.city = city.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-');
      notes.push(`city: ${filters.city}`);
      break;
    }
  }

  if (/\bnear me\b|\bnearby\b|\bclose(st)? to me\b|\baround me\b|\bwalking distance\b/i.test(text)) {
    filters.useUserLocation = true;
    filters.radiusKm = filters.radiusKm ?? 10;
    notes.push('near your location (10 km)');
  }

  const km = text.match(/\b(\d{1,2}(?:\.\d)?)\s*(km|kilomet\w*)\b/i);
  if (km) {
    filters.radiusKm = Math.min(100, Number(km[1]));
    filters.useUserLocation = true;
    notes.push(`within ${filters.radiusKm} km`);
  }

  if (/\bavailab\w*|\bfree slot|\bopen slot|\bbook(able)? (today|tomorrow|this week)|\bappointment[s]? (available|open)\b/i.test(text)) {
    filters.availability = ['available', 'limited'];
    notes.push('has bookable FlowCare appointments');
  }
  if (/\btoday\b/i.test(text)) { filters.availableWithinDays = 1; notes.push('slot within 1 day'); }
  else if (/\btomorrow\b/i.test(text)) { filters.availableWithinDays = 2; notes.push('slot within 2 days'); }
  else if (/\bthis week\b|\bwithin (a|one) week\b|\bnext 7 days\b/i.test(text)) { filters.availableWithinDays = 7; notes.push('slot within 7 days'); }
  else if (/\bthis month\b|\bnext 30 days\b/i.test(text)) { filters.availableWithinDays = 30; notes.push('slot within 30 days'); }

  if (/\bopen now\b|\bopen right now\b|\bcurrently open\b/i.test(text)) {
    filters.openNow = true;
    notes.push('open at the moment');
  }
  if (/\b24 ?(x|\/)? ?7|round the clock|emergency (services|department|ward)\b/i.test(text)) {
    filters.emergencyServices = true;
    notes.push('has emergency services');
  }

  const prioritise: NonNullable<NonNullable<AiFilters['preference']>['prioritise']> = [];
  if (/\bgood (patient )?reviews?\b|\bwell[- ]rated\b|\bhighly rated\b|\bbest rated\b|\btop rated\b|\bgood rating\b/i.test(text)) {
    filters.minReviewCount = 5;
    prioritise.push('rating', 'review_count');
    notes.push('prefers hospitals with more/better verified reviews');
  }
  const ratingNum = text.match(/\b(\d(?:\.\d)?)\+?\s*(?:star|★|rating)\b/i);
  if (ratingNum) {
    const v = Math.min(5, Math.max(1, Number(ratingNum[1])));
    filters.minGoogleRating = v;
    notes.push(`Google rating ≥ ${v}`);
  }
  if (/\bclos(er|est)\b|\bnearest\b|\bprefer.*clos\w*|\beven if.*fewer reviews\b|\bshort(est)? (distance|travel)\b/i.test(text)) {
    prioritise.push('distance');
    notes.push('prioritises distance');
  }
  if (/\bshort(est)? wait|\bless wait\w*|\bno queue|\bquick appointment\b/i.test(text)) {
    prioritise.push('availability');
    notes.push('prioritises appointment availability');
  }
  if (prioritise.length) filters.preference = { prioritise: [...new Set(prioritise)] as typeof prioritise };

  // Residual free text -> `q`, only if nothing structured was found.
  if (Object.keys(filters).length === 0) {
    const cleaned = text.replace(/\b(hospital|hospitals|clinic|clinics|find|show|me|near|please|a|an|the|with|and|for)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    if (cleaned) { filters.q = cleaned.slice(0, 120); notes.push(`keyword: "${filters.q}"`); }
  }

  return { filters, notes, emergencySignal: EMERGENCY_PATTERNS.test(text) };
}

/** Search-box autocomplete suggestions derived from FlowCare's own taxonomy. */
export function suggestQueries(prefix: string, limit = 8): Array<{ label: string; href: string; kind: string }> {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  const out: Array<{ label: string; href: string; kind: string }> = [];

  const matched = new Set<string>();
  for (const [re, slug] of SPECIALTY_SYNONYMS) {
    if (re.test(p) || slug.startsWith(p)) matched.add(slug);
  }
  for (const slug of matched) {
    const pretty = slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    out.push({ label: pretty, href: `/hospitals?specialty=${slug}`, kind: 'Department' });
    out.push({ label: `${pretty} hospitals`, href: `/hospitals?specialty=${slug}`, kind: 'Search' });
    out.push({ label: `${pretty} hospitals near me`, href: `/hospitals?specialty=${slug}&near=me&radiusKm=10`, kind: 'Near me' });
    out.push({ label: `${pretty} with appointments this week`, href: `/hospitals?specialty=${slug}&availableWithinDays=7`, kind: 'Availability' });
  }

  for (const city of Object.keys(CITY_ANCHORS)) {
    if (city.startsWith(p) || p.includes(city)) {
      const pretty = city.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-');
      out.push({ label: `Hospitals in ${pretty}`, href: `/hospitals?city=${encodeURIComponent(pretty)}`, kind: 'Location' });
    }
  }

  if ('near me'.startsWith(p) || p.includes('near')) {
    out.push({ label: 'Hospitals near me', href: '/hospitals?near=me&radiusKm=10', kind: 'Near me' });
  }

  return out.slice(0, limit);
}
