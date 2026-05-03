"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import DayStayBlock from "@/components/DayStayBlock";
import DataStateBadge from "@/components/itinerary/DataStateBadge";
import { formatDuration, formatTimeRange } from "@/lib/itinerary/daySchedule";
import type { ScheduleBlock } from "@/lib/itinerary/daySchedule";
import {
  makeMoneyFormatter,
  formatRoundedHours,
  formatClockTimeLabel,
  titleCaseWords,
} from "@/lib/itinerary/presentation";
import type { PreparedDay } from "@/lib/itinerary/pageModel";
import {
  buildDaySummaryLine,
  buildTravelLegAriaLabel,
  buildTravelLegRouteLabel,
  getInitialOpenDayIndices,
  setAllOpenDayIndices,
  toggleOpenDayIndex,
} from "@/lib/itinerary/timelinePresentation";
import type {
  ItineraryBudgetLineItem,
  TransportMode,
} from "@/types/domain";

import {
  BedIcon,
  ChevronDownIcon,
  CompassIcon,
  ForkIcon,
  TransportIcon,
} from "./icons";
import {
  getSafeScrollBehavior,
  ITINERARY_DAY_OBSERVER_ROOT_MARGIN,
  ITINERARY_DAY_SCROLL_MARGIN_PX,
  ITINERARY_OBSERVER_THRESHOLDS,
  lockScrollSpy,
} from "./scroll";

