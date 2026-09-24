/**
 * F1 — Care Need Translator.
 *
 * Problem P1: patients search in lay words ("chest pain", "pet dukhna") and
 * hospital directories index clinical department names. The gap is silent:
 * the search returns nothing, or worse, returns one plausible department and
 * the patient goes to the wrong counter.
 *
 * HARD CONSTRAINTS (docs/research/03-review-and-plan.md §10.1):
 *  1. An ambiguous term MUST resolve to >= 2 departments. Returning a single
 *     department for "chest pain" is indistinguishable from triage, and
 *     triage is out of scope. Enforced by a test over the whole dictionary.
 *  2. No LLM at query time. This is a static, reviewed dictionary. An LLM
 *     that invents a department is a safety failure, and this path runs on
 *     every keystroke.
 *  3. FlowCare never says what the patient has. It says which departments
 *     commonly see this, and that staff decide.
 *
 * This module also absorbs and formalises the 18 synonym patterns that
 * previously lived only in lib/ai/fallback.ts.
 */
import { SPECIALTIES } from '@/lib/discovery/filters';

export const TRANSLATOR_VERSION = 'fc-translate-v1';

type Specialty = (typeof SPECIALTIES)[number];

const SPECIALTY_LABELS: Record<Specialty, string> = {
  cardiology: 'Cardiology',
  dermatology: 'Dermatology',
  orthopaedics: 'Orthopaedics',
  paediatrics: 'Paediatrics',
  gynaecology: 'Gynaecology',
  ent: 'ENT',
  ophthalmology: 'Ophthalmology',
  neurology: 'Neurology',
  gastroenterology: 'Gastroenterology',
  pulmonology: 'Pulmonology',
  endocrinology: 'Endocrinology',
  nephrology: 'Nephrology',
  psychiatry: 'Psychiatry',
  dentistry: 'Dentistry',
  physiotherapy: 'Physiotherapy',
  urology: 'Urology',
  oncology: 'Oncology',
  'general-medicine': 'General Medicine',
};

export function specialtyLabel(slug: string): string {
  return SPECIALTY_LABELS[slug as Specialty] ?? slug;
}

export interface CareNeedEntry {
  /** Canonical display of the lay term. */
  term: string;
  /** Matching patterns, including Hindi/Marathi transliterations. */
  patterns: RegExp[];
  /**
   * Departments that commonly see this, most common first.
   * >= 2 entries whenever `ambiguous` is true.
   */
  departments: Specialty[];
  /** Why each department is plausible — shown verbatim, one per department. */
  reasons: string[];
  /**
   * True when the lay term genuinely spans departments. False only for terms
   * that are already a department name in plain words (e.g. "toothache").
   */
  ambiguous: boolean;
}

/**
 * The dictionary. Every entry is a mapping from everyday words to the
 * departments that typically run the relevant clinic — it is NOT a symptom
 * checker and encodes no probability of any condition.
 */
