"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProgressStop } from "@/lib/itinerary/pageModel";
import { FlagIcon, PinIcon } from "./icons";
import {
  getSafeScrollBehavior,
  ITINERARY_DAY_OBSERVER_ROOT_MARGIN,
  ITINERARY_DAY_SCROLL_MARGIN_PX,
  ITINERARY_OBSERVER_THRESHOLDS,
  lockScrollSpy,
  revealInHorizontalScroller,
} from "./scroll";

/**
 * Horizontal journey strip. Each stop is a button that scrolls to the
 * matching day in the timeline. Highlights the stop whose day-card is
 * currently visible so the ribbon tracks the user's scroll.
 */
export default function TripProgressRibbon({
  stops,
}: {
  stops: ProgressStop[];
}) {
  const dayIndexToStopId = useMemo(() => {
    const map = new Map<number, string>();
    for (const stop of stops) {
      for (const dayIndex of stop.dayIndices) {
        map.set(dayIndex, stop.id);
      }
    }
    return map;
  }, [stops]);
  const observedDayIds = useMemo(
    () =>
      Array.from(new Set(stops.flatMap((stop) => stop.dayIndices))).map(
        (dayIndex) => `day-${dayIndex}`,
      ),
    [stops],
  );
  const observedDayIndices = useMemo(
    () =>
      Array.from(new Set(stops.flatMap((stop) => stop.dayIndices))).sort(
        (left, right) => left - right,
      ),
    [stops],
  );

  const [activeStopId, setActiveStopId] = useState<string | null>(
    () => stops[0]?.id ?? null,
  );
  const nodeRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeStopIdRef = useRef<string | null>(activeStopId);
  const scrollSpyLockUntilRef = useRef(0);

  const updateActiveStopId = useCallback((nextStopId: string) => {
    if (nextStopId === activeStopIdRef.current) return;
    activeStopIdRef.current = nextStopId;
    setActiveStopId(nextStopId);
  }, []);

  useEffect(() => {
    activeStopIdRef.current = activeStopId;
  }, [activeStopId]);

  useEffect(() => {
    const elements = observedDayIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0) return;

    const visible = new Map<number, { top: number; ratio: number }>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const rawIndex = entry.target.getAttribute("data-day-index");
          if (!rawIndex) continue;
          const idx = Number(rawIndex);
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
        const visibleDays = observedDayIndices
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

        const nextStopId = dayIndexToStopId.get(activeDay.dayIndex);
        if (nextStopId) updateActiveStopId(nextStopId);
      },
      {
        rootMargin: ITINERARY_DAY_OBSERVER_ROOT_MARGIN,
        threshold: ITINERARY_OBSERVER_THRESHOLDS,
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [
    dayIndexToStopId,
    observedDayIds,
    observedDayIndices,
    updateActiveStopId,
  ]);

  useEffect(() => {
    if (!activeStopId) return;
    const btn = nodeRefs.current[activeStopId];
    if (!btn) return;
    revealInHorizontalScroller(btn);
  }, [activeStopId]);

  const goToStop = useCallback(
    (stop: ProgressStop) => {
      const dayIndex = stop.dayIndices[0];
      if (dayIndex === undefined) return;
      const target = document.getElementById(`day-${dayIndex}`);
      if (!target) return;
      lockScrollSpy(scrollSpyLockUntilRef);
      updateActiveStopId(stop.id);
      target.scrollIntoView({
        behavior: getSafeScrollBehavior(),
        block: "start",
      });
    },
    [updateActiveStopId],
  );

  if (stops.length === 0) return null;

  return (
    <div
      className="card p-5 md:p-6 reveal-up"
      style={{ ["--reveal-delay" as string]: "96ms" }}
    >
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow">Journey</p>
          <p className="mt-1 font-semibold text-[var(--color-ink-900)]">
            {stops.length} {stops.length === 1 ? "stop" : "stops"} across your
            trip
          </p>
        </div>
        <p className="text-xs text-[var(--color-ink-500)] md:max-w-xs md:text-right">
          Jump to any stop below — we&apos;ll highlight the one you&apos;re
          reading.
        </p>
      </div>

      <div className="relative itinerary-strip-shell itinerary-strip-shell-card">
        <div
          role="list"
          aria-label="Trip progress"
          className="itinerary-horizontal-strip mt-4 flex items-start overflow-x-auto px-1 pb-3 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {stops.map((stop, index) => {
            const active = stop.id === activeStopId;
            const isEndpoint = stop.isStart || stop.isEnd;
            const icon = stop.isStart ? (
              <FlagIcon size={14} />
            ) : stop.isEnd ? (
              <PinIcon size={14} />
            ) : (
              String(stop.order)
            );
            return (
              <div
                key={`${stop.id}-${index}`}
                role="listitem"
                className="flex items-start shrink-0"
              >
                <button
                  ref={(el) => {
                    nodeRefs.current[stop.id] = el;
                  }}
                  type="button"
                  className="progress-node"
                  data-active={active}
                  data-endpoint={isEndpoint}
                  onClick={() => goToStop(stop)}
                  aria-current={active ? "step" : undefined}
                  aria-label={`Jump to ${stop.name}${stop.isStart ? " (start)" : stop.isEnd ? " (end)" : ""}${active ? ", currently in view" : ""}`}
                >
                  <span className="progress-dot" aria-hidden>
                    {icon}
                  </span>
                  <span className="max-w-[7rem] text-center">
                    <span className="block text-[0.82rem] font-semibold text-[var(--color-ink-900)] leading-tight">
                      {stop.name}
                    </span>
                    <span className="mt-0.5 block text-[0.68rem] font-medium uppercase tracking-widest text-[var(--color-ink-500)]">
                      {formatStopMeta(stop)}
                    </span>
                  </span>
                </button>
                {index < stops.length - 1 && (
                  <span aria-hidden className="progress-connector" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatStopMeta(stop: ProgressStop): string {
  const dayCount = stop.dayIndices.length;
  const dayLabel = `${dayCount} ${dayCount === 1 ? "day" : "days"}`;
  if (stop.nights > 0) {
    return `${dayLabel} · ${stop.nights} ${stop.nights === 1 ? "night" : "nights"}`;
  }
  return dayLabel;
}
