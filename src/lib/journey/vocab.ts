/**
 * Controlled vocabularies for the journey layer (F1–F20).
 *
 * Kept in one module so that API routes, seed data, UI components and the
 * migration all agree on the exact same closed sets. Nothing here is free
 * text, which is what makes the §9.1 prohibited-data rules enforceable.
 */

/* --------------------------------------------------------------- F7 ----- */
/**
 * Accessibility components. Deliberately granular: the research (S25, S24)
 * shows a facility can score 90% on ramps and 0% on accessible toilets, so a
 * single "wheelchair accessible" boolean is actively misleading.
 *
 * Standard references are Indian: Harmonised Guidelines and Space Standards
 * for Barrier Free Built Environment (2021), and RPwD Act 2016 §44–46.
 */
export const ACCESSIBILITY_COMPONENTS = [
  {
    code: 'step-free-entrance',
    label: 'Step-free entrance',
    question: 'Can you get from the road to the main door without steps?',
    standard: 'Harmonised Guidelines 2021, §3.2',
  },
  {
    code: 'ramp-standard',
    label: 'Ramp at a usable gradient',
    question: 'Is the ramp 1:12 or gentler, with handrails?',
    standard: 'Harmonised Guidelines 2021, §3.4 (1:12 max)',
  },
  {
    code: 'accessible-toilet',
    label: 'Accessible toilet',
    question: 'Is there a toilet with grab bars and a 900mm door?',
    standard: 'Harmonised Guidelines 2021, §5.3',
  },
  {
    code: 'lift-accessible',
    label: 'Lift reaching clinical floors',
    question: 'Does a lift reach every floor with consulting rooms?',
    standard: 'Harmonised Guidelines 2021, §4.6',
  },
  {
    code: 'lift-braille-audio',
    label: 'Lift with braille and audio',
    question: 'Does the lift have braille buttons and spoken floor announcements?',
    standard: 'Harmonised Guidelines 2021, §4.6.5',
  },
  {
    code: 'reserved-parking',
    label: 'Reserved accessible parking',
    question: 'Is there a marked bay near the entrance?',
    standard: 'Harmonised Guidelines 2021, §2.3',
  },
  {
    code: 'tactile-guidance',
    label: 'Tactile guiding path',
    question: 'Is there a tactile path from the entrance to reception?',
    standard: 'Harmonised Guidelines 2021, §3.9',
  },
  {
    code: 'accessible-reception-counter',
    label: 'Low reception counter',
    question: 'Is part of the registration counter at seated height (≤800mm)?',
    standard: 'Harmonised Guidelines 2021, §5.1',
  },
  {
    code: 'accessible-examination-table',
    label: 'Height-adjustable examination table',
    question: 'Is there at least one height-adjustable examination table?',
    standard: 'RPwD Act 2016, §25',
  },
  {
    code: 'sign-language-support',
    label: 'Sign language support',
    question: 'Can the hospital arrange an ISL interpreter?',
    standard: 'RPwD Act 2016, §42',
  },
  {
    code: 'reserved-seating',
    label: 'Reserved seating in waiting area',
    question: 'Is seating reserved for disabled and elderly patients?',
    standard: 'Harmonised Guidelines 2021, §5.2',
  },
] as const;

export type AccessibilityComponentCode =
  (typeof ACCESSIBILITY_COMPONENTS)[number]['code'];

export const ACCESSIBILITY_COMPONENT_CODES = ACCESSIBILITY_COMPONENTS.map(
  (c) => c.code,
) as unknown as readonly AccessibilityComponentCode[];

export const ACCESSIBILITY_STATUS_LABELS = {
  meets_standard: 'Meets the standard',
  present_below_standard: 'Present, but below standard',
  not_present: 'Not present',
  not_assessed: 'Not assessed',
} as const;

/* --------------------------------------------------------------- F8 ----- */
/**
 * Language support is tracked per workflow stage. P9: a hospital whose
 * doctors speak English is still unusable if the registration counter does
 * not, and registration is where the visit actually fails.
 */
export const WORKFLOW_STAGES = [
  { code: 'phone-enquiry', label: 'Phone enquiry' },
  { code: 'registration-counter', label: 'Registration counter' },
  { code: 'billing-counter', label: 'Billing counter' },
  { code: 'nursing-triage', label: 'Nursing / vitals' },
  { code: 'consultation', label: 'Consultation' },
  { code: 'signage', label: 'Signage and printed forms' },
  { code: 'discharge-instructions', label: 'Discharge instructions' },
] as const;

export type WorkflowStageCode = (typeof WORKFLOW_STAGES)[number]['code'];
export const WORKFLOW_STAGE_CODES = WORKFLOW_STAGES.map(
  (s) => s.code,
) as unknown as readonly WorkflowStageCode[];

/* --------------------------------------------------------------- F4 ----- */
/**
 * Scheme listings. `listed` means the facility appears on the scheme's own
 * registry. It does NOT mean a given patient will be treated cashless: S52
 * records 1.1 lakh grievances of which 74% were hospitals demanding money
 * from entitled beneficiaries. The caveat below is non-dismissible in UI.
 */
