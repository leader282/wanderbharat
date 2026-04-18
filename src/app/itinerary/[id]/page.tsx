import Link from "next/link";
import { notFound } from "next/navigation";

import type { Itinerary, ItineraryDay, TransportMode } from "@/types/domain";
import { getItinerary } from "@/lib/repositories/itineraryRepository";

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

  const stats = deriveStats(itinerary);

  return (
    <section className="mt-10 md:mt-14 animate-fadeUp">
      <Link
        href="/plan"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand-700)] hover:translate-x-[-2px] transition-transform"
      >
        <ArrowLeft />
        Plan another trip
      </Link>

      <Hero itinerary={itinerary} stats={stats} />
      <Summary itinerary={itinerary} stats={stats} />
      <RouteOverview itinerary={itinerary} />
      <Timeline itinerary={itinerary} />
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
  const distinctBases = new Set(itinerary.day_plan.map((d) => d.base_node_id));
  const destinationCount = Math.max(0, distinctBases.size);

  const startName =
    itinerary.day_plan[0]?.base_node_name ?? "your start";
  const endName =
    itinerary.day_plan[itinerary.day_plan.length - 1]?.base_node_name ?? startName;

  return {
    totalTravelHours,
    totalActivityHours,
    destinationCount,
    startName,
    endName,
  };
}

// ---------------------------------------------------------------------------

function Hero({ itinerary, stats }: { itinerary: Itinerary; stats: Stats }) {
  return (
    <header className="mt-6">
      <p className="eyebrow">{titleCase(itinerary.region)} itinerary</p>
      <h1 className="mt-2 text-4xl md:text-5xl font-black leading-[1.05]">
        Your {itinerary.days}-day trip through {titleCase(itinerary.region)}.
      </h1>
      <p className="mt-3 text-lg text-[var(--color-ink-700)] max-w-2xl">
        A {paceAdjective(itinerary.preferences.travel_style)} loop starting
        and ending in {stats.startName}, with {stats.destinationCount}{" "}
        {stats.destinationCount === 1 ? "destination" : "destinations"} and
        every day shaped around your pace.
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------

function Summary({
  itinerary,
  stats,
}: {
  itinerary: Itinerary;
  stats: Stats;
}) {
  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Estimated cost"
        value={inr(itinerary.estimated_cost)}
        sub={`within ${inr(itinerary.preferences.budget.min)}–${inr(itinerary.preferences.budget.max)}`}
      />
      <Stat
        label="Destinations"
        value={String(stats.destinationCount)}
        sub={`${itinerary.days} days`}
      />
      <Stat
        label="Time on the road"
        value={`${roundHours(stats.totalTravelHours)} h`}
        sub={`across ${itinerary.days} days`}
      />
      <Stat
        label="Time exploring"
        value={`${roundHours(stats.totalActivityHours)} h`}
        sub={titleCase(itinerary.preferences.travel_style) + " pace"}
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
      <p className="text-xs uppercase tracking-widest text-[var(--color-ink-500)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black text-[var(--color-ink-900)]">
        {value}
      </p>
      {sub && (
        <p className="mt-1 text-xs text-[var(--color-ink-500)]">{sub}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RouteOverview({ itinerary }: { itinerary: Itinerary }) {
  // Compress consecutive same-city days into a single stop in the ribbon.
  const stops: { name: string; days: number }[] = [];
  for (const day of itinerary.day_plan) {
    const last = stops[stops.length - 1];
    if (last && last.name === day.base_node_name) {
      last.days += 1;
    } else {
      stops.push({ name: day.base_node_name, days: 1 });
    }
  }

  return (
    <div className="mt-10 card p-6">
      <p className="eyebrow">Route</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-3 text-lg font-bold">
        {stops.map((s, i) => (
          <span key={`${s.name}-${i}`} className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--color-sand-100)] px-3 py-1.5">
              <Pin />
              {s.name}
              <span className="text-xs font-semibold text-[var(--color-ink-500)]">
                · {s.days}d
              </span>
            </span>
            {i < stops.length - 1 && (
              <span className="text-[var(--color-brand-600)] text-xl font-black">
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

function Timeline({ itinerary }: { itinerary: Itinerary }) {
  return (
    <div className="mt-12">
      <p className="eyebrow">Day by day</p>
      <h2 className="mt-2 text-2xl md:text-3xl font-black">Your daily plan</h2>

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
            <DayCard day={day} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function DayCard({ day }: { day: ItineraryDay }) {
  return (
    <div className="card p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--color-ink-500)]">
            Day {day.day_index + 1}
          </p>
          <h3 className="mt-1 text-2xl font-black">{day.base_node_name}</h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Badge label="Exploring" value={`${roundHours(day.total_activity_hours)} h`} />
          {day.total_travel_hours > 0 && (
            <Badge
              label="On the road"
              value={`${roundHours(day.total_travel_hours)} h`}
            />
          )}
        </div>
      </div>

      {day.travel && (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-[var(--color-sand-100)] px-4 py-3 text-sm">
          <TransportIcon mode={day.travel.transport_mode} />
          <div>
            <p className="font-bold text-[var(--color-ink-900)]">
              Travel to {day.base_node_name}
            </p>
            <p className="text-[var(--color-ink-500)]">
              {Math.round(day.travel.distance_km)} km ·{" "}
              {roundHours(day.travel.travel_time_hours)} h by{" "}
              {titleCase(day.travel.transport_mode)}
            </p>
          </div>
        </div>
      )}

      {day.activities.length > 0 && (
        <ul className="mt-5 space-y-4">
          {day.activities.map((a, i) => (
            <li
              key={`${a.node_id}-${i}`}
              className="flex gap-4 items-start pt-4 first:pt-0 border-t border-[rgba(26,23,20,0.06)] first:border-t-0"
            >
              <span className="mt-1 grid place-items-center w-9 h-9 rounded-lg bg-[var(--color-sand-100)] text-[var(--color-brand-700)] shrink-0">
                <Compass />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start gap-3">
                  <p className="font-bold text-[var(--color-ink-900)]">
                    {a.name}
                  </p>
                  <span className="text-xs font-mono font-semibold text-[var(--color-ink-500)] whitespace-nowrap">
                    {roundHours(a.duration_hours)} h
                  </span>
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
                        {titleCase(t)}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
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
          Start over with a different pace, budget, or starting city.
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
      className="text-[var(--color-brand-600)]"
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

function inr(n: number): string {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}

function titleCase(s: string): string {
  return s
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
