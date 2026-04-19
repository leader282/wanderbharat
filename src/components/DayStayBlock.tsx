import type { Accommodation, StayAssignment } from "@/types/domain";

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

  if (!isFirstNight) {
    return (
      <div className="mt-5 flex items-center gap-3 rounded-lg bg-[var(--color-sand-50)] border border-[rgba(26,23,20,0.06)] px-4 py-3 text-sm">
        <BedIcon />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[var(--color-ink-900)]">
            {accommodation
              ? `Continuing stay at ${accommodation.name}`
              : `Continuing stay in ${cityName}`}
          </p>
          <p className="text-xs text-[var(--color-ink-500)]">{nightsLabel}</p>
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
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl bg-[var(--color-sand-100)] p-4">
      <div className="flex items-start gap-3">
        <BedIcon />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[0.65rem] uppercase tracking-widest text-[var(--color-ink-500)] font-bold">
                Check in · {nightsLabel}
              </p>
              <p className="mt-1 text-base md:text-lg font-black text-[var(--color-ink-900)] truncate">
                {accommodation.name}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
                {titleCase(accommodation.category)} · ★{" "}
                {accommodation.rating.toFixed(1)} (
                {accommodation.reviewCount.toLocaleString("en-IN")} reviews) ·{" "}
                {accommodation.distanceFromCenterKm.toFixed(1)} km from center
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-black text-[var(--color-ink-900)]">
                {formatMoney(stay.nightlyCost)}
                <span className="text-xs font-normal text-[var(--color-ink-500)]">
                  {" "}
                  / night
                </span>
              </p>
              <p className="text-xs text-[var(--color-ink-500)]">
                {formatMoney(stay.totalCost)} total · {stay.nights}{" "}
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
                  {titleCase(amenity)}
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
        </div>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--color-brand-300)]/15 px-2.5 py-1 font-semibold text-[var(--color-brand-700)]">
      {children}
    </span>
  );
}

function BedIcon() {
  return (
    <span
      aria-hidden
      className="grid place-items-center w-9 h-9 rounded-lg bg-white text-[var(--color-brand-700)] border border-[rgba(26,23,20,0.08)] shrink-0"
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

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function makeMoneyFormatter(currency: string) {
  try {
    const nf = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    return (value: number) => nf.format(Math.max(0, Number(value) || 0));
  } catch {
    return (value: number) =>
      `${currency} ${Math.round(Math.max(0, Number(value) || 0)).toLocaleString("en-IN")}`;
  }
}
