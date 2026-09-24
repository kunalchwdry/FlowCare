'use client';

import { useState } from 'react';
import { IconClose, IconFilter } from './Icons';
import {
  ACCESSIBILITY_FEATURES, AVAILABILITY_STATES, HOSPITAL_TYPES, LANGUAGES,
  SERVICES, SPECIALTIES, label, type DiscoveryFilters,
} from '@/lib/discovery/filters';

export interface FilterState extends Partial<DiscoveryFilters> {}

/** Facet counts derived from the current result set; a filter with zero
 *  possible matches in the data is disabled rather than silently useless. */
export interface Facets {
  specialties: Record<string, number>;
  services: Record<string, number>;
  hospitalTypes: Record<string, number>;
  accessibility: Record<string, number>;
  languages: Record<string, number>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-ink-100 py-3.5 first:border-t-0 first:pt-0">
      <p className="fc-label mb-2">{title}</p>
      {children}
    </div>
  );
}

function ChipGroup<T extends string>({
  options, selected, onToggle, counts,
}: { options: readonly T[]; selected: T[] | undefined; onToggle: (v: T) => void; counts?: Record<string, number> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const n = counts?.[o];
        const disabled = counts !== undefined && !n && !selected?.includes(o);
        return (
          <button
            key={o}
            type="button"
            disabled={disabled}
            aria-pressed={selected?.includes(o) ?? false}
            onClick={() => onToggle(o)}
            className={`${selected?.includes(o) ? 'fc-chip-on' : 'fc-chip-off'} ${disabled ? 'cursor-not-allowed opacity-35' : ''}`}
            title={disabled ? 'No hospitals in the current data have this' : undefined}
          >
            {label(o)}
            {n !== undefined && n > 0 && <span className="opacity-60">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function FilterControls({
  filters, setFilters, facets, hasLocation,
}: {
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  facets?: Facets;
  hasLocation: boolean;
}) {
  const toggleIn = <K extends keyof FilterState>(key: K, value: string) => {
    const cur = (filters[key] as string[] | undefined) ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setFilters({ ...filters, [key]: next.length ? next : undefined });
  };

  return (
    <div className="text-sm">
      <Section title="Department / specialty">
        <ChipGroup options={SPECIALTIES} selected={filters.specialties as never} counts={facets?.specialties}
          onToggle={(v) => toggleIn('specialties', v)} />
      </Section>

      <Section title="Appointment availability">
        <ChipGroup options={AVAILABILITY_STATES} selected={filters.availability as never}
          onToggle={(v) => toggleIn('availability', v)} />
        <div className="mt-2.5">
          <label className="fc-label mb-1.5" htmlFor="withinDays">Has a bookable slot within</label>
          <select
            id="withinDays"
            className="fc-input"
            value={filters.availableWithinDays ?? ''}
            onChange={(e) => setFilters({ ...filters, availableWithinDays: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">Any time</option>
            <option value="1">Today</option>
            <option value="2">Tomorrow</option>
            <option value="7">This week</option>
            <option value="14">Two weeks</option>
          </select>
          <p className="mt-1 text-[11px] text-ink-500">
            Based on FlowCare clinic sessions only — never inferred from opening hours.
          </p>
        </div>
      </Section>

      <Section title="Distance">
        <select
          className="fc-input"
          disabled={!hasLocation && !filters.city}
          value={filters.radiusKm ?? ''}
          onChange={(e) => setFilters({ ...filters, radiusKm: e.target.value ? Number(e.target.value) : undefined })}
        >
          <option value="">Any distance</option>
          <option value="2">Within 2 km</option>
          <option value="5">Within 5 km</option>
          <option value="10">Within 10 km</option>
          <option value="25">Within 25 km</option>
          <option value="50">Within 50 km</option>
        </select>
        {!hasLocation && !filters.city && (
          <p className="mt-1 text-[11px] text-ink-500">
            Set a location (or pick a city) to filter by distance. Location is optional.
          </p>
        )}
      </Section>

      <Section title="Ratings">
        <div className="space-y-2.5">
          <div>
            <label className="fc-label mb-1.5" htmlFor="fcRating">Minimum FlowCare rating</label>
            <select id="fcRating" className="fc-input" value={filters.minFlowcareRating ?? ''}
              onChange={(e) => setFilters({ ...filters, minFlowcareRating: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Any</option>
              <option value="3">3.0+</option>
              <option value="3.5">3.5+</option>
              <option value="4">4.0+</option>
              <option value="4.5">4.5+</option>
            </select>
            <p className="mt-1 text-[11px] text-ink-500">
              Hospitals below the 5-review publication threshold have no score and are excluded by this filter.
            </p>
          </div>
          <div>
            <label className="fc-label mb-1.5" htmlFor="minReviews">Minimum number of FlowCare reviews</label>
            <select id="minReviews" className="fc-input" value={filters.minReviewCount ?? ''}
              onChange={(e) => setFilters({ ...filters, minReviewCount: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Any</option>
              <option value="5">5+</option>
              <option value="10">10+</option>
              <option value="25">25+</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="Hospital type">
        <ChipGroup options={HOSPITAL_TYPES} selected={filters.hospitalTypes as never} counts={facets?.hospitalTypes}
          onToggle={(v) => toggleIn('hospitalTypes', v)} />
      </Section>

      <Section title="Services on site">
        <ChipGroup options={SERVICES} selected={filters.services as never} counts={facets?.services}
          onToggle={(v) => toggleIn('services', v)} />
      </Section>

      <Section title="Accessibility">
        <ChipGroup options={ACCESSIBILITY_FEATURES} selected={filters.accessibility as never} counts={facets?.accessibility}
          onToggle={(v) => toggleIn('accessibility', v)} />
      </Section>

      <Section title="Language support">
        <ChipGroup options={LANGUAGES} selected={filters.languages as never} counts={facets?.languages}
          onToggle={(v) => toggleIn('languages', v)} />
      </Section>

      <Section title="Other">
        <div className="space-y-2">
          <label className="flex min-h-[40px] items-center gap-2.5 text-sm text-ink-700">
            <input type="checkbox" className="h-4.5 w-4.5 rounded" checked={Boolean(filters.openNow)}
              onChange={(e) => setFilters({ ...filters, openNow: e.target.checked || undefined })} />
            Open right now
          </label>
          <label className="flex min-h-[40px] items-center gap-2.5 text-sm text-ink-700">
            <input type="checkbox" className="h-4.5 w-4.5 rounded" checked={Boolean(filters.emergencyServices)}
              onChange={(e) => setFilters({ ...filters, emergencyServices: e.target.checked || undefined })} />
            Has emergency services
          </label>
          <label className="flex min-h-[40px] items-center gap-2.5 text-sm text-ink-700">
            <input type="checkbox" className="h-4.5 w-4.5 rounded" checked={Boolean(filters.flowcareVerifiedOnly)}
              onChange={(e) => setFilters({ ...filters, flowcareVerifiedOnly: e.target.checked || undefined })} />
            FlowCare-onboarded hospitals only
          </label>
        </div>
      </Section>
    </div>
  );
}

/** Mobile filter drawer. */
export function FilterDrawer({
  filters, setFilters, facets, hasLocation, activeCount, onClear,
}: {
  filters: FilterState; setFilters: (f: FilterState) => void; facets?: Facets;
  hasLocation: boolean; activeCount: number; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="fc-btn-secondary !min-h-[44px] lg:hidden">
        <IconFilter width={17} height={17} />
        Filters{activeCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] text-white">{activeCount}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button className="absolute inset-0 bg-ink-950/40" aria-label="Close filters" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-auto rounded-t-3xl bg-white">
            <div className="sticky top-0 flex items-center justify-between border-b border-ink-100 bg-white px-4 py-3">
              <h2 className="text-base font-bold">Filters</h2>
              <div className="flex items-center gap-2">
                <button onClick={onClear} className="text-xs font-semibold text-brand-700 underline">Clear all</button>
                <button onClick={() => setOpen(false)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-ink-100">
                  <IconClose width={18} height={18} />
                </button>
              </div>
            </div>
            <div className="px-4 pb-4">
              <FilterControls filters={filters} setFilters={setFilters} facets={facets} hasLocation={hasLocation} />
            </div>
            <div className="sticky bottom-0 border-t border-ink-100 bg-white px-4 py-3">
              <button onClick={() => setOpen(false)} className="fc-btn-primary w-full">Show results</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
