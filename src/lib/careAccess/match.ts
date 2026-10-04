import type { Repo } from '@/lib/data/repo';
import { haversineKm } from '@/lib/discovery/geo';
import type {
  CareAccessOption,
  CareAccessRequest,
  CapacitySignal,
} from './types';

function normalise(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/orthopedics/g, 'orthopaedics')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function dateWithin(date: string, request: CareAccessRequest): boolean {
  if (request.preferredStartDate && date < request.preferredStartDate) return false;
  if (request.preferredEndDate && date > request.preferredEndDate) return false;
  return true;
}

function timeWithin(startTime: string, request: CareAccessRequest): boolean {
  const preference = normalise(request.preferredTimeRange);
  if (!preference) return true;
  const hour = Number(startTime.slice(0, 2));
  if (preference.includes('evening') || preference.includes('after-work') || preference.includes('after')) return hour >= 15;
  if (preference.includes('morning')) return hour < 12;
  if (preference.includes('afternoon')) return hour >= 12 && hour < 17;
  return true;
}

function sessionIsFuture(date: string, endTime: string): boolean {
  // Demo and provider slot dates are interpreted in Pune local time, not UTC.
  return new Date(`${date}T${endTime}:00+05:30`).getTime() > Date.now();
}

function fresh(signal: CapacitySignal | undefined, simulated: boolean): Pick<CareAccessOption, 'freshness' | 'freshnessLabel'> {
  if (simulated) return { freshness: 'simulated', freshnessLabel: 'Simulated demo signal' };
  if (!signal?.updatedAt) return { freshness: 'unavailable', freshnessLabel: 'Capacity update unavailable' };
  const ageHours = (Date.now() - new Date(signal.updatedAt).getTime()) / 3_600_000;
  if (signal.expiresAt && new Date(signal.expiresAt).getTime() <= Date.now()) {
    return { freshness: 'stale', freshnessLabel: `Last updated ${Math.max(1, Math.round(ageHours))}h ago` };
  }
  if (ageHours <= 24) return { freshness: 'fresh', freshnessLabel: `Updated ${Math.max(0, Math.round(ageHours))}h ago` };
  if (ageHours <= 72) return { freshness: 'ageing', freshnessLabel: `Last updated ${Math.round(ageHours)}h ago` };
  return { freshness: 'stale', freshnessLabel: `Last updated ${Math.round(ageHours / 24)}d ago` };
}

function costBand(amountMin: number | null, amountMax: number | null): string | null {
  const amount = amountMax ?? amountMin;
  if (amount === null || !Number.isFinite(amount)) return null;
  if (amount < 500) return '₹';
  if (amount < 1500) return '₹₹';
  return '₹₹₹';
}

/**
 * Deterministic, explainable eligibility and ranking. This is intentionally
 * not an AI score. Clinical appropriateness is represented only by published
 * capability/referral data; FlowCare never diagnoses or assigns urgency.
 */
