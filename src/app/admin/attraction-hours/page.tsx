import Link from "next/link";

import {
  OPENING_HOURS_WEEKDAYS,
  type AttractionOpeningHours,
  type GraphNode,
} from "@/types/domain";
import {
  hydrateAttractionHoursAction,
  markAttractionHoursUnknownAction,
  upsertAttractionHoursAction,
} from "@/app/admin/attraction-hours/actions";
import {
  formatWeeklyPeriods,
  MANUAL_HOURS_CONFIDENCE_LEVELS,
  MANUAL_HOURS_SOURCE_TYPES,
} from "@/lib/admin/attractionHoursValidation";
import { findNodes, getNodes } from "@/lib/repositories/nodeRepository";
import { getAttractionOpeningHoursByAttractionIds } from "@/lib/repositories/attractionHoursRepository";

type SearchParamValue = string | string[] | undefined;
type PageSearchParams = Record<string, SearchParamValue>;

interface AdminAttractionHoursPageProps {
  searchParams?: Promise<PageSearchParams> | PageSearchParams;
}

const DEFAULT_LIMIT = 300;

const HOURS_FILTERS = ["all", "missing_only", "unknown_only"] as const;
type HoursFilter = (typeof HOURS_FILTERS)[number];

export default async function AdminAttractionHoursPage({
  searchParams,
}: AdminAttractionHoursPageProps) {
  const params = await resolveSearchParams(searchParams);
  const region = parseStringParam(params.region);
  const cityId = parseStringParam(params.city_id);
  const limit = parseLimitParam(params.limit);
  const activeFilter = parseHoursFilter(params.filter);
  const hydrationStatus = parseHydrationStatus(params.hydration_status);
  const hydrationMessage = parseStringParam(params.hydration_message);
  const scheduleStatus = parseScheduleStatus(params.schedule_status);
  const scheduleMessage = parseStringParam(params.schedule_message);

  const attractions = (
    await findNodes({
      type: "attraction",
      ...(region ? { region } : {}),
      limit,
    })
  ).sort((left, right) => left.name.localeCompare(right.name));
  const openingHours = await getAttractionOpeningHoursByAttractionIds(
    attractions.map((attraction) => attraction.id),
  );
  const openingHoursByAttractionId = new Map(
    openingHours.map((entry) => [entry.attraction_id, entry]),
  );
  const parentCityIds = Array.from(
    new Set(
      attractions
        .map((attraction) =>
          typeof attraction.parent_node_id === "string"
            ? attraction.parent_node_id
            : null,
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const [parentCities, cityOptions] = await Promise.all([
    getNodes(parentCityIds),
    findNodes({
      type: "city",
      ...(region ? { region } : {}),
      limit: 500,
    }),
  ]);
  const cityNameById = new Map(parentCities.map((city) => [city.id, city.name]));
  const sortedCityOptions = cityOptions.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const cityFilteredAttractions = cityId
    ? attractions.filter((attraction) => attraction.parent_node_id === cityId)
    : attractions;

  const missingAttractions = cityFilteredAttractions.filter((attraction) => {
    const hours = openingHoursByAttractionId.get(attraction.id);
    return !hasUsableOpeningHours(hours);
  });
  const unknownConfidenceCount = openingHours.filter(
    (hours) => hours.confidence === "unknown",
  ).length;

  // Visible-list narrowing for the editor section. The "Missing attractions"
  // summary and counts above always reflect the full city/region scope so
  // admins can see total backlog at a glance even when filtering.
  const filteredAttractions = cityFilteredAttractions.filter((attraction) => {
    if (activeFilter === "missing_only") {
      return !hasUsableOpeningHours(openingHoursByAttractionId.get(attraction.id));
    }
    if (activeFilter === "unknown_only") {
      return openingHoursByAttractionId.get(attraction.id)?.confidence === "unknown";
    }
    return true;
  });

  const limitReached = attractions.length >= limit;

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
        <form method="get" className="grid gap-3 md:grid-cols-5">
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
            City
            <select
              name="city_id"
              defaultValue={cityId ?? ""}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            >
              <option value="">All cities</option>
              {sortedCityOptions.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Show
            <select
              name="filter"
              defaultValue={activeFilter}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            >
              <option value="all">All schedules</option>
              <option value="missing_only">Missing usable schedule</option>
              <option value="unknown_only">Unknown confidence</option>
            </select>
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
          <div className="flex items-end gap-2">
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

      {limitReached ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Showing the first {limit} attractions (limit reached). Increase the
          limit or narrow the region/city filters to see the rest.
        </div>
      ) : null}

      <section className="card p-5">
        <h3 className="text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
          Hydrate one attraction from Google Places
        </h3>
        <p className="mt-2 text-sm text-[var(--color-ink-600)]">
          Admin-triggered only: fetches a single place&apos;s weekly schedule,
          normalises it into <code>attraction_hours</code>, and records quality
          issues when Google returns missing data.
        </p>
        <form
          action={hydrateAttractionHoursAction}
          className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Google place id
            <input
              type="text"
              name="google_place_id"
              placeholder="e.g. ChIJ..."
              required
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            />
          </label>
          <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Attraction id (optional)
            <input
              type="text"
              name="attraction_id"
              placeholder="e.g. attr_city_palace"
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            />
          </label>
          <div className="flex items-end">
            <button type="submit" className="btn-secondary">
              Hydrate hours
            </button>
          </div>
        </form>
      </section>

      {hydrationStatus && hydrationMessage ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            hydrationStatus === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : hydrationStatus === "empty"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {hydrationMessage}
        </div>
      ) : null}
      {scheduleStatus && scheduleMessage ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            scheduleStatus === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {scheduleMessage}
        </div>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-3">
        <li className="card border border-[var(--hairline)] px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-500)]">
            Attractions scanned
          </p>
          <p className="mt-2 text-3xl font-semibold text-[var(--color-ink-900)]">
            {cityFilteredAttractions.length}
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
              const googlePlaceId = readGooglePlaceId(attraction);
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
                  <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                    {googlePlaceId
                      ? `google_place_id: ${googlePlaceId}`
                      : "google_place_id is missing on this attraction."}
                  </p>
                  <div className="mt-3">
                    <form action={hydrateAttractionHoursAction}>
                      <input type="hidden" name="attraction_id" value={attraction.id} />
                      {googlePlaceId ? (
                        <input
                          type="hidden"
                          name="google_place_id"
                          value={googlePlaceId}
                        />
                      ) : null}
                      <button
                        type="submit"
                        className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                          googlePlaceId
                            ? "border-[var(--hairline)] text-[var(--color-ink-700)] hover:bg-[var(--color-sand-50)]"
                            : "border-amber-200 text-amber-800 hover:bg-amber-50"
                        }`}
                        title={
                          googlePlaceId
                            ? "Fetch opening hours for this attraction from Google Places"
                            : "Record that this attraction needs a google_place_id before hydration."
                        }
                      >
                        {googlePlaceId
                          ? "Hydrate from Google Places"
                          : "Record missing place id"}
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <header className="card border border-[var(--hairline)] px-5 py-4 sm:px-6">
          <h3 className="text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
            Current schedules ({filteredAttractions.length}
            {activeFilter !== "all"
              ? ` of ${cityFilteredAttractions.length}`
              : ""}
            )
          </h3>
          <p className="mt-1 text-sm text-[var(--color-ink-600)]">
            Edit weekly periods using one line per entry (<code>mon
            09:00-17:00</code>), mark closed days, or explicitly save unknown.
          </p>
        </header>

        {filteredAttractions.length === 0 ? (
          <div className="card px-5 py-8 text-sm text-[var(--color-ink-600)]">
            No attractions found for the selected filters.
          </div>
        ) : (
          filteredAttractions.map((attraction) => {
            const hours = openingHoursByAttractionId.get(attraction.id);
            const googlePlaceId = readGooglePlaceId(attraction);
            const cityName =
              (attraction.parent_node_id &&
                cityNameById.get(attraction.parent_node_id)) ??
              attraction.parent_node_id ??
              "unknown city";
            const closedDays = new Set(hours?.closed_days ?? []);

            return (
              <article
                key={attraction.id}
                id={`attr-${attraction.id}`}
                className="card border border-[var(--hairline)] p-5 scroll-mt-20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-semibold text-[var(--color-ink-900)]">
                      {attraction.name}
                    </h4>
                    <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                      {cityName} • {attraction.region} • {attraction.id}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                      google_place_id: {googlePlaceId ?? "missing"}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-[var(--color-sand-50)] px-2.5 py-1 text-[var(--color-ink-700)]">
                      source: {hours?.source_type ?? "none"}
                    </span>
                    <span className="rounded-full bg-[var(--color-sand-50)] px-2.5 py-1 text-[var(--color-ink-700)]">
                      confidence: {hours?.confidence ?? "none"}
                    </span>
                    <span className="rounded-full bg-[var(--color-sand-50)] px-2.5 py-1 text-[var(--color-ink-700)]">
                      fetched: {formatTimestamp(hours?.fetched_at)}
                    </span>
                  </div>
                </div>

                {hours ? (
                  <div className="mt-3 rounded-lg bg-[var(--color-sand-50)] px-3 py-2 text-xs text-[var(--color-ink-700)]">
                    <p>
                      Weekly periods:{" "}
                      {hours.weekly_periods.length > 0
                        ? hours.weekly_periods
                            .map(
                              (period) =>
                                `${period.day} ${period.opens}-${period.closes}`,
                            )
                            .join(", ")
                        : "none"}
                    </p>
                    <p className="mt-1">
                      Closed days:{" "}
                      {hours.closed_days && hours.closed_days.length > 0
                        ? hours.closed_days.join(", ")
                        : "none"}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-amber-700">
                    No <code>attraction_hours</code> record exists yet.
                  </p>
                )}

                <form
                  action={upsertAttractionHoursAction}
                  className="mt-4 grid gap-3 md:grid-cols-3"
                >
                  <input type="hidden" name="attraction_id" value={attraction.id} />

                  <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                    Timezone
                    <input
                      type="text"
                      name="timezone"
                      defaultValue={
                        hours?.timezone ??
                        (typeof attraction.metadata.timezone === "string"
                          ? attraction.metadata.timezone
                          : "Asia/Kolkata")
                      }
                      className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                    />
                  </label>

                  <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                    Source
                    <select
                      name="source_type"
                      defaultValue={
                        // Whitelist the dropdown to manual-safe values. If the
                        // existing record carries a provider source (e.g. a
                        // prior Google hydration), the form intentionally
                        // falls back to "manual" so a manual save can never
                        // re-stamp a record as `google_places`.
                        hours?.source_type &&
                        (
                          MANUAL_HOURS_SOURCE_TYPES as readonly string[]
                        ).includes(hours.source_type)
                          ? hours.source_type
                          : "manual"
                      }
                      className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                    >
                      {MANUAL_HOURS_SOURCE_TYPES.map((sourceType) => (
                        <option key={sourceType} value={sourceType}>
                          {sourceType}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                    Confidence
                    <select
                      name="confidence"
                      defaultValue={
                        hours?.confidence &&
                        (
                          MANUAL_HOURS_CONFIDENCE_LEVELS as readonly string[]
                        ).includes(hours.confidence)
                          ? hours.confidence
                          : "verified"
                      }
                      className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                    >
                      {MANUAL_HOURS_CONFIDENCE_LEVELS.map((confidence) => (
                        <option key={confidence} value={confidence}>
                          {confidence}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-xs text-[var(--color-ink-600)] md:col-span-3">
                    Weekly periods (one per line)
                    <textarea
                      name="weekly_periods"
                      rows={5}
                      defaultValue={formatWeeklyPeriods(hours?.weekly_periods ?? [])}
                      placeholder={"mon 09:00-17:00\nwed 10:00-16:30"}
                      className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 font-mono text-sm"
                    />
                  </label>

                  <div className="md:col-span-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
                      Closed days
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {OPENING_HOURS_WEEKDAYS.map((day) => (
                        <label
                          key={day}
                          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-700)]"
                        >
                          <input
                            type="checkbox"
                            name="closed_days"
                            value={day}
                            defaultChecked={closedDays.has(day)}
                          />
                          {day}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="md:col-span-3">
                    <button type="submit" className="btn-secondary">
                      Save schedule
                    </button>
                  </div>
                </form>

                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={markAttractionHoursUnknownAction}>
                    <input type="hidden" name="attraction_id" value={attraction.id} />
                    <input
                      type="hidden"
                      name="timezone"
                      value={hours?.timezone ?? "Asia/Kolkata"}
                    />
                    <button type="submit" className="btn-secondary">
                      Mark unknown
                    </button>
                  </form>
                  <form action={hydrateAttractionHoursAction}>
                    <input type="hidden" name="attraction_id" value={attraction.id} />
                    {googlePlaceId ? (
                      <input
                        type="hidden"
                        name="google_place_id"
                        value={googlePlaceId}
                      />
                    ) : null}
                    <button
                      type="submit"
                      className="rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm font-medium text-[var(--color-ink-700)] hover:bg-[var(--color-sand-50)]"
                    >
                      {googlePlaceId
                        ? "Hydrate from Google Places"
                        : "Record missing place id"}
                    </button>
                  </form>
                </div>
              </article>
            );
          })
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

function parseHoursFilter(value: SearchParamValue): HoursFilter {
  const candidate = parseStringParam(value) as HoursFilter | undefined;
  if (candidate && (HOURS_FILTERS as readonly string[]).includes(candidate)) {
    return candidate;
  }
  return "all";
}

function parseHydrationStatus(
  value: SearchParamValue,
): "success" | "empty" | "error" | undefined {
  const candidate = parseStringParam(value);
  if (
    candidate === "success" ||
    candidate === "empty" ||
    candidate === "error"
  ) {
    return candidate;
  }
  return undefined;
}

function parseScheduleStatus(
  value: SearchParamValue,
): "success" | "error" | undefined {
  const candidate = parseStringParam(value);
  if (candidate === "success" || candidate === "error") {
    return candidate;
  }
  return undefined;
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

function readGooglePlaceId(attraction: GraphNode): string | undefined {
  if (typeof attraction.metadata.google_place_id !== "string") {
    return undefined;
  }
  const trimmed = attraction.metadata.google_place_id.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(timestamp: number | null | undefined): string {
  if (!Number.isFinite(timestamp)) return "-";
  return TIMESTAMP_FORMATTER.format(new Date(Number(timestamp)));
}
