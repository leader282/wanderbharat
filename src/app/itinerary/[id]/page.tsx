import Link from "next/link";
import { notFound } from "next/navigation";

import DayStayBlock, {
  type DayStayContext,
  type ItineraryStayEntry,
} from "@/components/DayStayBlock";
import ItineraryMap from "@/components/ItineraryMap";
import ItineraryBudgetPanel from "@/components/ItineraryBudgetPanel";
import type {
  Itinerary,
  ItineraryDay,
  ItineraryMapData,
  StayAssignment,
  TransportMode,
} from "@/types/domain";
import {
  buildDaySchedule,
  formatDuration,
  formatTimeRange,
  type ScheduleBlock,
} from "@/lib/itinerary/daySchedule";
import {
  formatClockTimeLabel,
  formatTravellerParty,
  makeMoneyFormatter,
  titleCaseWords,
} from "@/lib/itinerary/presentation";
import {
  getDisplayRouteStops,
  getDistinctDestinationCount,
  getRouteEndpoints,
} from "@/lib/itinerary/routeDisplay";
import { getAccommodations } from "@/lib/repositories/accommodationRepository";
import { getItinerary } from "@/lib/repositories/itineraryRepository";
import { getItineraryMapData } from "@/lib/services/itineraryMapService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ItineraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const itinerary = await getItinerary(id);
  if (!itinerary) notFound();

  const stayAccommodationIds = itinerary.stays
    .map((stay) => stay.accommodationId)
    .filter((id): id is string => Boolean(id));
  const accommodationsPromise = getAccommodations(stayAccommodationIds);
  const mapDataPromise = getItineraryMapData(itinerary, {
    getAccommodations: async () => accommodationsPromise,
  });
  const [accommodations, mapData] = await Promise.all([
    accommodationsPromise,
    mapDataPromise,
  ]);
  const stats = deriveStats(itinerary);
  const stayEntries = buildStayEntries(itinerary, accommodations);
  const stayByDayIndex = buildStayByDayIndex(stayEntries);
  const currency = itinerary.preferences.budget.currency ?? "INR";

  return (
    <section className="mt-10 md:mt-14 animate-fadeUp">
      <Link
        href="/plan"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-700)] transition-colors hover:text-[var(--color-ink-900)] hover:-translate-x-px"
      >
        <ArrowLeft />
        Plan another trip
      </Link>

      <Hero itinerary={itinerary} stats={stats} />
      <Summary itinerary={itinerary} stats={stats} />
      <ItineraryBudgetPanel
        itineraryId={itinerary.id}
        estimatedCost={itinerary.estimated_cost}
        requestedBudget={itinerary.preferences.budget}
        travellers={itinerary.preferences.travellers}
        breakdown={itinerary.budget_breakdown}
      />
      <MapSection itinerary={itinerary} mapData={mapData} />
      <RouteOverview itinerary={itinerary} />
      <Timeline
        itinerary={itinerary}
        stayByDayIndex={stayByDayIndex}
        currency={currency}
        startTime={itinerary.preferences.preferred_start_time}
      />
      <Footnote />
    </section>
  );
}

// ---------------------------------------------------------------------------

interface Stats {
  totalTravelHours: number;
  totalActivityHours: number;
  destinationCount: number;
  startName: string;
  endName: string;
}

function deriveStats(itinerary: Itinerary): Stats {
  const totalTravelHours = itinerary.day_plan.reduce(
    (a, d) => a + d.total_travel_hours,
    0,
  );
  const totalActivityHours = itinerary.day_plan.reduce(
    (a, d) => a + d.total_activity_hours,
    0,
  );
  const destinationCount = getDistinctDestinationCount(itinerary);
  const { startName, endName } = getRouteEndpoints(itinerary);

  return {
    totalTravelHours,
    totalActivityHours,
    destinationCount,
    startName,
    endName,
  };
}

function buildStayEntries(
  itinerary: Itinerary,
  accommodations: Awaited<ReturnType<typeof getAccommodations>>,
): ItineraryStayEntry[] {
  const accommodationsById = new Map(
    accommodations.map((accommodation) => [accommodation.id, accommodation]),
  );

  return itinerary.stays.map((stay) => ({
    stay,
    cityName: resolveStayCityName(itinerary.day_plan, stay),
    accommodation: stay.accommodationId
      ? (accommodationsById.get(stay.accommodationId) ?? null)
      : null,
  }));
}

