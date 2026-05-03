import Link from "next/link";

import type { AttractionOpeningHours, GraphNode } from "@/types/domain";
import { findNodes } from "@/lib/repositories/nodeRepository";
import { getAttractionOpeningHoursByAttractionIds } from "@/lib/repositories/attractionHoursRepository";

type SearchParamValue = string | string[] | undefined;
type PageSearchParams = Record<string, SearchParamValue>;

interface AdminAttractionHoursPageProps {
  searchParams?: Promise<PageSearchParams> | PageSearchParams;
}

const DEFAULT_LIMIT = 300;

export default async function AdminAttractionHoursPage({
  searchParams,
}: AdminAttractionHoursPageProps) {
  const params = await resolveSearchParams(searchParams);
  const region = parseStringParam(params.region);
  const limit = parseLimitParam(params.limit);

  const attractions = await findNodes({
    type: "attraction",
    ...(region ? { region } : {}),
    limit,
  });
  const openingHours = await getAttractionOpeningHoursByAttractionIds(
    attractions.map((attraction) => attraction.id),
  );
  const openingHoursByAttractionId = new Map(
    openingHours.map((entry) => [entry.attraction_id, entry]),
  );

  const missingAttractions = attractions.filter((attraction) => {
    const hours = openingHoursByAttractionId.get(attraction.id);
    return !hasUsableOpeningHours(hours);
  });
  const unknownConfidenceCount = openingHours.filter(
    (hours) => hours.confidence === "unknown",
  ).length;

  return (
    <section className="space-y-5">
      <div className="card p-6 sm:p-8">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
          Attraction opening hours
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
          Missing-hours backlog
        </h2>
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-ink-600)]">
          Tracks attractions that still lack usable weekly schedules, so the
          itinerary engine can reduce unknown-hour warnings and avoid closed-day
          placements more reliably.
        </p>
      </div>

      <div className="card p-5">
        <form method="get" className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Region
            <input
              type="text"
              name="region"
              defaultValue={region ?? ""}
              placeholder="e.g. rajasthan"
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            />
          </label>
          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Attraction limit
            <input
              type="number"
              name="limit"
              min={1}
              max={1000}
              defaultValue={limit}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            />
          </label>
          <div className="flex items-end gap-2 md:col-span-2">
            <button type="submit" className="btn-secondary">
              Apply filters
            </button>
            <Link
              href="/admin/attraction-hours"
              className="rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm font-medium text-[var(--color-ink-700)] hover:bg-[var(--color-sand-50)]"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        <li className="card border border-[var(--hairline)] px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-500)]">
            Attractions scanned
          </p>
          <p className="mt-2 text-3xl font-semibold text-[var(--color-ink-900)]">
            {attractions.length}
          </p>
        </li>
        <li className="card border border-[var(--hairline)] px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-500)]">
            Missing usable hours
          </p>
          <p className="mt-2 text-3xl font-semibold text-amber-700">
            {missingAttractions.length}
          </p>
        </li>
        <li className="card border border-[var(--hairline)] px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-500)]">
            Unknown confidence docs
          </p>
          <p className="mt-2 text-3xl font-semibold text-[var(--color-ink-900)]">
            {unknownConfidenceCount}
          </p>
        </li>
      </ul>

      <section className="card overflow-hidden">
        <header className="border-b border-[var(--hairline)] px-5 py-4 sm:px-6">
          <h3 className="text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
            Missing attractions ({missingAttractions.length})
          </h3>
        </header>
        {missingAttractions.length === 0 ? (
          <p className="px-5 py-8 text-sm text-[var(--color-ink-600)] sm:px-6">
            Every scanned attraction has a usable weekly schedule.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {missingAttractions.map((attraction) => {
              const hours = openingHoursByAttractionId.get(attraction.id);
              return (
                <li
                  key={attraction.id}
                  className="px-5 py-4 text-sm text-[var(--color-ink-700)] sm:px-6"
                >
                  <p className="font-medium text-[var(--color-ink-900)]">
                    {attraction.name}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                    {attraction.region} • {attraction.id}
                  </p>
                  <p className="mt-2 text-xs text-[var(--color-ink-600)]">
                    {describeMissingReason(hours, attraction)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}

async function resolveSearchParams(
  searchParams: Promise<PageSearchParams> | PageSearchParams | undefined,
): Promise<PageSearchParams> {
  if (!searchParams) return {};
  return await Promise.resolve(searchParams);
}

function parseStringParam(value: SearchParamValue): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return undefined;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseLimitParam(value: SearchParamValue): number {
  const parsed = Number.parseInt(parseStringParam(value) ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, 1_000));
}

function hasUsableOpeningHours(
  hours: AttractionOpeningHours | undefined,
): boolean {
  if (!hours) return false;
  if (hours.confidence === "unknown") return false;
  if (hours.weekly_periods.length > 0) return true;
  return (hours.closed_days?.length ?? 0) > 0;
}

function describeMissingReason(
  hours: AttractionOpeningHours | undefined,
  attraction: GraphNode,
): string {
  if (!hours) {
    const legacyWindow =
      typeof attraction.metadata.opening_time === "string" &&
      typeof attraction.metadata.closing_time === "string";
    if (legacyWindow) {
      return "No attraction_hours record yet; only legacy opening_time/closing_time metadata is present.";
    }
    return "No attraction_hours record and no legacy opening_time/closing_time metadata.";
  }
  if (hours.confidence === "unknown") {
    return "Record exists but confidence is unknown.";
  }
  if (hours.weekly_periods.length === 0 && (hours.closed_days?.length ?? 0) === 0) {
    return "Record exists but has no weekly periods or closed_days.";
  }
  return "Record exists but is not yet usable for deterministic scheduling.";
}
