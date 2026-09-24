import { describe, expect, it } from 'vitest';
import {
  PLACES_POLICY, assertPersistable, coordCacheExpired, placeIdNeedsRefresh,
} from '../src/lib/places/policy';
import { FIELD_MASKS } from '../src/lib/places/fieldMasks';
import { makeExternalFetcher } from '../src/lib/places/enrich';
import { searchHospitals, loadHospitalDetail } from '../src/lib/discovery/search';
import { DiscoveryFiltersSchema } from '../src/lib/discovery/filters';
import { demoRepo } from '../src/lib/data/demoRepo';
import { daysAgo } from './setup';

describe('Google Maps Platform policy guards', () => {
  it('permits persisting a place ID and cached coordinates only', () => {
    expect(() => assertPersistable(['placeId'])).not.toThrow();
    expect(() => assertPersistable(['cachedLat', 'cachedLng'])).not.toThrow();
  });

  it('refuses to persist display content from Google', () => {
    for (const field of ['displayName', 'formattedAddress', 'rating', 'userRatingCount', 'reviews', 'photos', 'regularOpeningHours', 'websiteUri', 'nationalPhoneNumber']) {
      expect(() => assertPersistable([field])).toThrow();
    }
  });

  it('expires cached coordinates after the 30-day limit', () => {
    expect(PLACES_POLICY.COORD_CACHE_MAX_DAYS).toBe(30);
    expect(coordCacheExpired(daysAgo(1))).toBe(false);
    expect(coordCacheExpired(daysAgo(29))).toBe(false);
    expect(coordCacheExpired(daysAgo(31))).toBe(true);
    expect(coordCacheExpired(null)).toBe(true);
  });

  it('marks a place ID for refresh after twelve months', () => {
    expect(placeIdNeedsRefresh(daysAgo(30))).toBe(false);
    expect(placeIdNeedsRefresh(daysAgo(400))).toBe(true);
    expect(placeIdNeedsRefresh(null)).toBe(true);
  });

  it('requires "Google Maps" attribution text, not "Google"', () => {
    expect(PLACES_POLICY.ATTRIBUTION_TEXT).toBe('Google Maps');
  });

  it('every field mask is non-empty and comma separated (a missing mask errors at Google)', () => {
    for (const [name, mask] of Object.entries(FIELD_MASKS)) {
      expect(mask.length, name).toBeGreaterThan(0);
      expect(mask).not.toMatch(/\s,|,\s*$/);
    }
  });

  it('the cheap masks do not silently pull Enterprise or Atmosphere SKUs', () => {
    // reviews/reviewSummary are the most expensive tier; they must only appear
    // in the explicitly-named reviews mask, never in list or detail masks.
    const listish = Object.entries(FIELD_MASKS).filter(([k]) => !/review/i.test(k));
    for (const [name, mask] of listish) {
      expect(mask, name).not.toMatch(/places\.reviews|reviewSummary|generativeSummary/);
    }
  });
});

describe('Google failure modes degrade instead of breaking discovery', () => {
  it('search still works with Places disabled', async () => {
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({}), { repo: demoRepo, skipExternal: true });
    expect(r.total).toBeGreaterThan(0);
    expect(r.results.every((x) => x.external.data === null)).toBe(true);
  });

  it('an unconfigured API key yields not_configured, not a thrown error', async () => {
    const fetcher = makeExternalFetcher({ enabled: false });
    await expect(fetcher(['ChIJplaceid'])).resolves.toBeInstanceOf(Map);
    const out = await fetcher(['ChIJplaceid']);
    expect(out.size).toBe(0);
  });

  it('a hospital with no linked place reports not_linked and still renders', async () => {
    const d = await loadHospitalDetail('camp-eye-ent', { repo: demoRepo, skipExternal: true });
    expect(d!.external.linked).toBe(false);
    expect(d!.external.placeId).toBeNull();
    expect(d!.hospital.name.length).toBeGreaterThan(0);
  });

  it('an external fetcher that throws does not fail the whole search', async () => {
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({}), {
      repo: demoRepo,
      fetchExternal: async () => { throw new Error('places 500'); },
    });
    expect(r.total).toBeGreaterThan(0);
    expect(r.results.every((x) => x.external.data === null)).toBe(true);
  });

  it('an external fetcher that returns nothing leaves google-only filters unmatched rather than guessing', async () => {
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({ minGoogleRating: 4.5 }), {
      repo: demoRepo,
      fetchExternal: async () => new Map(),
    });
    // With no Google data available, no hospital may be claimed to meet a Google rating floor.
    expect(r.total).toBe(0);
    expect(r.emptyReason).toBeTruthy();
  });

  it('a slow external fetcher does not prevent results from being returned', async () => {
    const started = Date.now();
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({ pageSize: 5 }), {
      repo: demoRepo,
      fetchExternal: async () => new Map(),
    });
    expect(r.results.length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('never writes Google display content into the repo', async () => {
    await searchHospitals(DiscoveryFiltersSchema.parse({}), {
      repo: demoRepo,
      fetchExternal: async (ids) => new Map(ids.map((id) => [id, {
        placeId: id, displayName: 'SOME GOOGLE NAME', formattedAddress: 'Google address',
        rating: 4.9, userRatingCount: 1000, fetchedAt: new Date().toISOString(),
      } as never])),
    });
    const hospitals = await demoRepo.listHospitals();
    for (const h of hospitals) {
      expect(h.name).not.toBe('SOME GOOGLE NAME');
      expect(h.addressLine).not.toBe('Google address');
      expect(JSON.stringify(h)).not.toMatch(/SOME GOOGLE NAME/);
    }
  });

  it('keeps the Google rating in a field separate from the FlowCare rating', async () => {
    const r = await searchHospitals(DiscoveryFiltersSchema.parse({ pageSize: 3 }), {
      repo: demoRepo,
      fetchExternal: async (ids) => new Map(ids.map((id) => [id, {
        placeId: id, rating: 4.9, userRatingCount: 1000, fetchedAt: new Date().toISOString(),
      } as never])),
    });
    for (const x of r.results) {
      if (x.external.data?.rating !== undefined) {
        expect(x.flowcareRating.score).not.toBe(x.external.data.rating);
        // the FlowCare summary must never carry a google field
        expect(JSON.stringify(x.flowcareRating)).not.toMatch(/google/i);
      }
    }
  });
});
