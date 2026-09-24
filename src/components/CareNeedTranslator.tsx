'use client';

/**
 * F1 — Care Need Translator, patient-facing.
 *
 * Shown when someone types everyday words into search. It answers "which
 * department?" with a list, never with one answer, and it says out loud that
 * FlowCare is not the one deciding.
 *
 * Runs against /api/translate, which is a static dictionary — no LLM, no
 * model latency, no possibility of an invented department.
 */
import { useEffect, useState } from 'react';
import { IconInfo } from './Icons';
import { useDebouncedCallback } from '@/lib/client/hooks';

interface TranslatedDepartment {
  slug: string;
  label: string;
  reason: string;
}

interface Translation {
  term: string;
  departments: TranslatedDepartment[];
  ambiguous: boolean;
  guidance: string;
}

interface TranslateResult {
  query: string;
  emergency: boolean;
  emergencyNotice: string | null;
  translations: Translation[];
  suggestedSpecialties: string[];
}

export function CareNeedTranslator({
  query,
  onPickSpecialty,
}: {
  query: string;
  onPickSpecialty?: (slug: string) => void;
}) {
  const [result, setResult] = useState<TranslateResult | null>(null);

  const run = useDebouncedCallback((q: string) => {
    if (!q || q.trim().length < 3) {
      setResult(null);
      return;
    }
    fetch(`/api/translate?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((j) => setResult(j.ok ? j.data : null))
      .catch(() => setResult(null));
  }, 250);

  useEffect(() => { run(query); }, [query, run]);

  if (!result) return null;
  if (!result.emergency && result.translations.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Shown first and not dismissible. */}
      {result.emergency && result.emergencyNotice && (
        <div
          role="alert"
          className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3.5 text-sm font-semibold leading-relaxed text-rose-900"
        >
          {result.emergencyNotice}
        </div>
      )}

      {result.translations.map((t) => (
        <div key={t.term} className="rounded-xl border border-ink-200 bg-white p-3.5">
          <p className="text-sm font-bold text-ink-900">
            &ldquo;{t.term}&rdquo; is seen by{' '}
            {t.departments.length > 1 ? `${t.departments.length} departments` : 'this department'}
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-600">
            <IconInfo width={13} height={13} className="mt-0.5 shrink-0" />
            {t.guidance}
          </p>

          <ul className="mt-2.5 space-y-1.5">
            {t.departments.map((d) => (
              <li key={d.slug}>
                <button
                  type="button"
                  onClick={() => onPickSpecialty?.(d.slug)}
                  disabled={!onPickSpecialty}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-ink-50 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="mt-0.5 shrink-0 rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-800">
                    {d.label}
                  </span>
                  <span className="text-xs leading-snug text-ink-600">{d.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
