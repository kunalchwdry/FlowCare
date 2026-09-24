/**
 * Google Maps Platform attribution.
 * Policy: attribution must accompany displayed Places content; the Google Maps
 * logo is preferred, the text "Google Maps" is acceptable where space is
 * limited; user-generated content (reviews/photos) must credit its author.
 * https://developers.google.com/maps/documentation/places/web-service/policies
 */
export function GoogleAttribution({
  variant = 'inline', mapsUri,
}: { variant?: 'inline' | 'block'; mapsUri?: string | null }) {
  const logo = (
    <span className="inline-flex items-center gap-1 font-semibold">
      <span className="text-[#4285F4]">G</span>
      <span className="text-[#DB4437]">o</span>
      <span className="text-[#F4B400]">o</span>
      <span className="text-[#4285F4]">g</span>
      <span className="text-[#0F9D58]">l</span>
      <span className="text-[#DB4437]">e</span>
      <span className="ml-1 text-ink-600">Maps</span>
    </span>
  );

  if (variant === 'inline') {
    return <span className="text-[11px] text-ink-500">Data by {logo}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-[11px] text-ink-600">
      <span>Place details, ratings, reviews and photos in this section are provided by {logo} and are not verified by FlowCare.</span>
      {mapsUri && (
        <a href={mapsUri} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 underline">
          View on Google Maps
        </a>
      )}
    </div>
  );
}