export const CARE_NEEDS: CareNeedEntry[] = [
  {
    term: 'chest pain',
    patterns: [/\bchest pain\b/i, /\bchhati (me[ni]?n?|mein) dard\b/i, /\bchati dukhte\b/i],
    departments: ['cardiology', 'general-medicine', 'gastroenterology', 'pulmonology'],
    reasons: [
      'Runs the cardiac clinic and ECG.',
      'Usually the first stop when the cause is not yet known.',
      'Acidity and reflux are common causes of chest discomfort.',
      'Chest pain that comes with breathlessness or cough.',
    ],
    ambiguous: true,
  },
  {
    term: 'stomach pain',
    patterns: [/\b(stomach|abdominal|tummy|belly) (pain|ache)\b/i, /\bpet (me[ni]?n?|mein) dard\b/i, /\bpot dukhte\b/i],
    departments: ['gastroenterology', 'general-medicine', 'urology', 'gynaecology'],
    reasons: [
      'Digestive causes, endoscopy if needed.',
      'General assessment when the cause is unclear.',
      'Kidney and urinary stones present as abdominal pain.',
      'Lower abdominal pain in women may be gynaecological.',
    ],
    ambiguous: true,
  },
  {
    term: 'headache',
    patterns: [/\bhead ?ache\b/i, /\bmigraine\b/i, /\bsar ?dard\b/i, /\bdoke dukhte\b/i],
    departments: ['general-medicine', 'neurology', 'ophthalmology', 'ent'],
    reasons: [
      'First stop for most headaches.',
      'Frequent, severe or changing headaches.',
      'Headaches linked to eye strain or vision.',
      'Headaches linked to sinuses.',
    ],
    ambiguous: true,
  },
  {
    term: 'dizziness',
    patterns: [/\bdizz(y|iness)\b/i, /\bvertigo\b/i, /\bgiddi(ness)?\b/i, /\bchakkar\b/i],
    departments: ['ent', 'neurology', 'general-medicine', 'cardiology'],
    reasons: [
      'Balance problems often start in the inner ear.',
      'Dizziness with numbness, weakness or speech change.',
      'Dizziness from anaemia, sugar or blood pressure.',
      'Dizziness with palpitations or fainting.',
    ],
    ambiguous: true,
  },
  {
    term: 'breathlessness',
    patterns: [/\bbreathless\w*\b/i, /\bshortness of breath\b/i, /\bcan'?t breathe\b/i, /\bsaans\b/i, /\bdum lagne\b/i],
    departments: ['pulmonology', 'cardiology', 'general-medicine'],
    reasons: [
      'Asthma, COPD and other lung causes.',
      'Breathlessness on exertion or with swelling.',
      'General assessment when the cause is unclear.',
    ],
    ambiguous: true,
  },
  {
    term: 'back pain',
    patterns: [/\bback ?(pain|ache)\b/i, /\bslip(ped)? disc\b/i, /\bkamar dard\b/i, /\bpath dukhte\b/i],
    departments: ['orthopaedics', 'physiotherapy', 'general-medicine', 'nephrology'],
    reasons: [
      'Spine, disc and joint causes.',
      'Rehabilitation and exercise-based treatment.',
      'First stop if you are unsure.',
      'Pain in the flank can come from the kidneys.',
    ],
    ambiguous: true,
  },
  {
    term: 'swollen legs',
    patterns: [/\bswollen (legs?|feet|ankles?)\b/i, /\b(leg|foot|ankle) swelling\b/i, /\bpair (me[ni]?n?|mein) sujan\b/i],
    departments: ['general-medicine', 'cardiology', 'nephrology'],
    reasons: [
      'First stop for new swelling.',
      'Swelling with breathlessness may be cardiac.',
      'Swelling with changes in urine may be renal.',
    ],
    ambiguous: true,
  },
  {
    term: 'fatigue',
    patterns: [/\b(tired|fatigue|weakness|exhaust\w*)\b/i, /\bthakan\b/i, /\bkamzori\b/i],
    departments: ['general-medicine', 'endocrinology', 'psychiatry'],
    reasons: [
      'Blood tests for anaemia, sugar and thyroid usually start here.',
      'Thyroid and diabetes-related tiredness.',
      'Tiredness with low mood or poor sleep.',
    ],
    ambiguous: true,
  },
  {
    term: 'fever',
    patterns: [/\bfever\b/i, /\btemperature\b/i, /\bbukhar\b/i, /\btaap\b/i],
    departments: ['general-medicine', 'paediatrics'],
    reasons: [
      'Fever clinic for adults.',
      'Fever in children under 12.',
    ],
    ambiguous: true,
  },
  {
    term: 'rash',
    patterns: [/\b(rash|itch\w*|hives|skin problem)\b/i, /\bkhujli\b/i, /\bkharuj\b/i],
    departments: ['dermatology', 'general-medicine', 'paediatrics'],
    reasons: [
      'Skin conditions and allergy patch testing.',
      'Rash with fever or feeling unwell.',
      'Rashes in children.',
    ],
    ambiguous: true,
  },
  {
    term: 'lump or swelling',
    patterns: [/\b(lump|swelling|gaanth|knot under skin)\b/i, /\bganth\b/i],
    departments: ['general-medicine', 'oncology', 'dermatology'],
    reasons: [
      'First assessment and referral.',
      'If a specialist has advised a cancer work-up.',
      'Lumps arising in the skin itself.',
    ],
    ambiguous: true,
  },
  {
    term: 'blood sugar problems',
    patterns: [/\b(diabet\w*|blood sugar|sugar problem)\b/i, /\bmadhumeh\b/i, /\bsakhar\b/i],
    departments: ['endocrinology', 'general-medicine'],
    reasons: [
      'Dedicated diabetes clinic.',
      'Routine diabetes follow-up and medication.',
    ],
    ambiguous: true,
  },
  {
    term: 'high blood pressure',
    patterns: [/\b(high blood pressure|hypertension|bp problem)\b/i, /\brakt ?chaap\b/i],
    departments: ['general-medicine', 'cardiology', 'nephrology'],
    reasons: [
      'Routine blood pressure management.',
      'Blood pressure with heart symptoms.',
      'Blood pressure linked to kidney disease.',
    ],
    ambiguous: true,
  },
  {
    term: 'pregnancy care',
    patterns: [/\b(pregnan\w*|antenatal|maternity|delivery|garbh\w*)\b/i, /\bpregnancy\b/i],
    departments: ['gynaecology'],
    reasons: ['Antenatal clinic and delivery.'],
    ambiguous: false,
  },
  {
    term: 'child vaccination',
    patterns: [/\b(vaccin\w*|immuni[sz]\w*|tika)\b/i],
    departments: ['paediatrics', 'general-medicine'],
    reasons: [
      'Childhood immunisation schedule.',
      'Adult and travel vaccination.',
    ],
    ambiguous: true,
  },
  {
    term: 'eye problem',
    patterns: [/\b(eye|vision|sight|cataract|blurr\w*)\b/i, /\baankh\b/i, /\bdola\b/i],
    departments: ['ophthalmology'],
    reasons: ['Eye examination, cataract and vision testing.'],
    ambiguous: false,
  },
  {
    term: 'toothache',
    patterns: [/\b(tooth ?ache|dental|teeth|gum)\b/i, /\bdaant\b/i],
    departments: ['dentistry'],
    reasons: ['Dental examination and treatment.'],
    ambiguous: false,
  },
  {
    term: 'hearing problem',
    patterns: [/\b(hearing|deaf\w*|ear pain|tinnitus)\b/i, /\bkaan\b/i],
    departments: ['ent'],
    reasons: ['Hearing tests and ear conditions.'],
    ambiguous: false,
  },
  {
    term: 'low mood or anxiety',
    patterns: [/\b(depress\w*|anxiet\w*|anxious|panic|mental health|counsell?ing|sleep problem)\b/i, /\btanaav\b/i],
    departments: ['psychiatry', 'general-medicine'],
    reasons: [
      'Mental health assessment and therapy.',
      'First conversation if you would rather start there.',
    ],
    ambiguous: true,
  },
  {
    term: 'urine problems',
    patterns: [/\b(urine|urinary|burning while|prostate|kidney stone)\b/i, /\bpeshab\b/i],
    departments: ['urology', 'nephrology', 'general-medicine'],
    reasons: [
      'Stones, prostate and urinary tract.',
      'Kidney function and dialysis.',
      'Simple urinary infections.',
    ],
    ambiguous: true,
  },
  {
    term: 'injury or fracture',
    patterns: [/\b(fracture|broken bone|sprain|injur\w*|accident)\b/i, /\bchot\b/i],
    departments: ['orthopaedics', 'general-medicine'],
    reasons: [
      'Bone and joint injuries, plaster.',
      'Minor injuries and dressings.',
    ],
    ambiguous: true,
  },
  {
    term: 'joint pain',
    patterns: [/\b(joint pain|arthrit\w*|knee pain|shoulder pain)\b/i, /\bsandhi ?vaat\b/i],
    departments: ['orthopaedics', 'physiotherapy', 'general-medicine'],
    reasons: [
      'Joint examination and imaging.',
      'Exercise therapy and mobility.',
      'Joint pain with fever or multiple joints involved.',
    ],
    ambiguous: true,
  },
];

export interface TranslatedDepartment {
  slug: Specialty;
  label: string;
  reason: string;
}

export interface Translation {
  term: string;
  departments: TranslatedDepartment[];
  ambiguous: boolean;
  /** Shown verbatim above the department list. */
  guidance: string;
}

export const AMBIGUOUS_GUIDANCE =
  'Different hospitals put this under different departments. FlowCare cannot ' +
  'tell you which one you need — hospital staff decide that. Any of these is ' +
  'a reasonable place to start.';

export const SINGLE_GUIDANCE =
  'This is usually handled by the department below. Hospital staff will ' +
  'redirect you if a different department is a better fit.';

export const EMERGENCY_NOTICE =
  'If this is a medical emergency, do not use FlowCare to search. ' +
  'Call 108 or go to the nearest emergency department now.';

/**
 * Terms where the right answer is "stop using this app". We surface the
 * emergency notice and still return departments, because suppressing results
 * would be its own harm — but the notice is shown first and is not dismissible.
 */
const EMERGENCY_PATTERNS: RegExp[] = [
  /\b(heart attack|cardiac arrest|stroke|unconscious|not breathing|severe bleeding|poison\w*|suicid\w*|overdose)\b/i,
  /\bcrushing chest pain\b/i,
];

export function looksLikeEmergency(query: string): boolean {
  return EMERGENCY_PATTERNS.some((re) => re.test(query));
}

function toTranslation(entry: CareNeedEntry): Translation {
  return {
    term: entry.term,
    ambiguous: entry.ambiguous,
    guidance: entry.ambiguous ? AMBIGUOUS_GUIDANCE : SINGLE_GUIDANCE,
    departments: entry.departments.map((slug, i) => ({
      slug,
      label: specialtyLabel(slug),
      reason: entry.reasons[i] ?? '',
    })),
  };
}

export interface TranslateResult {
  query: string;
  emergency: boolean;
  emergencyNotice: string | null;
  translations: Translation[];
  /** Union of all suggested department slugs, deduped, in confidence order. */
  suggestedSpecialties: Specialty[];
  version: string;
}

/**
 * Translate a lay query. Pure, synchronous, no network, no LLM.
 *
 * Multiple entries can match ("chest pain and breathlessness") and all are
 * returned — narrowing to one would be triage.
 */
export function translate(query: string): TranslateResult {
  const q = (query ?? '').slice(0, 200);
  const matched = CARE_NEEDS.filter((entry) =>
    entry.patterns.some((re) => re.test(q)),
  );

  const translations = matched.map(toTranslation);

  const seen = new Set<Specialty>();
  const suggestedSpecialties: Specialty[] = [];
  for (const t of translations) {
    for (const d of t.departments) {
      if (!seen.has(d.slug)) {
        seen.add(d.slug);
        suggestedSpecialties.push(d.slug);
      }
    }
  }

  const emergency = looksLikeEmergency(q);

  return {
    query: q,
    emergency,
    emergencyNotice: emergency ? EMERGENCY_NOTICE : null,
    translations,
    suggestedSpecialties,
    version: TRANSLATOR_VERSION,
  };
}
