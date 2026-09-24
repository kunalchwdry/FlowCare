'use client';

import Link from 'next/link';
import { AvailabilityPill, FlowCareRating, GoogleRating } from './Badges';
import { IconChevron, IconClose } from './Icons';
import { formatDistance } from '@/lib/discovery/geo';
import type { DiscoveryResult } from '@/lib/types';

/** Compact map-marker preview. Bottom sheet on mobile, floating card on desktop. */
export function HospitalPreviewSheet({
  result, onClose,
}: { result: DiscoveryResult | null; onClose: () => void }) {
  if (!result) return null;
  const h = result.hospital;
  const depts = h.departments.filter((d) => d.active).slice(0, 3);

  return (
    <div
      role="dialog"
      aria-label={`${h.name} preview`}
      className="pointer-events-auto fixed inset-x-0 bottom-[58px] z-40 md:absolute md:bottom-4 md:left-4 md:right-auto md:w-[360px]"
    >
      <div className="fc-card mx-3 md:mx-0">
        <div className="flex items-start gap-2 p-4 pb-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold text-ink-900">{h.name}</h3>
            <p className="mt-0.5 truncate text-xs text-ink-500">
              {h.addressLine}
              {result.distanceKm !== null && <> · <span className="font-medium text-ink-700">{formatDistance(result.distanceKm)}</span></>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close preview" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-ink-100">
            <IconClose width={17} height={17} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          <AvailabilityPill state={result.availability.state} nextDate={result.availability.nextAvailableDate} compact />
          <FlowCareRating summary={result.flowcareRating} />
          <GoogleRating rating={result.external.data?.rating} count={result.external.data?.userRatingCount} uri={result.external.data?.googleMapsUri} />
        </div>

        {depts.length > 0 && (
          <div className="flex flex-wrap gap-1 px-4 pb-3">
            {depts.map((d) => (
              <span key={d.id} className="rounded-lg bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-700">{d.name}</span>
            ))}
          </div>
        )}

        <div className="flex gap-2 border-t border-ink-100 p-3">
          <Link href={`/hospitals/${h.slug}`} className="fc-btn-primary flex-1 !py-2 !min-h-[42px] text-xs">
            View hospital <IconChevron width={14} height={14} />
          </Link>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${h.location.lat},${h.location.lng}${
              result.external.placeId ? `&destination_place_id=${result.external.placeId}` : ''
            }`}
            target="_blank"
            rel="noopener noreferrer"
            className="fc-btn-secondary !py-2 !min-h-[42px] text-xs"
          >
            Directions
          </a>
        </div>
      </div>
    </div>
  );
}
