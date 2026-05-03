import {
  type Accommodation,
  type StayAssignment,
} from "@/types/domain";
import {
  formatTravellerParty,
  makeMoneyFormatter,
  titleCaseWords,
} from "@/lib/itinerary/presentation";
import DataStateBadge from "@/components/itinerary/DataStateBadge";

export interface ItineraryStayEntry {
  stay: StayAssignment;
  cityName: string;
  accommodation: Accommodation | null;
}

export interface DayStayContext {
  entry: ItineraryStayEntry;
  /** 1-based index of this night within the stay block. */
  nightNumber: number;
  /** True when this day is the first night of the stay (check-in). */
  isFirstNight: boolean;
}

export default function DayStayBlock({
  context,
  currency = "INR",
}: {
  context: DayStayContext;
  currency?: string;
}) {
  const { entry, nightNumber, isFirstNight } = context;
  const { stay, accommodation, cityName } = entry;
  const formatMoney = makeMoneyFormatter(currency);
  const nightsLabel = `Night ${nightNumber} of ${stay.nights}`;
  const selectedRateOption = resolveSelectedHotelRateOption(stay);
  const confidenceState = normaliseHotelDataState(
    selectedRateOption?.confidence ?? stay.hotelRateStatus ?? "unknown",
  );
  const lastCheckedLabel = formatLastChecked(stay.hotelRateLastCheckedAt);

  if (!isFirstNight) {
    return (
      <div className="mt-5 flex items-center gap-3 rounded-lg bg-[var(--color-sand-50)] border border-[rgba(26,23,20,0.06)] px-4 py-3 text-sm">
        <BedIcon />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[var(--color-ink-900)]">
            {accommodation
              ? `Continuing stay at ${accommodation.name}`
              : selectedRateOption
                ? `Continuing stay at ${selectedRateOption.hotel_name}`
                : `Continuing stay in ${cityName}`}
          </p>
          <p className="text-xs text-[var(--color-ink-500)]">{nightsLabel}</p>
        </div>
      </div>
    );
  }

  if (!accommodation && selectedRateOption) {
    return (
      <div className="mt-5 rounded-xl border border-[var(--hairline)] bg-[var(--color-sand-50)] p-4">
        <div className="flex items-start gap-3">
          <BedIcon />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--color-ink-500)] font-bold">
                  Check in · {nightsLabel}
                </p>
                <p className="mt-1 text-base md:text-lg font-bold tracking-tight text-[var(--color-ink-900)] truncate">
                  {selectedRateOption.hotel_name}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
                  {selectedRateOption.room_name}
                  {selectedRateOption.board_name
                    ? ` · ${selectedRateOption.board_name}`
                    : ""}
                  {selectedRateOption.star_rating
                    ? ` · ★ ${selectedRateOption.star_rating.toFixed(1)}`
                    : ""}
                  {selectedRateOption.distance_from_anchor_km !== null &&
                  selectedRateOption.distance_from_anchor_km !== undefined
                    ? ` · ${selectedRateOption.distance_from_anchor_km.toFixed(1)} km from center`
                    : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-[var(--color-ink-900)]">
                  {stay.nightlyCost !== null ? formatMoney(stay.nightlyCost) : "Rate unavailable"}
                  <span className="text-xs font-normal text-[var(--color-ink-500)]">
                    {" "}
                    / night
                  </span>
                </p>
                <p className="text-xs text-[var(--color-ink-500)]">
                  {stay.totalCost !== null
                    ? `${formatMoney(stay.totalCost)} total`
                    : "Total unavailable"}{" "}
                  · {stay.nights} {stay.nights === 1 ? "night" : "nights"}
                </p>
              </div>
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
            {stay.hotelRateOptions && stay.hotelRateOptions.length > 1 && (
              <div className="mt-3 rounded-xl border border-[rgba(26,23,20,0.08)] bg-white px-3.5 py-3">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
                  Top rate options
                </p>
                <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-ink-700)]">
                  {stay.hotelRateOptions.slice(0, 5).map((option) => (
                    <li
                      key={`${option.provider_hotel_id}:${option.room_type_id}`}
                      className="flex items-start justify-between gap-3"
                    >
                      <span className="truncate">
                        {option.hotel_name} · {option.room_name}
                      </span>
                      <span className="font-semibold whitespace-nowrap">
                        {option.nightly_amount !== null
                          ? `${formatMoney(option.nightly_amount)} / night`
                          : "Price unavailable"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!accommodation) {
    return (
      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">No stay assigned in {cityName}</p>
        <p className="mt-1">
          We kept this stay unassigned so the itinerary still remains valid even
          without an accommodation match.
        </p>
        <p className="mt-2 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span>Rate status</span>
            <DataStateBadge state={confidenceState} size="xs" />
            {lastCheckedLabel ? <span>· Last checked {lastCheckedLabel}</span> : null}
          </span>
        </p>
        <p className="mt-1 text-xs">Prices may change. Booking disabled in prototype.</p>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-[var(--hairline)] bg-[var(--color-sand-50)] p-4">
      <div className="flex items-start gap-3">
        <BedIcon />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--color-ink-500)] font-bold">
                Check in · {nightsLabel}
              </p>
              <p className="mt-1 text-base md:text-lg font-bold tracking-tight text-[var(--color-ink-900)] truncate">
                {accommodation.name}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
                {titleCaseWords(accommodation.category)} · ★{" "}
                {accommodation.rating.toFixed(1)} (
                {accommodation.reviewCount.toLocaleString("en-IN")} reviews) ·{" "}
                {accommodation.distanceFromCenterKm.toFixed(1)} km from center
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-bold text-[var(--color-ink-900)]">
                {stay.nightlyCost !== null
                  ? formatMoney(stay.nightlyCost)
                  : "Rate unavailable"}
                <span className="text-xs font-normal text-[var(--color-ink-500)]">
                  {" "}
                  / night
                </span>
              </p>
              <p className="text-xs text-[var(--color-ink-500)]">
                {stay.totalCost !== null
                  ? `${formatMoney(stay.totalCost)} total`
                  : "Total unavailable"}{" "}
                · {stay.nights}{" "}
                {stay.nights === 1 ? "night" : "nights"}
              </p>
            </div>
          </div>

          {accommodation.amenities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {accommodation.amenities.slice(0, 6).map((amenity) => (
                <span
                  key={amenity}
                  className="text-[0.68rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white border border-[rgba(26,23,20,0.08)] text-[var(--color-ink-500)]"
                >
                  {titleCaseWords(amenity)}
                </span>
              ))}
            </div>
          )}

          {(accommodation.breakfastIncluded ||
            accommodation.familyFriendly ||
            accommodation.coupleFriendly) && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {accommodation.breakfastIncluded && (
                <Pill>Breakfast included</Pill>
              )}
              {accommodation.familyFriendly && <Pill>Family friendly</Pill>}
              {accommodation.coupleFriendly && <Pill>Couple friendly</Pill>}
            </div>
          )}

          {stay.roomAllocation && stay.roomAllocation.rooms.length > 0 && (
            <div className="mt-3 rounded-xl border border-[rgba(26,23,20,0.08)] bg-white px-3.5 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
                Room allocation · {stay.roomAllocation.totalRooms}{" "}
                {stay.roomAllocation.totalRooms === 1 ? "room" : "rooms"} for{" "}
                {formatParty(stay.roomAllocation)}
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-ink-700)]">
                {stay.roomAllocation.rooms.map((room) => (
                  <li
                    key={room.roomTypeId}
                    className="flex items-start justify-between gap-3"
                  >
                    <span>
                      {room.roomCount} x {room.roomTypeName}
                    </span>
                    <span className="font-semibold whitespace-nowrap">
                      {formatMoney(room.nightlyCost)} / night
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--hairline)] bg-white px-2.5 py-1 font-semibold text-[var(--color-ink-700)]">
      {children}
    </span>
  );
}

function BedIcon() {
  return (
    <span
      aria-hidden
      className="grid place-items-center w-9 h-9 rounded-lg bg-white text-[var(--color-ink-900)] border border-[var(--hairline)] shrink-0"
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 9V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4" />
        <path d="M2 11h20v8" />
        <path d="M2 19v-8" />
        <path d="M22 19H2" />
        <circle cx="9" cy="13.5" r="2" />
        <path d="M13 13h7" />
      </svg>
    </span>
  );
}

function formatParty(
  allocation: NonNullable<StayAssignment["roomAllocation"]>,
): string {
  return formatTravellerParty({
    adults: allocation.adults,
    children: allocation.children,
  });
}

function resolveSelectedHotelRateOption(stay: StayAssignment) {
  const options = stay.hotelRateOptions ?? [];
  if (options.length === 0) return null;
  const preferredIndex = stay.selectedHotelRateOptionIndex ?? 0;
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