export async function matchCareAccessOptions(
  repo: Repo,
  request: CareAccessRequest,
): Promise<CareAccessOption[]> {
  const hospitals = await repo.listHospitals();
  const [sessions, queues, signals] = await Promise.all([
    repo.listSessions(),
    repo.listQueues(),
    repo.listCapacitySignals(),
  ]);
  const signalByHospital = new Map<string, CapacitySignal>();
  for (const signal of signals) {
    const previous = signalByHospital.get(signal.hospitalId);
    if (!previous || signal.updatedAt > previous.updatedAt) signalByHospital.set(signal.hospitalId, signal);
  }

  const location = normalise(request.location);
  const specialty = normalise(request.specialty);
  const languagePrefs = request.languagePreference.map(normalise);
  const accessPrefs = request.accessibilityRequirements.map(normalise);
  // Keep the demo journey deliberately small and legible: three synthetic
  // Pune-network facilities, while discovery still exposes the full seed.
  const networkHospitals = repo.kind === 'demo'
    ? hospitals.filter((h) => ['deccan-gymkhana-multispecialty', 'baner-ridge-multispecialty', 'pimpri-teaching-research'].includes(h.id))
    : hospitals;
  const inLocation = location
    ? networkHospitals.filter((h) => normalise(`${h.city}-${h.addressLine}`).includes(location))
    : networkHospitals;
  const candidates = inLocation.length ? inLocation : networkHospitals;

  const rows: Array<CareAccessOption & { rank: number }> = [];
  for (const hospital of candidates) {
    const activeDepartments = hospital.departments.filter((d) => d.active);
    const department = activeDepartments.find((d) => {
      const value = normalise(`${d.specialty}-${d.name}`);
      return !specialty || value.includes(specialty) || specialty.includes(normalise(d.specialty));
    });
    const capabilityMatched = Boolean(department || !specialty);
    if (!capabilityMatched) continue;

    const hospitalSessions = sessions
      .filter((s) => s.hospitalId === hospital.id && (!department || s.departmentId === department.id) && s.status === 'open' && s.capacity > s.booked)
      .filter((s) => dateWithin(s.date, request) && timeWithin(s.startTime, request) && sessionIsFuture(s.date, s.endTime))
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
    const session = hospitalSessions[0] ?? null;
    const signal = signalByHospital.get(hospital.id);
    const freshness = fresh(signal, repo.kind === 'demo');
    const queue = queues.find((q) => q.hospitalId === hospital.id && q.published) ?? null;
    const distance = request.location && hospital.location.lat && hospital.location.lng
      ? haversineKm({ lat: 18.5204, lng: 73.8567 }, hospital.location)
      : null;
    const missingAccess = accessPrefs.filter((need) => !hospital.accessibility.some((a) => normalise(a).includes(need)));
    const missingLanguage = languagePrefs.filter((need) => !hospital.languages.some((l) => normalise(l).includes(need)));
    const reasons: string[] = [];
    if (department) reasons.push(`${department.name} capability recorded`);
    if (session) reasons.push(`Appointment available ${session.date} at ${session.startTime}`);
    else reasons.push('No current bookable slot found');
    if (distance !== null) reasons.push(`${distance.toFixed(1)} km from Pune centre (estimate)`);
    if (queue?.medianWaitMinutes != null) reasons.push(`Reported wait ~${queue.medianWaitMinutes} min`);
    if (missingAccess.length === 0 && accessPrefs.length) reasons.push('Requested access needs match published facility facts');
    if (missingLanguage.length === 0 && languagePrefs.length) reasons.push('Requested language is listed');
    const facts = await repo.getFacilityFacts(hospital.id);
    const charge = facts.charges.find((c) => c.chargeType === 'new_patient_consultation' || c.chargeType === 'opd_registration');
    const chargeBand = costBand(charge?.amountMin ?? null, charge?.amountMax ?? null);
    if (chargeBand) reasons.push(`Published consultation band ${chargeBand}`);
    if (freshness.freshness === 'simulated') reasons.push('Capacity is explicitly simulated demo data');
    if (freshness.freshness === 'unavailable') reasons.push('Capacity freshness unavailable; confirm before travelling');

    // A hospital can be shown for capability context without being bookable,
    // but only an observed future slot is selectable. This prevents a stale
    // capacity signal or a synthetic ranking from becoming claimed availability.
    const eligible = capabilityMatched && Boolean(session) && missingAccess.length === 0 && missingLanguage.length === 0;
    const rank = (eligible ? 100 : 0)
      + (session ? 40 : 0)
      + (queue ? 10 : 0)
      + (freshness.freshness === 'fresh' || freshness.freshness === 'simulated' ? 8 : 0)
      - (distance ?? 20)
      - (missingAccess.length * 20)
      - (missingLanguage.length * 20);

    rows.push({
      id: `${request.id}:${hospital.id}`,
      careRequestId: request.id,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      departmentId: department?.id ?? null,
      departmentName: department?.name ?? null,
      providerId: session?.providerId ?? null,
      serviceSlug: session?.serviceSlug ?? null,
      sessionId: session?.id ?? null,
      slotType: session?.slotType ?? null,
      approvalRequired: session ? session.slotType === 'approval_required' : undefined,
      waitlistEnabled: session?.waitlistEnabled ?? false,
      approvalDeadline: session?.approvalDeadline ?? null,
      slotLabel: session ? `${session.date} · ${session.startTime}–${session.endTime}` : null,
      distanceKm: distance,
      queueWaitMinutes: queue?.medianWaitMinutes ?? signal?.queueWaitMinutes ?? null,
      queueObservedAt: queue?.observedAt ?? signal?.updatedAt ?? null,
      costBand: chargeBand,
      costVerifiedAt: charge?.provenance.verifiedAt ?? null,
      accessibility: hospital.accessibility,
      languages: hospital.languages,
      capabilityMatched,
      eligible,
      ...freshness,
      reasons,
      status: 'offered',
      offeredAt: new Date().toISOString(),
      expiresAt: session ? new Date(`${session.date}T${session.startTime}:00+05:30`).toISOString() : null,
      selectedAt: null,
      rank,
    });
  }

  return rows
    .sort((a, b) => b.rank - a.rank || a.hospitalName.localeCompare(b.hospitalName))
    .slice(0, 6)
    .map(({ rank: _rank, ...option }) => option);
}
