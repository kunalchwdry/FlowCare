'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SearchBar } from './SearchBar';
import { CareNeedTranslator } from './CareNeedTranslator';
import { FilterControls, FilterDrawer, type Facets, type FilterState } from './FilterPanel';
import { HospitalCard, HospitalCardSkeleton, type ResultWithEvidence } from './HospitalCard';
import { MapView } from './MapView';
import { HospitalPreviewSheet } from './BottomSheet';
import { GoogleAttribution } from './GoogleAttribution';
import { IconClose, IconCompare, IconList, IconMap } from './Icons';
import { filtersToSearchParams, type DiscoveryFilters } from '@/lib/discovery/filters';
import { CITY_ANCHORS } from '@/lib/discovery/geo';
import { trackEvent, useCompareBasket, useGeolocation, useRecentlyViewed, useSessionId } from '@/lib/client/hooks';
import { formatTime } from '@/lib/time';

type View = 'list' | 'map';

interface SearchResponse {
  results: ResultWithEvidence[];
  total: number;
  page: number;
  pageSize: number;
  emptyReason: string | null;
  unenforceableFilters: string[];
  externalStatus: string;
  computedAt: string;
  appliedFilters: DiscoveryFilters;
}

export function DiscoveryExplorer({ initialView = 'list' }: { initialView?: View }) {
  const router = useRouter();
  const sp = useSearchParams();
  const sessionId = useSessionId();
  const geo = useGeolocation();
  const compare = useCompareBasket();
  const recent = useRecentlyViewed();

  const [view, setView] = useState<View>(initialView);
  const [query, setQuery] = useState(sp.get('q') ?? '');
  const [filters, setFilters] = useState<FilterState>(() => readFiltersFromUrl(sp));
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favError, setFavError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load the user's saved hospitals (401 simply means signed out).
  useEffect(() => {
    fetch('/api/favorites')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setFavorites((j.data.favorites ?? []).map((f: { hospitalId: string }) => f.hospitalId)))
      .catch(() => {});
  }, []);

  const point = geo.point;

  const runSearch = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);

    const params = filtersToSearchParams({
      ...filters,
      q: query || undefined,
      near: point ?? undefined,
      page: filters.page ?? 1,
    } as Partial<DiscoveryFilters>);
    params.set('pageSize', '12');

    try {
      const res = await fetch(`/api/hospitals/search?${params.toString()}`, {
        signal: ctrl.signal,
        headers: { 'x-flowcare-session': sessionId },
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? 'Search failed');
      setData(json.data);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters, query, point, sessionId]);

  useEffect(() => { void runSearch(); }, [runSearch]);

  // Keep the URL shareable without re-triggering a fetch loop.
  useEffect(() => {
    const params = filtersToSearchParams({ ...filters, q: query || undefined } as Partial<DiscoveryFilters>);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [filters, query, router]);

  const facets = useMemo<Facets | undefined>(() => (data ? buildFacets(data.results) : undefined), [data]);

  const activeCount = useMemo(() => countActive(filters), [filters]);

  const toggleFavorite = async (hospitalId: string) => {
    const on = favorites.includes(hospitalId);
    setFavError(null);
    const res = on
      ? await fetch(`/api/favorites?hospitalId=${encodeURIComponent(hospitalId)}`, { method: 'DELETE' })
      : await fetch('/api/favorites', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-flowcare-session': sessionId },
          body: JSON.stringify({ hospitalId }),
        });
    if (res.status === 401) { setFavError('Sign in to save hospitals to your FlowCare account.'); return; }
    if (!res.ok) { setFavError('Could not update your saved hospitals.'); return; }
    setFavorites((f) => (on ? f.filter((x) => x !== hospitalId) : [...f, hospitalId]));
  };

  const selected = data?.results.find((r) => r.hospital.id === selectedId) ?? null;

  const locationLabel =
    geo.state.status === 'granted' ? 'Near me'
    : geo.state.status === 'manual' ? geo.state.label
    : null;

  return (
    <div className="space-y-4">
      {/* Sticky search + view toggle */}
      <div className="sticky top-[57px] z-30 -mx-4 bg-ink-50/95 px-4 pb-3 pt-3 backdrop-blur">
        <SearchBar
          value={query}
          onChange={setQuery}
          onSubmit={(v) => { setQuery(v); setFilters((f) => ({ ...f, page: 1 })); }}
          onUseLocation={geo.request}
          locationLabel={locationLabel}
        />

        {/* F1 — lay words to departments. Static dictionary, no LLM, so this
            is safe to run on every keystroke and cannot invent a department. */}
        <div className="mt-2.5">
          <CareNeedTranslator
            query={query}
            onPickSpecialty={(slug) =>
              setFilters((f) => ({
                ...f,
                // Allowlist caps specialties at 6; keep the most recent picks.
                specialties: Array.from(
                  new Set([...(f.specialties ?? []), slug]),
                ).slice(-6) as never,
                page: 1,
              }))
            }
          />
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex rounded-xl border border-ink-300 bg-white p-0.5" role="tablist" aria-label="Result view">
            <button
              role="tab" aria-selected={view === 'list'}
              onClick={() => { setView('list'); trackEvent('view_toggled', sessionId, { to: 'list' }); }}
              className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
                view === 'list' ? 'bg-brand-600 text-white' : 'text-ink-600'
              }`}
            >
              <IconList width={15} height={15} /> List
            </button>
            <button
              role="tab" aria-selected={view === 'map'}
              onClick={() => { setView('map'); trackEvent('map_opened', sessionId, {}); }}
              className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
                view === 'map' ? 'bg-brand-600 text-white' : 'text-ink-600'
              }`}
            >
              <IconMap width={15} height={15} /> Map
            </button>
          </div>

          <FilterDrawer
            filters={filters} setFilters={(f) => setFilters({ ...f, page: 1 })} facets={facets}
            hasLocation={Boolean(point)} activeCount={activeCount}
            onClear={() => { setFilters({}); setQuery(''); }}
          />

          <select
            aria-label="Sort results"
            className="ml-auto min-h-[38px] rounded-xl border border-ink-300 bg-white px-2.5 text-xs font-semibold text-ink-700"
            value={filters.sort ?? 'relevance'}
            onChange={(e) => setFilters({ ...filters, sort: e.target.value as DiscoveryFilters['sort'], page: 1 })}
          >
            <option value="relevance">Sort: Relevance</option>
            <option value="distance">Distance</option>
            <option value="flowcare_rating">FlowCare rating</option>
            <option value="google_rating">Google rating</option>
            <option value="review_count">Most reviews</option>
            <option value="availability">Availability</option>
            <option value="name">Name</option>
          </select>
        </div>

        <LocationNotice geo={geo} filters={filters} setFilters={setFilters} />
      </div>

      {data && data.unenforceableFilters?.length > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
          {data.unenforceableFilters.includes('minGoogleRating')
            ? 'Google ratings are not available here, so the minimum Google rating filter could not be applied. FlowCare will not pretend a filter ran when it did not.'
            : data.unenforceableFilters.includes('sort:google_rating')
              ? 'Google ratings are not available here, so results could not be sorted by Google rating. The relevance order is shown instead.'
              : 'Some Google-based filters could only be applied to the first 60 candidates.'}
        </p>
      )}

      {favError && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">{favError}</p>
      )}

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="hidden lg:block">
          <div className="fc-card sticky top-[170px] max-h-[calc(100vh-200px)] overflow-auto p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold">Filters</h2>
              {activeCount > 0 && (
                <button onClick={() => { setFilters({}); setQuery(''); }} className="text-xs font-semibold text-brand-700 underline">
                  Clear all
                </button>
              )}
            </div>
            <FilterControls filters={filters} setFilters={(f) => setFilters({ ...f, page: 1 })} facets={facets} hasLocation={Boolean(point)} />
          </div>
        </aside>

        <section>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-ink-600">
              {loading ? 'Searching…' : (
                <>
                  <span className="font-bold text-ink-900">{data?.total ?? 0}</span> hospital{data?.total === 1 ? '' : 's'}
                  {data && data.total > 0 && <> · showing {data.results.length}</>}
                </>
              )}
            </p>
            {data && (
              <p className="text-[11px] text-ink-400">
                FlowCare data as of {formatTime(data.computedAt)}
              </p>
            )}
          </div>

          {view === 'map' ? (
            <div className="relative h-[62vh] overflow-hidden rounded-2xl border border-ink-200 md:h-[70vh]">
              <MapView
                results={data?.results ?? []}
                origin={point}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              <HospitalPreviewSheet result={selected} onClose={() => setSelectedId(null)} />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              {loading && !data && Array.from({ length: 4 }).map((_, i) => <HospitalCardSkeleton key={i} />)}
              {data?.results.map((r) => (
                <HospitalCard
                  key={r.hospital.id}
                  result={r}
                  inCompare={compare.ids.includes(r.hospital.id)}
                  onToggleCompare={compare.toggle}
                  isFavorite={favorites.includes(r.hospital.id)}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="fc-card mt-4 p-6 text-center">
              <p className="text-sm font-semibold text-rose-700">{error}</p>
              <button onClick={() => void runSearch()} className="fc-btn-secondary mt-3">Try again</button>
            </div>
          )}

          {!loading && data && data.total === 0 && (
            <div className="fc-card mt-4 p-8 text-center">
              <p className="text-base font-bold text-ink-900">No hospitals matched</p>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">{data.emptyReason}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {filters.radiusKm && (
                  <button onClick={() => setFilters({ ...filters, radiusKm: undefined })} className="fc-btn-secondary text-xs">
                    Remove distance limit
                  </button>
                )}
                {filters.availableWithinDays && (
                  <button onClick={() => setFilters({ ...filters, availableWithinDays: undefined })} className="fc-btn-secondary text-xs">
                    Any appointment date
                  </button>
                )}
                {activeCount > 0 && (
                  <button onClick={() => { setFilters({}); setQuery(''); }} className="fc-btn-primary text-xs">Clear all filters</button>
                )}
              </div>
            </div>
          )}

          {data && data.total > data.pageSize && (
            <nav className="mt-5 flex items-center justify-center gap-2" aria-label="Pagination">
              <button
                className="fc-btn-secondary text-xs"
                disabled={(filters.page ?? 1) <= 1}
                onClick={() => setFilters({ ...filters, page: (filters.page ?? 1) - 1 })}
              >
                Previous
              </button>
              <span className="text-xs text-ink-600">
                Page {data.page} of {Math.ceil(data.total / data.pageSize)}
              </span>
              <button
                className="fc-btn-secondary text-xs"
                disabled={(filters.page ?? 1) >= Math.ceil(data.total / data.pageSize)}
                onClick={() => setFilters({ ...filters, page: (filters.page ?? 1) + 1 })}
              >
                Next
              </button>
            </nav>
          )}

          {data?.externalStatus === 'not_configured' && (
            <p className="mt-4 rounded-xl bg-ink-100 px-3 py-2 text-[11px] text-ink-600">
              Google Maps is not configured on this deployment, so Google ratings, photos and reviews are not shown.
              All availability and FlowCare ratings above come from FlowCare&apos;s own data.
            </p>
          )}
          {data?.externalStatus !== 'not_configured' && data && (
            <div className="mt-4"><GoogleAttribution variant="block" /></div>
          )}

          {recent.items.length > 0 && view === 'list' && (
            <div className="fc-card mt-5 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold">Recently viewed</h2>
                <button onClick={recent.clear} className="text-xs font-semibold text-brand-700 underline">
                  Clear history
                </button>
              </div>
              <p className="mt-1 text-[11px] text-ink-500">
                Stored only in this browser. FlowCare does not keep a server-side record of what you looked at.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {recent.items.map((it) => (
                  <Link key={it.id} href={`/hospitals/${it.id}`} className="fc-chip-off">{it.name}</Link>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {compare.ids.length > 0 && (
        <div className="fixed inset-x-0 bottom-[58px] z-40 md:bottom-4">
          <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-ink-200 bg-white px-3 py-2.5 shadow-lg mx-3 md:mx-auto">
            <IconCompare width={18} height={18} className="shrink-0 text-brand-600" />
            <p className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-800">
              {compare.ids.length} selected to compare{compare.full && ' (max 4)'}
            </p>
            <button onClick={compare.clear} aria-label="Clear comparison" className="grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100">
              <IconClose width={16} height={16} />
            </button>
            <Link
              href={`/hospitals/compare?ids=${compare.ids.join(',')}`}
              className={`fc-btn-primary !min-h-[40px] !py-2 text-xs ${compare.ids.length < 2 ? 'pointer-events-none opacity-40' : ''}`}
            >
              Compare
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function LocationNotice({
  geo, filters, setFilters,
}: { geo: ReturnType<typeof useGeolocation>; filters: FilterState; setFilters: (f: FilterState) => void }) {
  const s = geo.state;
  if (s.status === 'idle' || s.status === 'granted') return null;

  if (s.status === 'prompting') {
    return <p className="mt-2 text-xs text-ink-500">Asking your browser for location…</p>;
  }

  if (s.status === 'manual') {
    return (
      <p className="mt-2 text-xs text-ink-600">
        Using <span className="font-semibold">{s.label}</span> as your search location.{' '}
        <button onClick={geo.clear} className="font-semibold text-brand-700 underline">Change</button>
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
      <p className="text-xs font-medium text-amber-900">
        {s.status === 'unsupported' ? 'Your browser does not support location.' : s.reason}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-amber-900">Search by city:</span>
        {Object.keys(CITY_ANCHORS).map((c) => {
          const pretty = c.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-');
          return (
            <button
              key={c}
              onClick={() => {
                geo.setManual(CITY_ANCHORS[c].lat, CITY_ANCHORS[c].lng, pretty);
                setFilters({ ...filters, city: pretty, page: 1 });
              }}
              className="fc-chip-off !min-h-[30px] !py-1 !text-[11px]"
            >
              {pretty}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function readFiltersFromUrl(sp: URLSearchParams | ReturnType<typeof useSearchParams>): FilterState {
  const list = (k: string) => {
    const v = sp.get(k);
    return v ? v.split(',').filter(Boolean) : undefined;
  };
  const num = (k: string) => {
    const v = sp.get(k);
    return v ? Number(v) : undefined;
  };
  return {
    city: sp.get('city') ?? undefined,
    specialties: list('specialty') as never,
    services: list('service') as never,
    hospitalTypes: list('type') as never,
    accessibility: list('accessibility') as never,
    languages: list('language') as never,
    availability: list('availability') as never,
    availableWithinDays: num('availableWithinDays'),
    minFlowcareRating: num('minFlowcareRating'),
    minGoogleRating: num('minGoogleRating'),
    minReviewCount: num('minReviewCount'),
    radiusKm: num('radiusKm'),
    openNow: sp.get('openNow') === 'true' || undefined,
    emergencyServices: sp.get('emergency') === 'true' || undefined,
    sort: (sp.get('sort') as DiscoveryFilters['sort']) ?? undefined,
    page: num('page') ?? 1,
  };
}

function countActive(f: FilterState): number {
  let n = 0;
  for (const [k, v] of Object.entries(f)) {
    if (k === 'page' || k === 'pageSize' || k === 'sort' || v === undefined) continue;
    if (Array.isArray(v)) n += v.length ? 1 : 0;
    else n += 1;
  }
  return n;
}

function buildFacets(results: ResultWithEvidence[]): Facets {
  const acc: Facets = { specialties: {}, services: {}, hospitalTypes: {}, accessibility: {}, languages: {} };
  for (const r of results) {
    for (const d of r.hospital.departments.filter((x) => x.active)) acc.specialties[d.specialty] = (acc.specialties[d.specialty] ?? 0) + 1;
    for (const s of r.hospital.services) acc.services[s.slug] = (acc.services[s.slug] ?? 0) + 1;
    acc.hospitalTypes[r.hospital.type] = (acc.hospitalTypes[r.hospital.type] ?? 0) + 1;
    for (const a of r.hospital.accessibility) acc.accessibility[a] = (acc.accessibility[a] ?? 0) + 1;
    for (const l of r.hospital.languages) acc.languages[l] = (acc.languages[l] ?? 0) + 1;
  }
  return acc;
}
