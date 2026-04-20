import type { Itinerary } from "@/types/domain";
import {
  formatTravellerParty,
  titleCaseWords,
} from "@/lib/itinerary/presentation";

import type { ItineraryStats } from "@/lib/itinerary/pageModel";
import { CompassIcon, FlagIcon, PinIcon, SparkIcon } from "./icons";

export default function ItineraryHero({
  itinerary,
  stats,
}: {
  itinerary: Itinerary;
  stats: ItineraryStats;
}) {
  const travellerLabel = formatTravellerParty(itinerary.preferences.travellers);
  const regionLabel = titleCaseWords(itinerary.region);
  const isLoop = itinerary.start_node === itinerary.end_node;
  const pace = paceAdjective(itinerary.preferences.travel_style);
  const destinationWord =
    stats.destinationCount === 1 ? "destination" : "destinations";
  const summary = isLoop
    ? `A ${pace} loop out of ${stats.startName}, with ${stats.destinationCount} ${destinationWord} and every day shaped around how you like to travel.`
    : `A ${pace} route from ${stats.startName} to ${stats.endName}, with ${stats.destinationCount} ${destinationWord} and every day shaped around how you like to travel.`;

  return (
    <header
      className="relative mt-6 overflow-hidden rounded-[1.25rem] border border-[var(--hairline)] bg-white px-6 py-8 md:px-10 md:py-12 shadow-[var(--shadow-soft)] animate-fadeUp"
      aria-label={`Trip through ${regionLabel}`}
    >
      <HeroBackdrop />
      <div className="relative">
        <p className="eyebrow">{regionLabel} itinerary</p>
        <h1 className="mt-3 text-[2.25rem] md:text-[3rem] font-bold leading-[1.04] tracking-tight text-[var(--color-ink-900)]">
          Your {itinerary.days}-day trip through{" "}
          <span className="relative inline-block">
            {regionLabel}
            <span
              aria-hidden
              className="absolute left-0 right-0 -bottom-1 h-[3px] rounded-full bg-gradient-to-r from-[var(--color-brand-500)] to-transparent"
            />
          </span>
          .
        </h1>
        <p className="mt-4 max-w-2xl text-base md:text-lg leading-relaxed text-[var(--color-ink-600)]">
          {summary}
        </p>

        <div className="mt-6 flex flex-wrap gap-2.5 text-sm">
          <HeroChip icon={<FlagIcon size={14} />} label={stats.startName} />
          {!isLoop && stats.endName !== stats.startName && (
            <HeroChip
              icon={<PinIcon size={14} />}
              label={`to ${stats.endName}`}
            />
          )}
          <HeroChip
            icon={<CompassIcon size={14} />}
            label={`${itinerary.days} days · ${stats.destinationCount} ${destinationWord}`}
          />
          <HeroChip
            icon={<SparkIcon size={14} />}
            label={`${titleCaseWords(itinerary.preferences.travel_style)} pace`}
          />
          <HeroChip label={travellerLabel} />
        </div>
      </div>
    </header>
  );
}

function HeroChip({
  icon,
  label,
}: {
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-white/90 px-3 py-1.5 font-semibold text-[var(--color-ink-800)] backdrop-blur-sm">
      {icon && (
        <span className="text-[var(--color-brand-700)]" aria-hidden>
          {icon}
        </span>
      )}
      {label}
    </span>
  );
}

function HeroBackdrop() {
  return (
    <div aria-hidden className="absolute inset-0 -z-0">
      <div className="absolute inset-0 bg-[radial-gradient(900px_360px_at_90%_-20%,rgba(15,118,112,0.06),transparent_60%),radial-gradient(700px_280px_at_-10%_0%,rgba(184,136,31,0.09),transparent_60%)]" />
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(closest-side,rgba(184,136,31,0.18),transparent_70%)]" />
      <div className="absolute -left-20 bottom-0 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,rgba(15,118,112,0.10),transparent_70%)]" />
    </div>
  );
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
