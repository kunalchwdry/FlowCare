'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconClose, IconPin, IconSearch } from './Icons';
import { useDebouncedCallback } from '@/lib/client/hooks';

interface Suggestion { label: string; href: string; kind: string }

/**
 * Sticky search with debounced, cancellable suggestions from FlowCare's own
 * taxonomy (no LLM, no Google call, so it stays instant and free).
 */
export function SearchBar({
  value, onChange, onSubmit, placeholder = 'Search hospitals, departments or areas',
  onUseLocation, locationLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  onUseLocation?: () => void;
  locationLabel?: string | null;
}) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useDebouncedCallback((q: string) => {
    abortRef.current?.abort();
    if (q.trim().length < 2) { setSuggestions([]); return; }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetch(`/api/hospitals/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => setSuggestions(j?.data?.suggestions ?? []))
      .catch(() => {});
  }, 220);

  useEffect(() => { fetchSuggestions(value); }, [value, fetchSuggestions]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" width={18} height={18} />
          <input
            className="fc-input pl-10 pr-9"
            value={value}
            placeholder={placeholder}
            aria-label="Search hospitals"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls="fc-suggestions"
            autoComplete="off"
            onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(-1); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, -1)); }
              else if (e.key === 'Enter') {
                e.preventDefault();
                if (highlight >= 0 && suggestions[highlight]) { setOpen(false); router.push(suggestions[highlight].href); }
                else { setOpen(false); onSubmit(value); }
              } else if (e.key === 'Escape') setOpen(false);
            }}
          />
          {value && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { onChange(''); onSubmit(''); setSuggestions([]); }}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"
            >
              <IconClose width={15} height={15} />
            </button>
          )}
        </div>
        {onUseLocation && (
          <button
            type="button"
            onClick={onUseLocation}
            className={`fc-btn-secondary !px-3 shrink-0 ${locationLabel ? '!border-brand-300 !bg-brand-50 !text-brand-700' : ''}`}
            title="Use my current location (optional)"
          >
            <IconPin width={17} height={17} />
            <span className="hidden sm:inline">{locationLabel ?? 'Near me'}</span>
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul
          id="fc-suggestions"
          role="listbox"
          className="absolute z-30 mt-1.5 max-h-80 w-full overflow-auto rounded-2xl border border-ink-200 bg-white py-1.5 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li key={`${s.href}-${i}`} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => { setOpen(false); router.push(s.href); }}
                className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm ${
                  i === highlight ? 'bg-brand-50' : 'hover:bg-ink-50'
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium text-ink-800">{s.label}</span>
                <span className="shrink-0 rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-500">
                  {s.kind}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
