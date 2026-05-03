import type { ItineraryStayEntry } from "@/components/DayStayBlock";
import {
  makeMoneyFormatter,
  titleCaseWords,
} from "@/lib/itinerary/presentation";
import DataStateBadge from "@/components/itinerary/DataStateBadge";

import { BedIcon, PinIcon } from "./icons";

/**
 * Stays-at-a-glance panel. Shows each stay block as a compact card
 * alongside total nights, per-night price, and amenities. Complements
 * the in-timeline check-in detail, giving users a single view of where
 * they'll sleep throughout the trip.
 */
export default function StaysOverview({
  entries,
  currency,
}: {
  entries: ItineraryStayEntry[];
  currency: string;
}) {
  if (entries.length === 0) {
    return (
      <div>
        <p className="eyebrow">Stays</p>
        <h2 className="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
          Where you&apos;ll sleep
        </h2>
        <div className="mt-4 rounded-xl border border-dashed border-[var(--hairline-strong)] bg-[var(--color-sand-50)] px-4 py-5 text-sm text-[var(--color-ink-500)]">
          No stays have been assigned for this itinerary yet.
        </div>
      </div>
    );
  }

  const formatMoney = makeMoneyFormatter(currency);
  const totalNights = entries.reduce(
    (sum, entry) => sum + entry.stay.nights,
    0,
  );
  const totalCost = entries.reduce(
    (sum, entry) =>
      entry.stay.totalCost !== null ? sum + entry.stay.totalCost : sum,
    0,
  );
  const unknownRateCount = entries.filter(
    (entry) => entry.stay.totalCost === null,
  ).length;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Stays</p>
          <h2 className="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
            Where you&apos;ll sleep
          </h2>
          <p className="mt-2 max-w-2xl text-[var(--color-ink-500)]">
            {entries.length} {entries.length === 1 ? "stay" : "stays"} ·{" "}
            {totalNights} {totalNights === 1 ? "night" : "nights"} ·{" "}
            {unknownRateCount > 0
              ? totalCost > 0
                ? `known lodging subtotal ${formatMoney(totalCost)}; ${unknownRateCount} ${unknownRateCount === 1 ? "stay has" : "stays have"} unavailable rates`
                : `${unknownRateCount} ${unknownRateCount === 1 ? "stay has" : "stays have"} unavailable rates`
              : `lodging subtotal ${formatMoney(totalCost)}`}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {entries.map((entry, index) => (
          <StayCard
            key={`${entry.stay.nodeId}-${entry.stay.startDay}`}
            entry={entry}
            currency={currency}
            delay={Math.min(index, 3) * 24}
          />
        ))}
      </div>
    </div>
  );
}

