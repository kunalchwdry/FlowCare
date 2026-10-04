import type { NewCareAccessRequest } from './types';

type ExtractedCareAccessRequest = Omit<NewCareAccessRequest, 'patientId'>;

const SPECIALTIES: Record<string, string> = {
  orthopedic: 'orthopaedics', orthopaedic: 'orthopaedics', orthopedics: 'orthopaedics',
  cardiology: 'cardiology', cardiac: 'cardiology', dermatology: 'dermatology',
  neurology: 'neurology', paediatrics: 'paediatrics', pediatrics: 'paediatrics',
  ent: 'ent', ophthalmology: 'ophthalmology', gastroenterology: 'gastroenterology',
  urology: 'urology', nephrology: 'nephrology', psychiatry: 'psychiatry',
  physiotherapy: 'physiotherapy', 'general medicine': 'general-medicine',
};

/**
 * Conservative administrative extraction for the demo. It only maps known
 * specialty words and common location/date phrases. Unknown language stays
 * unclassified; no diagnosis or urgency is inferred.
 */
export function extractCareAccessRequest(text: string): ExtractedCareAccessRequest {
  const value = text.trim().slice(0, 500);
  const lower = value.toLowerCase();
  const specialtyKey = Object.keys(SPECIALTIES).find((key) => lower.includes(key));
  const locationMatch = lower.match(/(?:near|in|around|at)\s+([a-z][a-z -]{2,40}?)(?:\s+(?:next|this|on|for|after|before|during|with|and|can|want|i|we|my|morning|evening|afternoon|work)\b|[,.!?]|$)/i);
  const dateRange = lower.includes('next week')
    ? { preferredStartDate: addDays(1), preferredEndDate: addDays(7) }
    : lower.includes('this week')
      ? { preferredStartDate: today(), preferredEndDate: addDays(6) }
      : {};
  const timeRange = lower.includes('morning') ? 'morning' : (lower.includes('evening') || lower.includes('after work')) ? 'evening' : null;
  const accessibilityRequirements = lower.includes('wheelchair') ? ['wheelchair-accessible-entrance'] : [];
  const languagePreference = lower.includes('marathi') ? ['mr'] : lower.includes('hindi') ? ['hi'] : [];
  return {
    specialty: specialtyKey ? SPECIALTIES[specialtyKey] : null,
    serviceType: lower.includes('follow-up') || lower.includes('follow up') ? 'follow-up consultation' : 'consultation',
    location: locationMatch?.[1]?.trim() || (lower.includes('pune') ? 'Pune' : null),
    preferredTimeRange: timeRange,
    budgetConstraint: null,
    accessibilityRequirements,
    languagePreference,
    coverage: null,
    referralRequired: null,
    ...dateRange,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(days: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
