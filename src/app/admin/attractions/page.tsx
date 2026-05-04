import Link from "next/link";

import type { AttractionOpeningHours, GraphNode } from "@/types/domain";
import { updateAttractionMetadataAction } from "@/app/admin/attractions/actions";
import { listMissingForAttractions } from "@/lib/repositories/attractionAdmissionRepository";
import { getAttractionOpeningHoursByAttractionIds } from "@/lib/repositories/attractionHoursRepository";
import { findNodes, getNodes } from "@/lib/repositories/nodeRepository";

type SearchParamValue = string | string[] | undefined;
type PageSearchParams = Record<string, SearchParamValue>;

interface AdminAttractionsPageProps {
  searchParams?: Promise<PageSearchParams> | PageSearchParams;
}

const DEFAULT_LIMIT = 250;

const ATTRACTION_FILTERS = [
  "all",
  "missing_hours",
  "missing_costs",
  "mock",
  "disabled",
] as const;
type AttractionFilter = (typeof ATTRACTION_FILTERS)[number];

export default async function AdminAttractionsPage({
  searchParams,
}: AdminAttractionsPageProps) {
  const params = await resolveSearchParams(searchParams);
  const region = parseStringParam(params.region);
  const cityId = parseStringParam(params.city_id);
  const limit = parseLimitParam(params.limit);
  const activeFilter = parseAttractionFilter(params.filter);
  const saveStatus = parseSaveStatus(params.save_status);
  const saveMessage = parseStringParam(params.save_message);

  const attractions = (
    await findNodes({
      type: "attraction",
      ...(region ? { region } : {}),
      limit,
    })
  ).sort((left, right) => left.name.localeCompare(right.name));
  const attractionIds = attractions.map((attraction) => attraction.id);
  const [hoursRecords, missingCosts] = await Promise.all([
    getAttractionOpeningHoursByAttractionIds(attractionIds),
    listMissingForAttractions(attractionIds),
  ]);

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
  const hoursByAttractionId = new Map(
    hoursRecords.map((record) => [record.attraction_id, record]),
  );
  const missingCostsByAttractionId = new Map(
    missingCosts.map((entry) => [entry.attraction_id, entry]),
  );

  const missingHoursCount = cityFilteredAttractions.filter((attraction) => {
    const record = hoursByAttractionId.get(attraction.id);
    return !hasUsableOpeningHours(record);
  }).length;
  const missingCostsCount = cityFilteredAttractions.filter((attraction) =>
    missingCostsByAttractionId.has(attraction.id),
  ).length;
  const mockFlaggedCount = cityFilteredAttractions.filter((attraction) =>
    containsMockMarker(attraction),
  ).length;
  const disabledCount = cityFilteredAttractions.filter(isAttractionDisabled).length;

  // The issue-axis filter narrows the visible list so an admin can blow
  // through one backlog at a time (e.g. "fix the 12 attractions with
  // missing hours"). Filtering happens after the city/region cuts so the
  // summary cards keep showing region-or-city totals.
  const filteredAttractions = cityFilteredAttractions.filter((attraction) => {
    switch (activeFilter) {
      case "missing_hours":
        return !hasUsableOpeningHours(hoursByAttractionId.get(attraction.id));
      case "missing_costs":
        return missingCostsByAttractionId.has(attraction.id);
      case "mock":
        return containsMockMarker(attraction);
      case "disabled":
        return isAttractionDisabled(attraction);
      default:
        return true;
    }
  });

  const limitReached = attractions.length >= limit;

  return (
    <section className="space-y-5">
      <div className="card p-6 sm:p-8">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
          Attraction metadata
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
          Manual quality fixes
        </h2>
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-ink-600)]">
          Use this page to fix attraction identity and planning metadata. Changes
          are persisted server-side and flow into the data quality scanner for
          missing hours/costs cleanup.
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
              <option value="all">All attractions</option>
              <option value="missing_hours">Missing usable hours</option>
              <option value="missing_costs">Missing admission costs</option>
              <option value="mock">Mock-flagged</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Attraction limit
            <input
              type="number"
              name="limit"
              min={1}
              max={1_000}
              defaultValue={limit}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            />
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn-secondary">
              Apply filters
            </button>
            <Link
              href="/admin/attractions"
              className="rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm font-medium text-[var(--color-ink-700)] hover:bg-[var(--color-sand-50)]"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      {saveStatus && saveMessage ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            saveStatus === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {saveMessage}
        </div>
      ) : null}

      {limitReached ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Showing the first {limit} attractions (limit reached). Increase the
          limit or narrow the region/city filters to see the rest.
        </div>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-5">
        <SummaryCard
          label="Attractions listed"
          value={filteredAttractions.length}
          tone="default"
        />
        <SummaryCard
          label="Missing usable hours"
          value={missingHoursCount}
          tone="warn"
        />
        <SummaryCard
          label="Missing admission costs"
          value={missingCostsCount}
          tone="warn"
        />
        <SummaryCard label="Mock-flagged records" value={mockFlaggedCount} tone="warn" />
        <SummaryCard label="Disabled" value={disabledCount} tone="default" />
      </ul>

      <section className="space-y-4">
        {filteredAttractions.length === 0 ? (
          <div className="card px-5 py-8 text-sm text-[var(--color-ink-600)]">
            No attractions found for the selected filters.
          </div>
        ) : (
          filteredAttractions.map((attraction) => {
            const hoursRecord = hoursByAttractionId.get(attraction.id);
            const missingCost = missingCostsByAttractionId.get(attraction.id);
            const hasMissingHours = !hasUsableOpeningHours(hoursRecord);
            const googlePlaceId = readGooglePlaceId(attraction);
            const status = isAttractionDisabled(attraction) ? "disabled" : "active";
            const cityName =
              (attraction.parent_node_id &&
                cityNameById.get(attraction.parent_node_id)) ??
              attraction.parent_node_id ??
              "unknown city";

            return (
              <article
                key={attraction.id}
                id={`attr-${attraction.id}`}
                className="card border border-[var(--hairline)] p-5 scroll-mt-20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
                      {attraction.name}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                      {cityName} • {attraction.region} • {attraction.id}
                    </p>
                    <p className="mt-2 text-xs text-[var(--color-ink-600)]">
                      google_place_id: {googlePlaceId ?? "missing"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {hasMissingHours ? <Badge tone="warn">Missing hours</Badge> : null}
                    {missingCost ? <Badge tone="warn">Missing costs</Badge> : null}
                    {containsMockMarker(attraction) ? (
                      <Badge tone="critical">Mock data</Badge>
                    ) : null}
                    {status === "disabled" ? (
                      <Badge tone="neutral">Disabled</Badge>
                    ) : (
                      <Badge tone="ok">Active</Badge>
                    )}
                  </div>
                </div>

                <form
                  action={updateAttractionMetadataAction}
                  className="mt-4 grid gap-3 md:grid-cols-2"
                >
                  <input type="hidden" name="attraction_id" value={attraction.id} />

                  <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                    Name
                    <input
                      type="text"
                      name="name"
                      defaultValue={attraction.name}
                      required
                      className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                    Google place id
                    <input
                      type="text"
                      name="google_place_id"
                      defaultValue={googlePlaceId ?? ""}
                      placeholder="e.g. ChIJ..."
                      className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                    Recommended hours
                    <input
                      type="number"
                      name="recommended_hours"
                      min={0.25}
                      max={24}
                      step={0.25}
                      defaultValue={
                        typeof attraction.metadata.recommended_hours === "number"
                          ? attraction.metadata.recommended_hours
                          : ""
                      }
                      placeholder="e.g. 2.5"
                      className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                    Status
                    <select
                      name="status"
                      defaultValue={status}
                      className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm"
                    >
                      <option value="active">active</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </label>

                  <label className="space-y-1 text-xs text-[var(--color-ink-600)] md:col-span-2">
                    Tags (comma separated)
                    <input
                      type="text"
                      name="tags"
                      defaultValue={attraction.tags.join(", ")}
                      placeholder="heritage, family, architecture"
                      className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="space-y-1 text-xs text-[var(--color-ink-600)] md:col-span-2">
                    Description
                    <textarea
                      name="description"
                      defaultValue={readDescription(attraction)}
                      rows={3}
                      className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm"
                    />
                  </label>

                  <div className="md:col-span-2">
                    <button type="submit" className="btn-secondary">
                      Save attraction metadata
                    </button>
                  </div>
                </form>
              </article>
            );
          })
        )}
      </section>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "warn";
}) {
  return (
    <li className="card border border-[var(--hairline)] px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-500)]">
        {label}
      </p>
      <p
        className={`mt-2 text-3xl font-semibold ${
          tone === "warn" ? "text-amber-700" : "text-[var(--color-ink-900)]"
        }`}
      >
        {value}
      </p>
    </li>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "warn" | "critical" | "ok" | "neutral";
}) {
  const className =
    tone === "critical"
      ? "bg-red-100 text-red-700"
      : tone === "warn"
        ? "bg-amber-100 text-amber-700"
        : tone === "ok"
          ? "bg-emerald-100 text-emerald-700"
          : "bg-[var(--color-sand-50)] text-[var(--color-ink-700)]";

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
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

function parseAttractionFilter(value: SearchParamValue): AttractionFilter {
  const candidate = parseStringParam(value) as AttractionFilter | undefined;
  if (candidate && (ATTRACTION_FILTERS as readonly string[]).includes(candidate)) {
    return candidate;
  }
  return "all";
}

function parseSaveStatus(value: SearchParamValue): "success" | "error" | undefined {
  const candidate = parseStringParam(value);
  if (candidate === "success" || candidate === "error") return candidate;
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

function readGooglePlaceId(attraction: GraphNode): string | undefined {
  if (typeof attraction.metadata.google_place_id !== "string") {
    return undefined;
  }
  const trimmed = attraction.metadata.google_place_id.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readDescription(attraction: GraphNode): string {
  if (typeof attraction.metadata.description !== "string") return "";
  return attraction.metadata.description;
}

function isAttractionDisabled(attraction: GraphNode): boolean {
  return attraction.metadata.disabled === true;
}

function containsMockMarker(attraction: GraphNode): boolean {
  const visited = new WeakSet<object>();
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    if (visited.has(value)) return false;
    visited.add(value);

    if (Array.isArray(value)) {
      return value.some((entry) => visit(entry));
    }

    const record = value as Record<string, unknown>;
    if (record.source_type === "mock" || record.source === "mock") {
      return true;
    }
    return Object.values(record).some((entry) => visit(entry));
  };

  return visit(attraction);
}
