/**
 * Builds the "Why this hospital appeared" evidence trail.
 *
 * Every bullet is generated from retrieved data — never from model text. If a
 * value is missing we say so explicitly rather than omitting it, so absence of
 * evidence is visible.
 */
import type { DiscoveryResult } from '@/lib/types';
import { label } from '@/lib/discovery/filters';
import type { DiscoveryFilters } from '@/lib/discovery/filters';

export interface EvidenceItem {
  kind: 'flowcare' | 'google' | 'geo';
  text: string;
}

export function buildEvidence(r: DiscoveryResult, filters: DiscoveryFilters): EvidenceItem[] {
  const out: EvidenceItem[] = [];

  if (filters.specialties?.length) {
    const have = new Set(r.hospital.departments.filter((d) => d.active).map((d) => d.specialty));
    const hit = filters.specialties.filter((s) => have.has(s));
    out.push({
      kind: 'flowcare',
      text: hit.length
        ? `${hit.map(label).join(', ')} listed as an active FlowCare department`
        : `Requested department not listed at this hospital`,
    });
  }

  if (r.distanceKm !== null) {
    out.push({ kind: 'geo', text: `${r.distanceKm.toFixed(1)} km straight-line from your search point` });
  }

  const a = r.availability;
  out.push({
    kind: 'flowcare',
    text:
      a.state === 'unknown'
        ? 'FlowCare has no session data for this hospital, so availability is unknown'
        : a.state === 'none'
          ? `No open FlowCare slots in the next ${a.windowDays} days (checked ${new Date(a.computedAt).toLocaleTimeString()})`
          : `${a.openSlots} open FlowCare slot(s) in the next ${a.windowDays} days; earliest ${a.nextAvailableDate} (checked ${new Date(a.computedAt).toLocaleTimeString()})`,
  });

  if (r.external.data?.rating !== undefined) {
    out.push({
      kind: 'google',
      text: `${r.external.data.rating.toFixed(1)} ★ Google rating from ${r.external.data.userRatingCount ?? 0} Google ratings`,
    });
  } else if (r.external.linked) {
    out.push({ kind: 'google', text: 'Google rating not retrieved for this hospital' });
  } else {
    out.push({ kind: 'google', text: 'No verified Google Place linked to this hospital' });
  }

  const fr = r.flowcareRating;
  out.push({
    kind: 'flowcare',
    text: fr.score === null
      ? (fr.insufficientReason ?? 'Not enough FlowCare reviews yet')
      : `${fr.score.toFixed(1)} FlowCare rating from ${fr.reviewCount} verified visits`,
  });

  if (r.queue?.published && r.queue.medianWaitMinutes !== null) {
    out.push({
      kind: 'flowcare',
      text: `Hospital publishes queue info: about ${r.queue.medianWaitMinutes} min median wait, ${r.queue.waitingCount} waiting (as of ${r.queue.observedAt ? new Date(r.queue.observedAt).toLocaleTimeString() : 'unknown'})`,
    });
  }

  return out;
}