export const SCHEMES = [
  { code: 'pmjay', name: 'Ayushman Bharat PM-JAY', registry: 'National Health Authority' },
  { code: 'mjpjay', name: 'Mahatma Jyotirao Phule Jan Arogya Yojana', registry: 'SHAS Maharashtra' },
  { code: 'cghs', name: 'Central Government Health Scheme', registry: 'CGHS' },
  { code: 'esic', name: 'Employees State Insurance', registry: 'ESIC' },
] as const;

export type SchemeCode = (typeof SCHEMES)[number]['code'];
export const SCHEME_CODES = SCHEMES.map((s) => s.code) as unknown as readonly SchemeCode[];

export const SCHEME_CAVEAT =
  'Being listed on a scheme is not the same as being treated cashless. ' +
  'Listing means the hospital appears on the scheme registry. Whether your ' +
  'specific treatment is covered depends on your package, your documents and ' +
  'the hospital on the day. Confirm at the counter before treatment begins.';

/* --------------------------------------------------------------- F5 ----- */
export const CHARGE_TYPES = [
  { code: 'opd_registration', label: 'OPD registration / case paper' },
  { code: 'new_patient_consultation', label: 'Consultation — new patient' },
  { code: 'followup_consultation', label: 'Consultation — follow-up' },
] as const;

export type ChargeTypeCode = (typeof CHARGE_TYPES)[number]['code'];
export const CHARGE_TYPE_CODES = CHARGE_TYPES.map(
  (c) => c.code,
) as unknown as readonly ChargeTypeCode[];

export const CHARGE_CAVEAT =
  'These are the administrative charges the hospital publishes. They are ' +
  'transcribed, not estimated. They do not include tests, procedures, ' +
  'medicines or admission. FlowCare does not predict what a visit will cost.';

/* --------------------------------------------------------------- F9 ----- */
/**
 * Administrative preparation only. The clinical blocklist in
 * lib/journey/prep.ts rejects anything that reads as an instruction.
 */
export const PREP_REQUIREMENT_CODES = [
  { code: 'photo-id', label: 'Government photo ID' },
  { code: 'scheme-card', label: 'Scheme / insurance card' },
  { code: 'referral-letter', label: 'Referral letter' },
  { code: 'previous-reports', label: 'Previous test reports' },
  { code: 'previous-prescriptions', label: 'Previous prescriptions' },
  { code: 'appointment-reference', label: 'Appointment reference number' },
  { code: 'attendant-required', label: 'An attendant must come with you' },
  { code: 'advance-payment', label: 'Advance payment at registration' },
  { code: 'registration-window', label: 'Registration closes before OPD ends' },
] as const;

export type PrepRequirementCode = (typeof PREP_REQUIREMENT_CODES)[number]['code'];
export const PREP_CODES = PREP_REQUIREMENT_CODES.map(
  (p) => p.code,
) as unknown as readonly PrepRequirementCode[];

export const PREP_APPLIES_TO = ['all', 'first_visit', 'scheme_patients', 'procedure'] as const;

/* -------------------------------------------------------------- F17 ----- */
export const CORRECTION_FIELDS = [
  'phone', 'address', 'hours', 'services', 'schemes', 'charges',
  'accessibility', 'languages', 'arrival', 'routes', 'prep',
] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

export const EVIDENCE_KINDS = [
  { code: 'i_called', label: 'I called the hospital' },
  { code: 'i_visited', label: 'I went there' },
  { code: 'i_work_here', label: 'I work here' },
  { code: 'saw_a_notice', label: 'I saw a notice on site' },
  { code: 'other', label: 'Something else' },
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]['code'];
export const EVIDENCE_KIND_CODES = EVIDENCE_KINDS.map(
  (e) => e.code,
) as unknown as readonly EvidenceKind[];

/* -------------------------------------------------------------- F20 ----- */
export const FOLLOW_UP_TASK_TYPES = [
  { code: 'collect_report', label: 'Collect a report' },
  { code: 'book_followup', label: 'Book a follow-up visit' },
  { code: 'book_referral', label: 'Book a referred appointment' },
  { code: 'collect_medicines', label: 'Collect medicines' },
  { code: 'submit_documents', label: 'Submit documents' },
] as const;
export type FollowUpTypeCode = (typeof FOLLOW_UP_TASK_TYPES)[number]['code'];
export const FOLLOW_UP_TYPE_CODES = FOLLOW_UP_TASK_TYPES.map(
  (t) => t.code,
) as unknown as readonly FollowUpTypeCode[];

/* --------------------------------------------------------------- F3 ----- */
/**
 * Relationship labels are deliberately absent. A relationship value like
 * "my mother with dementia" is a clinical inference vector (§9.1). A care
 * context is a free label the user chooses, with no semantic meaning to us.
 */
export const TRANSPORT_MODES = ['walk', 'transit', 'drive'] as const;
