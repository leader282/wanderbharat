import type { Itinerary } from "@/types/domain";
import {
  formatTravellerParty,
  formatRoundedHours,
  makeMoneyFormatter,
} from "@/lib/itinerary/presentation";

import type { ItineraryStats } from "@/lib/itinerary/pageModel";

export default function TripStatsGrid({
  itinerary,
  stats,
}: {
  itinerary: Itinerary;
  stats: ItineraryStats;
}) {
  const currency = itinerary.preferences.budget.currency ?? "INR";
  const formatMoney = makeMoneyFormatter(currency);
  const travellerLabel = formatTravellerParty(itinerary.preferences.travellers);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Total trip budget"
        value={formatMoney(itinerary.preferences.budget.max)}
        sub={`Estimated ${formatMoney(itinerary.estimated_cost)} total`}
        delay={0}
      />
      <Stat
        label="Travellers"
        value={travellerLabel}
        sub={`${itinerary.days}-day trip`}
        delay={24}
      />
      <Stat
        label="Destinations"
        value={String(stats.destinationCount)}
        sub={`${stats.stayDays} ${stats.stayDays === 1 ? "day" : "days"} exploring · ${stats.travelDays} on the move`}
        delay={48}
      />
      <Stat
        label="Time on the road"
        value={`${formatRoundedHours(stats.totalTravelHours)} h`}
        sub={`${formatRoundedHours(stats.totalActivityHours)} h exploring`}
        delay={72}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  delay,
}: {
  label: string;
  value: string;
  sub?: string;
  delay: number;
}) {
  return (
    <div
      className="card p-5 reveal-up transition-shadow duration-200 hover:shadow-[var(--shadow-lift)]"
      style={{ ["--reveal-delay" as string]: `${delay}ms` }}
    >
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
