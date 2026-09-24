import { describe, expect, it } from 'vitest';
import { searchHospitals, loadHospitalDetail } from '../src/lib/discovery/search';
import { DiscoveryFiltersSchema, filtersFromSearchParams } from '../src/lib/discovery/filters';
import { demoRepo } from '../src/lib/data/demoRepo';
import { haversineKm, anchorForCity, CITY_ANCHORS } from '../src/lib/discovery/geo';

const deps = { repo: demoRepo, skipExternal: true };

describe('hospital search', () => {
  it('returns hospitals for an empty query', async () => {
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({}), deps);
    expect(r.total).toBeGreaterThan(0);
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('finds a hospital by exact name', async () => {
    const all = await searchHospitals(DiscoveryFiltersSchema.parse({}), deps);
    const target = all.results[0].hospital.name;
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({ q: target }), deps);
    expect(r.results.some((x) => x.hospital.name === target)).toBe(true);
  });

  it('finds hospitals by partial name', async () => {
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({ q: 'ridge' }), deps);
    expect(r.total).toBeGreaterThan(0);
    expect(r.results.every((x) => /ridge/i.test(x.hospital.name))).toBe(true);
  });

  it('is case and whitespace insensitive', async () => {
    const a = await searchHospitals(DiscoveryFiltersSchema.parse({ q: 'BANER' }), deps);
    const b = await searchHospitals(DiscoveryFiltersSchema.parse({ q: '  baner  ' }), deps);
    expect(a.total).toBe(b.total);
    expect(a.total).toBeGreaterThan(0);
  });

  it('returns zero results with an explanation for nonsense input', async () => {
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({ q: 'zzzqqxnonexistenthospital' }), deps);
    expect(r.total).toBe(0);
    expect(r.emptyReason).toBeTruthy();
    expect(r.emptyReason!.length).toBeGreaterThan(10);
  });

  it('filters by specialty and every result really offers it', async () => {
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({ specialties: ['cardiology'] }), deps);
    expect(r.total).toBeGreaterThan(0);
    for (const x of r.results) {
      expect(x.hospital.departments.some((d) => d.specialty === 'cardiology' && d.active)).toBe(true);
    }
  });

  it('filters by city', async () => {
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({ city: 'Nashik' }), deps);
    expect(r.results.every((x) => x.hospital.city.toLowerCase() === 'nashik')).toBe(true);
  });

  it('filters by service and accessibility together', async () => {
    const r = await searchHospitals(
      DiscoveryFiltersSchema.parse({ services: ['pharmacy'], accessibility: ['wheelchair-accessible-entrance'] }), deps);
    for (const x of r.results) {
      expect(x.hospital.services.some((s) => s.slug === 'pharmacy')).toBe(true);
      expect(x.hospital.accessibility).toContain('wheelchair-accessible-entrance');
    }
  });

  it('respects a radius filter — no result is further than the radius', async () => {
    const near = CITY_ANCHORS['pune'];
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({ near, radiusKm: 5 }), deps);
    for (const x of r.results) {
      expect(x.distanceKm).not.toBeNull();
      expect(x.distanceKm!).toBeLessThanOrEqual(5.000001);
      expect(haversineKm(near, x.hospital.location)).toBeLessThanOrEqual(5.000001);
    }
  });

  it('sorts by distance in ascending order', async () => {
    const r = await searchHospitals(
      DiscoveryFiltersSchema.parse({ near: CITY_ANCHORS['pune'], sort: 'distance', pageSize: 20 }), deps);
    const ds = r.results.map((x) => x.distanceKm!);
    expect([...ds].sort((a, b) => a - b)).toEqual(ds);
  });

  it('paginates without dropping or duplicating hospitals', async () => {
    const p1 = await searchHospitals(DiscoveryFiltersSchema.parse({ page: 1, pageSize: 5 }), deps);
    const p2 = await searchHospitals(DiscoveryFiltersSchema.parse({ page: 2, pageSize: 5 }), deps);
    const ids1 = p1.results.map((x) => x.hospital.id);
    const ids2 = p2.results.map((x) => x.hospital.id);
    expect(new Set([...ids1, ...ids2]).size).toBe(ids1.length + ids2.length);
    expect(p1.total).toBe(p2.total);
  });

  it('never reports availability as available when there are no sessions', async () => {
    const d = await loadHospitalDetail('magarpatta-daycare-surgical', deps);
    expect(d).not.toBeNull();
    expect(d!.availability.state).toBe('unknown');
    expect(d!.availability.openSlots).toBeNull();
  });

  it('reports "none" (not "unknown") when every session is full', async () => {
    const d = await loadHospitalDetail('katraj-trust-charitable', deps);
    expect(d!.availability.state).toBe('none');
    expect(d!.availability.openSlots).toBe(0);
  });

  it('marks external status as not_configured when Google is unavailable', async () => {
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({}), { repo: demoRepo });
    expect(['not_configured', 'skipped']).toContain(r.externalStatus);
    for (const x of r.results) expect(x.external.data).toBeNull();
  });

  it('loads a hospital detail by slug and by id', async () => {
    const bySlug = await loadHospitalDetail('baner-ridge-multispecialty', deps);
    expect(bySlug).not.toBeNull();
    const byId = await loadHospitalDetail(bySlug!.hospital.id, deps);
    expect(byId!.hospital.slug).toBe(bySlug!.hospital.slug);
  });

  it('returns null for an unknown hospital rather than throwing', async () => {
    await expect(loadHospitalDetail('no-such-hospital', deps)).resolves.toBeNull();
  });

  it('never returns a FlowCare score for a hospital under the review threshold', async () => {
    const d = await loadHospitalDetail('camp-eye-ent', deps);
    expect(d!.flowcareRating.reviewCount).toBeLessThan(5);
    expect(d!.flowcareRating.score).toBeNull();
    expect(d!.flowcareRating.insufficientReason).toMatch(/not enough|no flowcare/i);
  });
});

describe('filter parsing and validation', () => {
  it('rejects a specialty outside the allowlist', () => {
    const res = DiscoveryFiltersSchema.safeParse({ specialties: ['wizardry'] });
    expect(res.success).toBe(false);
  });

  it('rejects an out-of-range rating and a negative radius', () => {
    expect(DiscoveryFiltersSchema.safeParse({ minFlowcareRating: 9 }).success).toBe(false);
    expect(DiscoveryFiltersSchema.safeParse({ radiusKm: -3 }).success).toBe(false);
  });

  it('rejects unknown keys instead of silently ignoring them', () => {
    const res = DiscoveryFiltersSchema.safeParse({ dropTable: 'hospitals' });
    expect(res.success).toBe(false);
  });

  it('ignores junk in query params rather than throwing', () => {
    const f = filtersFromSearchParams(new URLSearchParams('specialty=cardiology,wizardry&radiusKm=abc'));
    expect(f.specialties).toEqual(['cardiology']);
    expect(f.radiusKm).toBeUndefined();
  });

  it('treats a SQL-looking query as plain text and matches nothing', async () => {
    const q = "'; DROP TABLE hospitals; --";
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({ q }), deps);
    expect(r.total).toBe(0);
    // and the repo is untouched
    expect((await demoRepo.listHospitals()).length).toBeGreaterThan(0);
  });

  it('maps known cities to anchors and unknown cities to null', () => {
    expect(anchorForCity('Pune')).not.toBeNull();
    expect(anchorForCity('Atlantis')).toBeNull();
    expect(anchorForCity(undefined)).toBeNull();
  });
});