function StayCard({
  entry,
  currency,
  delay,
}: {
  entry: ItineraryStayEntry;
  currency: string;
  delay: number;
}) {
  const formatMoney = makeMoneyFormatter(currency);
  const { stay, accommodation, cityName } = entry;
  const selectedRateOption = resolveSelectedHotelRateOption(stay);
  const confidenceState = normaliseHotelDataState(
    selectedRateOption?.confidence ?? stay.hotelRateStatus ?? "unknown",
  );
  const lastCheckedLabel = formatLastChecked(stay.hotelRateLastCheckedAt);
  const dayRangeLabel =
    stay.nights === 1
      ? `Day ${stay.startDay + 1}`
      : `Days ${stay.startDay + 1}–${stay.endDay + 1}`;

  return (
    <article
      className="card p-5 reveal-up transition-shadow duration-200 hover:shadow-[var(--shadow-lift)]"
      style={{ ["--reveal-delay" as string]: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.22em] text-[var(--color-brand-700)]">
            <span className="inline-flex items-center gap-1">
              <PinIcon size={11} />
              {cityName}
            </span>
          </p>
          <h3 className="mt-1.5 text-lg font-bold tracking-tight text-[var(--color-ink-900)] truncate">
            {accommodation
              ? accommodation.name
              : selectedRateOption
                ? selectedRateOption.hotel_name
                : `Stay in ${cityName}`}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
            {accommodation ? (
              <>
                {titleCaseWords(accommodation.category)} · ★
                {accommodation.rating.toFixed(1)} (
                {accommodation.reviewCount.toLocaleString("en-IN")} reviews)
              </>
            ) : selectedRateOption ? (
              <>
                {selectedRateOption.room_name}
                {selectedRateOption.board_name
                  ? ` · ${selectedRateOption.board_name}`
                  : ""}
              </>
            ) : (
              "No specific property matched — your nights here stay flexible"
            )}
          </p>
        </div>

        <span
          className="grid shrink-0 place-items-center rounded-xl bg-[#eef2fb] text-[var(--color-indigo-700)] h-10 w-10 border border-[rgba(61,79,140,0.2)]"
          aria-hidden
        >
          <BedIcon size={18} />
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <Cell label="Nights" value={`${stay.nights}`} />
        <Cell label="When" value={dayRangeLabel} />
        <Cell
          label="Per night"
          value={stay.nightlyCost !== null ? formatMoney(stay.nightlyCost) : "Rate unavailable"}
        />
      </div>

      {accommodation && accommodation.amenities.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {accommodation.amenities.slice(0, 5).map((amenity) => (
            <span
              key={amenity}
              className="text-[0.66rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-sand-50)] border border-[rgba(26,23,20,0.06)] text-[var(--color-ink-500)]"
            >
              {titleCaseWords(amenity)}
            </span>
          ))}
          {accommodation.amenities.length > 5 && (
            <span className="text-[0.66rem] font-semibold text-[var(--color-ink-500)] px-1 py-0.5">
              +{accommodation.amenities.length - 5} more
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-[var(--color-ink-500)]">Subtotal</span>
        <span className="font-bold text-[var(--color-ink-900)]">
          {stay.totalCost !== null ? formatMoney(stay.totalCost) : "Unavailable"}
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--color-ink-500)]">
        <span className="inline-flex items-center gap-1.5">
          <span>Rate status</span>
          <DataStateBadge state={confidenceState} size="xs" />
          {lastCheckedLabel ? <span>· Last checked {lastCheckedLabel}</span> : null}
        </span>
      </p>
      <p className="mt-1 text-xs text-[var(--color-ink-500)]">
        Prices may change. Booking disabled in prototype.
      </p>
      {stay.hotelRateOptions && stay.hotelRateOptions.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-[var(--color-ink-600)]">
          {stay.hotelRateOptions.slice(0, 5).map((option) => (
            <li
              key={`${option.provider_hotel_id}:${option.room_type_id}`}
              className="flex items-center justify-between gap-3"
            >
              <span className="truncate">{option.hotel_name}</span>
              <span className="font-semibold whitespace-nowrap">
                {option.nightly_amount !== null
                  ? `${formatMoney(option.nightly_amount)} / night`
                  : "Price unavailable"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--hairline)] bg-[var(--color-sand-50)] px-3 py-2">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
        {label}
      </p>
      <p className="mt-1 text-sm font-bold tracking-tight text-[var(--color-ink-900)]">
        {value}
      </p>
    </div>
  );
}

function resolveSelectedHotelRateOption(entry: ItineraryStayEntry["stay"]) {
  const options = entry.hotelRateOptions ?? [];
  if (options.length === 0) return null;
  const preferredIndex = entry.selectedHotelRateOptionIndex ?? 0;
  const safeIndex = Math.max(0, Math.min(preferredIndex, options.length - 1));
  return options[safeIndex] ?? null;
}

function formatLastChecked(value: number | null | undefined): string | null {
  if (!Number.isFinite(value) || Number(value) <= 0) return null;
  try {
    return new Date(Number(value)).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return null;
  }
}

function normaliseHotelDataState(
  value: unknown,
): "live" | "verified" | "cached" | "estimated" | "unknown" {
  return value === "live" ||
    value === "verified" ||
    value === "cached" ||
    value === "estimated" ||
    value === "unknown"
    ? value
    : "unknown";
}