export default function DayTimeline({
  preparedDays,
  currency,
  startTime,
  attractionLineItems = [],
}: {
  preparedDays: PreparedDay[];
  currency: string;
  startTime: string | undefined;
  attractionLineItems?: ItineraryBudgetLineItem[];
}) {
  const [openIndices, setOpenIndices] = useState<Set<number>>(() =>
    getInitialOpenDayIndices(preparedDays),
  );
  const [activeArrayIndex, setActiveArrayIndex] = useState(0);
  const formatMoney = useMemo(() => makeMoneyFormatter(currency), [currency]);
  const attractionCostLookup = useMemo(
    () => buildAttractionCostLookup(attractionLineItems),
    [attractionLineItems],
  );

  const arrayIdxByDayIndex = useMemo(() => {
    const m = new Map<number, number>();
    preparedDays.forEach((p, i) => m.set(p.day.day_index, i));
    return m;
  }, [preparedDays]);
  const orderedDayIndices = useMemo(
    () => preparedDays.map((prepared) => prepared.day.day_index),
    [preparedDays],
  );
  const activeArrayIndexRef = useRef(activeArrayIndex);
  const scrollSpyLockUntilRef = useRef(0);

  const updateActiveArrayIndex = useCallback((nextIndex: number) => {
    if (nextIndex === activeArrayIndexRef.current) return;
    activeArrayIndexRef.current = nextIndex;
    setActiveArrayIndex(nextIndex);
  }, []);

  useEffect(() => {
    activeArrayIndexRef.current = activeArrayIndex;
  }, [activeArrayIndex]);

  // Scroll-spy: pick the day whose card is most prominently in view.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const visible = new Map<number, { top: number; ratio: number }>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const raw = (entry.target as HTMLElement).dataset.dayIndex;
          const idx = raw ? Number(raw) : Number.NaN;
          if (Number.isNaN(idx)) continue;
          if (entry.isIntersecting) {
            visible.set(idx, {
              top: entry.boundingClientRect.top,
              ratio: entry.intersectionRatio,
            });
          } else {
            visible.delete(idx);
          }
        }
        if (visible.size === 0) return;
        if (performance.now() < scrollSpyLockUntilRef.current) return;

        const activationLine = ITINERARY_DAY_SCROLL_MARGIN_PX + 8;
        const visibleDays = orderedDayIndices
          .map((dayIndex) => {
            const entry = visible.get(dayIndex);
            return entry ? { dayIndex, ...entry } : null;
          })
          .filter(
            (
              entry,
            ): entry is { dayIndex: number; top: number; ratio: number } =>
              Boolean(entry),
          );
        if (visibleDays.length === 0) return;

        const activeDay =
          visibleDays.filter((entry) => entry.top <= activationLine).at(-1) ??
          [...visibleDays].sort((left, right) => {
            const topDistance =
              Math.abs(left.top - activationLine) -
              Math.abs(right.top - activationLine);
            if (topDistance !== 0) return topDistance;
            return right.ratio - left.ratio;
          })[0];
        if (!activeDay) return;

        const arrayIdx = arrayIdxByDayIndex.get(activeDay.dayIndex);
        if (arrayIdx !== undefined) {
          updateActiveArrayIndex(arrayIdx);
        }
      },
      {
        // Bias observer toward the upper-middle of the viewport so the
        // active day matches what the reader is focusing on, not what is
        // merely visible at the bottom edge.
        rootMargin: ITINERARY_DAY_OBSERVER_ROOT_MARGIN,
        threshold: ITINERARY_OBSERVER_THRESHOLDS,
      },
    );
    for (const prepared of preparedDays) {
      const el = document.getElementById(`day-${prepared.day.day_index}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [
    preparedDays,
    arrayIdxByDayIndex,
    orderedDayIndices,
    updateActiveArrayIndex,
  ]);

  const allOpen =
    openIndices.size === preparedDays.length && preparedDays.length > 0;

  function toggle(dayIndex: number) {
    const wasOpen = openIndices.has(dayIndex);
    const arrayIdx = arrayIdxByDayIndex.get(dayIndex);
    if (arrayIdx !== undefined) {
      updateActiveArrayIndex(arrayIdx);
    }
    setOpenIndices((prev) => toggleOpenDayIndex(prev, dayIndex));
    // When opening, gently nudge the card into a comfortable viewing spot.
    // We scroll based on the <li> element's current top, which isn't
    // affected by its own inner height expanding, so we can do this
    // synchronously on the next animation frame without waiting for React
    // to commit.
    if (!wasOpen && typeof window !== "undefined") {
      lockScrollSpy(scrollSpyLockUntilRef);
      requestAnimationFrame(() => {
        const el = document.getElementById(`day-${dayIndex}`);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const needsScroll =
          rect.top < ITINERARY_DAY_SCROLL_MARGIN_PX - 16 ||
          rect.top > window.innerHeight * 0.55;
        if (needsScroll) {
          el.scrollIntoView({
            behavior: getSafeScrollBehavior(),
            block: "start",
          });
        }
      });
    }
  }

  function setAll(open: boolean) {
    setOpenIndices(setAllOpenDayIndices(preparedDays, open));
  }

  const startLabel = formatClockTimeLabel(startTime);
  if (preparedDays.length === 0) {
    return (
      <div>
        <p className="eyebrow">Day by day</p>
        <h2 className="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
          Your complete daily plan
        </h2>
        <div className="mt-4 rounded-xl border border-dashed border-[var(--hairline-strong)] bg-[var(--color-sand-50)] px-4 py-5 text-sm text-[var(--color-ink-500)]">
          This itinerary does not have any scheduled days yet. Regenerate it or
          try another budget to restore the day-by-day plan.
        </div>
      </div>
    );
  }

  const totalDays = preparedDays.length;
  const activeCity =
    preparedDays[activeArrayIndex]?.day.base_node_name ??
    preparedDays[0].day.base_node_name;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Day by day</p>
          <h2 className="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
            Your complete daily plan
          </h2>
          <p className="mt-2 max-w-2xl text-[var(--color-ink-500)]">
            A real clock for every day — travel, things to do, and where
            you&apos;ll sleep, paced out hour by hour. Days start at{" "}
            <span className="font-semibold text-[var(--color-ink-900)]">
              {startLabel}
            </span>
            , with a one-hour lunch window around midday.
          </p>
        </div>

        <div
          className="flex items-center gap-2"
          role="group"
          aria-label="Timeline controls"
        >
          <button
            type="button"
            onClick={() => setAll(!allOpen)}
            className="chip"
            aria-pressed={allOpen}
            aria-label={allOpen ? "Collapse all days" : "Expand all days"}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      {totalDays > 1 && (
        <MiniProgress
          activeIndex={activeArrayIndex}
          total={totalDays}
          city={activeCity}
        />
      )}

      <ol className="mt-6 md:mt-7 relative pl-12 md:pl-14 space-y-5 md:space-y-6">
        {preparedDays.map((prepared, index) => (
          <DayCard
            key={prepared.day.day_index}
            prepared={prepared}
            index={index}
            isLast={index === preparedDays.length - 1}
            open={openIndices.has(prepared.day.day_index)}
            onToggle={() => toggle(prepared.day.day_index)}
            currency={currency}
            formatMoney={formatMoney}
            attractionCostLookup={attractionCostLookup}
          />
        ))}
      </ol>
    </div>
  );
}

function MiniProgress({
  activeIndex,
  total,
  city,
}: {
  activeIndex: number;
  total: number;
  city: string;
}) {
  const pct = Math.min(1, Math.max(0, (activeIndex + 1) / Math.max(1, total)));
  return (
    <div className="sticky top-[120px] z-20 mt-6 md:mt-8">
      <div className="timeline-mini-progress">
        <div className="mini-day">
          Day <strong>{String(activeIndex + 1).padStart(2, "0")}</strong>
          <span className="text-[var(--color-ink-400)]">
            {" "}
            /{String(total).padStart(2, "0")}
          </span>
        </div>
        <span aria-hidden className="h-3.5 w-px bg-[var(--hairline)]" />
        <div className="mini-city" title={city}>
          {city}
        </div>
        <div className="mini-bar" aria-hidden>
          <div
            className="mini-bar-fill"
            style={{ transform: `scaleX(${pct})` }}
          />
        </div>
      </div>
    </div>
  );
}

function DayCard({
  prepared,
  index,
  isLast,
  open,
  onToggle,
  currency,
  formatMoney,
  attractionCostLookup,
}: {
  prepared: PreparedDay;
  index: number;
  isLast: boolean;
  open: boolean;
  onToggle: () => void;
  currency: string;
  formatMoney: (value: number) => string;
  attractionCostLookup: Map<string, ItineraryBudgetLineItem>;
}) {
  const {
    day,
    schedule,
    stayContext,
    isArrival,
    cityStayDayNumber,
    cityStayTotalDays,
    travelFromName,
  } = prepared;
  const activityCount = day.activities.length;
  const hasTravel = Boolean(day.travel);
  const dayNum = String(day.day_index + 1).padStart(2, "0");
  const dayLabel = `Day ${dayNum}`;
  const cityRun =
    cityStayTotalDays > 1
      ? `Day ${cityStayDayNumber} of ${cityStayTotalDays} here`
      : "";
  const shouldReveal = index < 4;
  const revealDelay = shouldReveal ? index * 28 : 0;
  const panelId = `day-${day.day_index}-content`;
  const buttonId = `day-${day.day_index}-button`;
  const dayCardStyle: CSSProperties = {
    scrollMarginTop: `${ITINERARY_DAY_SCROLL_MARGIN_PX}px`,
    ...(shouldReveal
      ? { ["--reveal-delay" as string]: `${revealDelay}ms` }
      : {}),
  };

  return (
    <li
      id={`day-${day.day_index}`}
      data-day-index={day.day_index}
      className={`relative${shouldReveal ? " reveal-up" : ""}`}
      style={dayCardStyle}
    >
      {!isLast && <span className="timeline-rail" aria-hidden />}
      <span
        className="timeline-node"
        data-open={open}
        data-transition={hasTravel || (index === 0 && isArrival)}
        aria-hidden
      >
        <span className="timeline-node-number">{dayNum}</span>
      </span>

      {day.travel && (
        <TravelLegChip
          fromName={travelFromName ?? ""}
          toName={day.base_node_name}
          mode={day.travel.transport_mode}
          travelHours={day.travel.travel_time_hours}
          distanceKm={day.travel.distance_km}
        />
      )}

      <article
        className="card timeline-day-card overflow-hidden transition-shadow duration-200 hover:shadow-[var(--shadow-lift)]"
        data-open={open}
      >
        <button
          id={buttonId}
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="group block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]/35 focus-visible:ring-inset"
        >
          <div className="flex items-start gap-4 p-5 md:p-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[var(--color-ink-500)]">
                  {dayLabel}
                </p>
                {index === 0 && (
                  <span className="rounded-full bg-[var(--color-brand-500)]/10 text-[var(--color-brand-700)] text-[0.62rem] font-bold uppercase tracking-wider px-2 py-0.5">
                    Start
                  </span>
                )}
                {isArrival && cityStayTotalDays > 1 && index !== 0 && (
                  <span className="rounded-full bg-[var(--color-brand-500)]/10 text-[var(--color-brand-700)] text-[0.62rem] font-bold uppercase tracking-wider px-2 py-0.5">
                    Arrival
                  </span>
                )}
                {cityRun && (
                  <span className="text-[0.7rem] text-[var(--color-ink-500)] font-medium">
                    · {cityRun}
                  </span>
                )}
              </div>
              <h3 className="mt-1.5 text-xl md:text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
                {day.base_node_name}
              </h3>
              <p className="mt-1.5 text-sm text-[var(--color-ink-500)]">
                {summaryLine({
                  activityCount,
                  travelHours: day.total_travel_hours,
                  isArrivalDay: isArrival && cityStayTotalDays > 1,
                  hasStay: Boolean(stayContext?.isFirstNight),
                })}
              </p>
              <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
                {activityCount > 0 && (
                  <Badge>
                    <CompassIcon size={12} />
                    {activityCount}{" "}
                    {activityCount === 1 ? "thing to do" : "things to do"}
                  </Badge>
                )}
                {day.total_activity_hours > 0 && (
                  <Badge>
                    {formatRoundedHours(day.total_activity_hours)} h exploring
                  </Badge>
                )}
                {day.total_travel_hours > 0 && (
                  <Badge>
                    <TransportIcon
                      mode={day.travel?.transport_mode ?? "road"}
                      size={12}
                    />
                    {formatRoundedHours(day.total_travel_hours)} h on the road
                  </Badge>
                )}
                {stayContext?.isFirstNight && (
                  <Badge tone="indigo">
                    <BedIcon size={12} />
                    Check-in
                  </Badge>
                )}
              </div>
            </div>
            <span
              aria-hidden
              className={`mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-all duration-200 ${
                open
                  ? "rotate-180 bg-[var(--color-ink-900)] text-white border-[var(--color-ink-900)]"
                  : "bg-white text-[var(--color-ink-700)] border-[var(--hairline)] group-hover:border-[var(--color-ink-700)]"
              }`}
            >
              <ChevronDownIcon size={16} />
            </span>
          </div>
        </button>

        <div
          id={panelId}
          className="collapsible"
          data-open={open}
          aria-labelledby={buttonId}
          aria-hidden={!open}
        >
          <div className="collapsible-inner">
            <div className="px-5 pb-5 md:px-6 md:pb-6">
              <div className="h-px bg-[var(--hairline)]" />
              {schedule.length > 0 ? (
                <ul className="mt-4 space-y-2.5" role="list">
                  {schedule.map((block, i) => (
                    <ScheduleRow
                      key={`${block.kind}-${block.startMin}-${i}`}
                      block={block}
                      dayIndex={day.day_index}
                      formatMoney={formatMoney}
                      attractionCostLookup={attractionCostLookup}
                    />
                  ))}
                </ul>
              ) : (
                <EmptyDayState />
              )}

              {stayContext && (
                <DayStayBlock context={stayContext} currency={currency} />
              )}
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}

function TravelLegChip({
  fromName,
  toName,
  mode,
  travelHours,
  distanceKm,
}: {
  fromName: string;
  toName: string;
  mode: TransportMode;
  travelHours: number;
  distanceKm: number;
}) {
  const km = Math.round(distanceKm);
  const durationLabel = formatDuration(Math.max(0, travelHours) * 60);
  const routeLabel = buildTravelLegRouteLabel(fromName, toName);
  return (
    <div
      className="timeline-travel-leg"
      role="note"
      aria-label={buildTravelLegAriaLabel({
        fromName,
        toName,
        mode,
        travelHours,
        distanceKm,
      })}
    >
      <span className="travel-leg-icon" aria-hidden>
        <TransportIcon mode={mode} size={14} />
      </span>
      <span className="travel-leg-route">{routeLabel}</span>
      <span className="travel-leg-dot" aria-hidden>
        ·
      </span>
      <span>{durationLabel}</span>
      {km > 0 && (
        <>
          <span className="travel-leg-dot" aria-hidden>
            ·
          </span>
          <span>{km} km</span>
        </>
      )}
    </div>
  );
}

function ScheduleRow({
  block,
  dayIndex,
  formatMoney,
  attractionCostLookup,
}: {
  block: ScheduleBlock;
  dayIndex: number;
  formatMoney: (value: number) => string;
  attractionCostLookup: Map<string, ItineraryBudgetLineItem>;
}) {
  const range = formatTimeRange(block.startMin, block.endMin);
  const duration = formatDuration(block.durationMin);

  if (block.kind === "travel") {
    return (
      <BaseRow
        kind="travel"
        icon={<TransportIcon mode={block.transportMode} size={16} />}
        title={`Travel to ${block.toName}`}
        subtitle={`${Math.round(block.distanceKm)} km by ${titleCaseWords(block.transportMode)}`}
        range={range}
        duration={duration}
      />
    );
  }

  if (block.kind === "meal") {
    return (
      <BaseRow
        kind="meal"
        icon={<ForkIcon size={16} />}
        title={`${block.label} break`}
        subtitle="A flexible window to grab a meal nearby."
        range={range}
        duration={duration}
      />
    );
  }

  const activity = block.activity;
  const openingHoursState = activity.opening_hours_state;
  const openingConfidence = normaliseDataState(
    activity.opening_hours_confidence,
  );
  const attractionLineItem = attractionCostLookup.get(
    attractionCostLookupKey(dayIndex, activity.name),
  );
  const admissionState = deriveAdmissionState(attractionLineItem);
  const admissionLabel = attractionLineItem
    ? admissionState === "estimated"
      ? `Entry ~${formatMoney(attractionLineItem.amount)}`
      : `Entry ${formatMoney(attractionLineItem.amount)}`
    : activity.type === "attraction"
      ? "Entry fee unknown"
      : null;
  const showOpeningHoursHint =
    openingHoursState === "unknown" ||
    openingHoursState === "closed" ||
    openingConfidence === "cached" ||
    openingConfidence === "estimated";
  return (
    <BaseRow
      kind="activity"
      icon={<CompassIcon size={16} />}
      title={activity.name}
      subtitle={activity.description}
      tags={activity.tags.slice(0, 4)}
      range={range}
      duration={duration}
      extras={
        (showOpeningHoursHint || admissionLabel !== null) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {openingHoursState === "closed" && (
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-amber-900">
                Closed on this day
              </span>
            )}
            {openingHoursState === "unknown" && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-white px-2 py-0.5 text-[0.68rem] text-[var(--color-ink-600)]">
                Opening hours unknown
                <DataStateBadge state={openingConfidence ?? "unknown"} size="xs" />
              </span>
            )}
            {openingHoursState !== "unknown" &&
              openingHoursState !== "closed" &&
              openingConfidence &&
              openingConfidence !== "verified" &&
              openingConfidence !== "live" && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-white px-2 py-0.5 text-[0.68rem] text-[var(--color-ink-600)]">
                  Opening hours
                  <DataStateBadge state={openingConfidence} size="xs" />
                </span>
              )}
            {admissionLabel !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-white px-2 py-0.5 text-[0.68rem] text-[var(--color-ink-600)]">
                {admissionLabel}
                <DataStateBadge state={admissionState} size="xs" />
              </span>
            )}
          </div>
        )
      }
    />
  );
}

function BaseRow({
  kind,
  icon,
  title,
  subtitle,
  tags,
  extras,
  range,
  duration,
}: {
  kind: "travel" | "activity" | "meal";
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tags?: string[];
  extras?: React.ReactNode;
  range: string;
  duration: string;
}) {
  return (
    <li
      className="segment-row flex items-start gap-3 rounded-xl border border-[var(--hairline)] bg-white p-3.5 md:p-4 transition-colors hover:border-[var(--hairline-strong)]"
      data-kind={kind}
    >
      <span className="segment-chip" data-kind={kind} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="font-bold text-[var(--color-ink-900)]">{title}</p>
          <span className="text-xs font-mono font-semibold text-[var(--color-ink-500)] whitespace-nowrap text-right shrink-0">
            <span className="text-[var(--color-ink-900)]">{range}</span>
            <span className="ml-1.5 opacity-70">· {duration}</span>
          </span>
        </div>
        {subtitle && (
          <p className="mt-1 text-sm text-[var(--color-ink-500)]">{subtitle}</p>
        )}
        {extras}
        {tags && tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="text-[0.68rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-sand-50)] border border-[rgba(26,23,20,0.06)] text-[var(--color-ink-500)]"
              >
                {titleCaseWords(tag)}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function EmptyDayState() {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-[var(--hairline-strong)] bg-[var(--color-sand-50)] px-4 py-5 text-sm text-[var(--color-ink-500)]">
      This is a relaxed day — no fixed activities planned so you can rest,
      explore nearby, or add your own stops.
    </div>
  );
}

function Badge({
  children,
  tone = "ink",
}: {
  children: React.ReactNode;
  tone?: "ink" | "indigo";
}) {
  const toneClass =
    tone === "indigo"
      ? "border-[rgba(61,79,140,0.2)] bg-[#eef2fb] text-[var(--color-indigo-700)]"
      : "border-[var(--hairline)] bg-white text-[var(--color-ink-700)]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${toneClass}`}
    >
      {children}
    </span>
  );
}

