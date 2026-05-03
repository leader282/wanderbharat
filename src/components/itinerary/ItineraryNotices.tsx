import type { Itinerary } from "@/types/domain";

/**
 * Surfaces engine-side warnings (closed attractions, unknown opening hours,
 * estimated data, accommodation fallbacks, ...) above the day-by-day
 * timeline so they are visible regardless of which section the user is
 * focused on. The budget panel used to render these as "Accommodation
 * notes" which mislabeled schedule-level information; this banner replaces
 * that surface.
 */
export default function ItineraryNotices({
  warnings,
}: {
  warnings: Itinerary["warnings"];
}) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <aside
      className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 md:px-5 md:py-4"
      aria-label="Itinerary heads-up"
    >
      <p className="text-sm font-semibold text-amber-900">Heads-up</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </aside>
  );
}