function buildStayByDayIndex(
  entries: ItineraryStayEntry[],
): Map<number, DayStayContext> {
  const map = new Map<number, DayStayContext>();
  for (const entry of entries) {
    const { startDay, endDay } = entry.stay;
    for (let day = startDay; day <= endDay; day++) {
      map.set(day, {
        entry,
        nightNumber: day - startDay + 1,
        isFirstNight: day === startDay,
      });
    }
  }
  return map;
}

function resolveStayCityName(
  days: ItineraryDay[],
  stay: StayAssignment,
): string {
  const exactDay = days.find(
    (day) =>
      day.day_index === stay.startDay && day.base_node_id === stay.nodeId,
  );
  if (exactDay) return exactDay.base_node_name;

  const fallback = days.find((day) => day.base_node_id === stay.nodeId);
  return fallback?.base_node_name ?? stay.nodeId;
}

// ---------------------------------------------------------------------------

function MapSection({
  itinerary,
  mapData,
}: {
  itinerary: Itinerary;
  mapData: ItineraryMapData;
}) {
  const dayOptions = itinerary.day_plan.map((day) => ({
    day_index: day.day_index,
    label: `Day ${day.day_index + 1}`,
  }));

  return (
    <div className="mt-12">
      <p className="eyebrow">Map</p>
      <h2 className="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
        See the route on a real map
      </h2>
      <p className="mt-2 max-w-2xl text-[var(--color-ink-500)]">
        View your travel legs, city stops, accommodation pins, and day-specific
        attractions without leaving the itinerary.
      </p>
      <div className="mt-5">
        <ItineraryMap data={mapData} dayOptions={dayOptions} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Hero({ itinerary, stats }: { itinerary: Itinerary; stats: Stats }) {
  const summary =
    itinerary.start_node === itinerary.end_node
      ? `A ${paceAdjective(itinerary.preferences.travel_style)} loop starting and ending in ${stats.startName}, with ${stats.destinationCount} ${
          stats.destinationCount === 1 ? "destination" : "destinations"
        } and every day shaped around your pace.`
      : `A ${paceAdjective(itinerary.preferences.travel_style)} route from ${stats.startName} to ${stats.endName}, with ${stats.destinationCount} ${
          stats.destinationCount === 1 ? "destination" : "destinations"
        } and every day shaped around your pace.`;

  return (
    <header className="mt-6">
      <p className="eyebrow">{titleCaseWords(itinerary.region)} itinerary</p>
      <h1 className="mt-3 text-4xl md:text-[3rem] font-bold leading-[1.06] tracking-tight text-[var(--color-ink-900)]">
        Your {itinerary.days}-day trip through {titleCaseWords(itinerary.region)}.
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-600)]">
        {summary}
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------

function Summary({ itinerary, stats }: { itinerary: Itinerary; stats: Stats }) {
  const currency = itinerary.preferences.budget.currency ?? "INR";
  const formatMoney = makeMoneyFormatter(currency);
  const travellerLabel = formatTravellerParty(itinerary.preferences.travellers);
  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Total trip budget"
        value={formatMoney(itinerary.preferences.budget.max)}
        sub={`Estimated total cost ${formatMoney(itinerary.estimated_cost)}`}
      />
      <Stat
        label="Travellers"
        value={travellerLabel}
        sub={`${itinerary.days}-day trip`}
      />
      <Stat
        label="Destinations"
        value={String(stats.destinationCount)}
        sub={`${itinerary.days} days planned`}
      />
      <Stat
        label="Time on the road"
        value={`${roundHours(stats.totalTravelHours)} h`}
        sub={`${roundHours(stats.totalActivityHours)} h exploring`}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[var(--color-ink-500)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
        {value}
      </p>
      {sub && (
        <p className="mt-1.5 text-xs text-[var(--color-ink-500)]">{sub}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RouteOverview({ itinerary }: { itinerary: Itinerary }) {
  const stayStops: { id: string; days: number }[] = [];
  for (const day of itinerary.day_plan) {
    const last = stayStops[stayStops.length - 1];
    if (last && last.id === day.base_node_id) {
      last.days += 1;
    } else {
      stayStops.push({ id: day.base_node_id, days: 1 });
    }
  }

  const stops = getDisplayRouteStops(itinerary).reduce<{
    items: Array<{ id: string; name: string; badge: string | null }>;
    nextStayIndex: number;
  }>(
    (acc, stop, index) => {
      const currentStay = stayStops[acc.nextStayIndex];
      if (currentStay && currentStay.id === stop.id) {
        return {
          items: [
            ...acc.items,
            {
              ...stop,
              badge: `${currentStay.days}d`,
            },
          ],
          nextStayIndex: acc.nextStayIndex + 1,
        };
      }

      return {
        items: [
          ...acc.items,
          {
            ...stop,
            badge: index === 0 ? "start" : null,
          },
        ],
        nextStayIndex: acc.nextStayIndex,
      };
    },
    { items: [], nextStayIndex: 0 },
  ).items;

  return (
    <div className="mt-10 card p-6">
      <p className="eyebrow">Route</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-3 text-base font-bold">
        {stops.map((s, i) => (
          <span key={`${s.id}-${i}`} className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--color-sand-50)] px-3 py-1.5 text-[var(--color-ink-900)]">
              <Pin />
              {s.name}
              {s.badge && (
                <span className="text-xs font-semibold text-[var(--color-ink-500)]">
                  · {s.badge}
                </span>
              )}
            </span>
            {i < stops.length - 1 && (
              <span
                aria-hidden
                className="text-lg font-semibold text-[var(--color-ink-400)]"
              >
                →
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Timeline({
  itinerary,
  stayByDayIndex,
  currency,
  startTime,
}: {
  itinerary: Itinerary;
  stayByDayIndex: Map<number, DayStayContext>;
  currency: string;
  startTime: string | undefined;
}) {
  const startLabel = formatClockTimeLabel(startTime);

  return (
    <div className="mt-14">
      <p className="eyebrow">Day by day</p>
      <h2 className="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
        Your complete daily plan
      </h2>
      <p className="mt-2 max-w-2xl text-[var(--color-ink-500)]">
        A real clock for every day — travel, things to do, and where you&apos;ll
        sleep, all timed for you. Each day starts at{" "}
        <span className="font-semibold text-[var(--color-ink-900)]">
          {startLabel}
        </span>
        , with a 1-hour lunch slotted in around midday.
      </p>

      <ol className="mt-6 pl-8 space-y-6">
        {itinerary.day_plan.map((day, index) => (
          <li
            key={day.day_index}
            className="relative timeline-dot animate-fadeUp"
            style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
          >
            {index < itinerary.day_plan.length - 1 && (
              <span className="timeline-line" aria-hidden />
            )}
            <DayCard
              day={day}
              stayContext={stayByDayIndex.get(day.day_index)}
              currency={currency}
              startTime={startTime}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function DayCard({
  day,
  stayContext,
  currency,
  startTime,
}: {
  day: ItineraryDay;
  stayContext: DayStayContext | undefined;
  currency: string;
  startTime: string | undefined;
}) {
  const schedule = buildDaySchedule({ day, startTime });

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[var(--color-ink-500)]">
            Day {String(day.day_index + 1).padStart(2, "0")}
          </p>
          <h3 className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
            {day.base_node_name}
          </h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Badge
            label="Exploring"
            value={`${roundHours(day.total_activity_hours)} h`}
          />
          {day.total_travel_hours > 0 && (
            <Badge
              label="On the road"
              value={`${roundHours(day.total_travel_hours)} h`}
            />
          )}
        </div>
      </div>

      {schedule.length > 0 && (
        <ul className="mt-5 space-y-4">
          {schedule.map((block, i) => (
            <ScheduleRow
              key={`${block.kind}-${block.startMin}-${i}`}
              block={block}
              isFirst={i === 0}
            />
          ))}
        </ul>
      )}

      {stayContext && (
        <DayStayBlock context={stayContext} currency={currency} />
      )}
    </div>
  );
}

function ScheduleRow({
  block,
  isFirst,
}: {
  block: ScheduleBlock;
  isFirst: boolean;
}) {
  const range = formatTimeRange(block.startMin, block.endMin);
  const duration = formatDuration(block.durationMin);
  const rowClass = `flex gap-4 items-start pt-4 first:pt-0 border-t border-[rgba(26,23,20,0.06)] ${
    isFirst ? "border-t-0" : ""
  }`;

  if (block.kind === "travel") {
    return (
      <li className={rowClass}>
        <TransportIcon mode={block.transportMode} />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-3">
            <p className="font-bold text-[var(--color-ink-900)]">
              Travel to {block.toName}
            </p>
            <TimeRangeLabel range={range} duration={duration} />
          </div>
          <p className="text-sm text-[var(--color-ink-500)] mt-1">
            {Math.round(block.distanceKm)} km by{" "}
            {titleCaseWords(block.transportMode)}
          </p>
        </div>
      </li>
    );
  }

  if (block.kind === "meal") {
    return (
      <li className={rowClass}>
        <span className="mt-1 grid place-items-center w-9 h-9 rounded-lg bg-[var(--color-sand-100)] text-[var(--color-brand-700)] shrink-0">
          <Fork />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-3">
            <p className="font-bold text-[var(--color-ink-900)]">
              {block.label} break
            </p>
            <TimeRangeLabel range={range} duration={duration} />
          </div>
          <p className="text-sm text-[var(--color-ink-500)] mt-1">
            A flexible window to grab a meal nearby.
          </p>
        </div>
      </li>
    );
  }

  const a = block.activity;
  return (
    <li className={rowClass}>
      <span className="mt-1 grid place-items-center w-9 h-9 rounded-lg bg-[var(--color-sand-100)] text-[var(--color-brand-700)] shrink-0">
        <Compass />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start gap-3">
          <p className="font-bold text-[var(--color-ink-900)]">{a.name}</p>
          <TimeRangeLabel range={range} duration={duration} />
        </div>
        {a.description && (
          <p className="text-sm text-[var(--color-ink-500)] mt-1">
            {a.description}
          </p>
        )}
        {a.tags.length > 0 && (
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            {a.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[0.68rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white border border-[rgba(26,23,20,0.08)] text-[var(--color-ink-500)]"
              >
                {titleCaseWords(t)}
              </span>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

function TimeRangeLabel({
  range,
  duration,
}: {
  range: string;
  duration: string;
}) {
  return (
    <span className="text-xs font-mono font-semibold text-[var(--color-ink-500)] whitespace-nowrap text-right shrink-0">
      <span className="text-[var(--color-ink-900)]">{range}</span>
      <span className="ml-1.5 opacity-70">· {duration}</span>
    </span>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(26,23,20,0.08)] bg-white px-2.5 py-1">
      <span className="text-[var(--color-ink-500)] uppercase tracking-widest text-[0.65rem] font-bold">
        {label}
      </span>
      <span className="font-bold text-[var(--color-ink-900)]">{value}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------

function Footnote() {
  return (
    <div className="mt-10 flex items-center justify-between flex-wrap gap-3 card p-5">
      <div>
        <p className="font-bold">Want to tweak something?</p>
        <p className="text-sm text-[var(--color-ink-500)]">
          Start over with a different pace or starting city, or compare this
          trip against another total budget above and apply the new version if
          you like it.
        </p>
      </div>
      <Link href="/plan" className="btn-primary">
        Build another trip
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons / helpers
// ---------------------------------------------------------------------------

function TransportIcon({ mode }: { mode: TransportMode }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <span
      aria-hidden
      className="grid place-items-center w-9 h-9 rounded-lg bg-white text-[var(--color-brand-700)] border border-[rgba(26,23,20,0.08)]"
    >
      {mode === "flight" ? (
        <svg {...common}>
          <path d="M17.8 19.2 16 11l3.5-3.5a2.5 2.5 0 0 0-3.6-3.6L12.5 7.5 4.3 5.7l-1.4 1.4 5.8 4.1-3.3 3.3H2l1 1.7 1.9.9.9 1.9 1.7 1h1.5l3.3-3.3 4.1 5.8z" />
        </svg>
      ) : mode === "train" ? (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="16" rx="2" />
          <path d="M4 11h16" />
          <path d="M7 20l2-2M17 20l-2-2" />
          <circle cx="9" cy="15" r="1" />
          <circle cx="15" cy="15" r="1" />
        </svg>
      ) : (
        <svg {...common}>
          <path d="M5 17h14" />
          <path d="M5 17V9l3-5h8l3 5v8" />
          <circle cx="8" cy="17" r="2" />
          <circle cx="16" cy="17" r="2" />
        </svg>
      )}
    </span>
  );
}

function Pin() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--color-brand-700)]"
    >
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function Compass() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}

function Fork() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 2v8a3 3 0 0 0 6 0V2" />
      <path d="M10 10v12" />
      <path d="M17 2c-1.5 0-3 2-3 5v6h3" />
      <path d="M17 13v9" />
    </svg>
  );
}

function ArrowLeft() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5" />
      <path d="m11 19-7-7 7-7" />
    </svg>
  );
}

function roundHours(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n < 1) return n.toFixed(1);
  return (Math.round(n * 2) / 2).toFixed(1).replace(/\.0$/, "");
}

function paceAdjective(style: string): string {
  switch (style) {
    case "relaxed":
      return "relaxed";
    case "adventurous":
      return "fast-paced";
    default:
      return "well-paced";
  }
}