function summaryLine(args: {
  activityCount: number;
  travelHours: number;
  isArrivalDay: boolean;
  hasStay: boolean;
}): string {
  return buildDaySummaryLine(args);
}

function buildAttractionCostLookup(
  lineItems: ItineraryBudgetLineItem[],
): Map<string, ItineraryBudgetLineItem> {
  const lookup = new Map<string, ItineraryBudgetLineItem>();
  for (const lineItem of lineItems) {
    if (lineItem.kind !== "attraction") continue;
    const key = attractionCostLookupKey(
      lineItem.day_index,
      attractionNameFromAdmissionLabel(lineItem.label),
    );
    if (!lookup.has(key)) {
      lookup.set(key, lineItem);
    }
  }
  return lookup;
}

function attractionCostLookupKey(dayIndex: number, attractionName: string): string {
  return `${dayIndex}:${normaliseText(attractionName)}`;
}

function attractionNameFromAdmissionLabel(label: string): string {
  return label
    .replace(/\s+admission(?:\s*\(estimated\))?$/i, "")
    .trim();
}

function normaliseText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function deriveAdmissionState(
  lineItem: ItineraryBudgetLineItem | undefined,
): "live" | "verified" | "cached" | "estimated" | "unknown" {
  if (!lineItem) return "unknown";
  const confidence = normaliseDataState(lineItem.provenance?.confidence);
  if (confidence) return confidence;
  return lineItem.label.toLowerCase().includes("estimated")
    ? "estimated"
    : "verified";
}

function normaliseDataState(
  value: unknown,
): "live" | "verified" | "cached" | "estimated" | "unknown" | null {
  return value === "live" ||
    value === "verified" ||
    value === "cached" ||
    value === "estimated" ||
    value === "unknown"
    ? value
    : null;
}
