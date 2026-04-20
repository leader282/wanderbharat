/**
 * Pure, server-safe helpers that precompute everything the itinerary
 * result page renders. Keeps {@link src/app/itinerary/[id]/page.tsx}
 * focused on orchestration, and lets client components receive already
 * serialisable, ready-to-render props.
 */

import type {
  DayStayContext,
  ItineraryStayEntry,
} from "@/components/DayStayBlock";
import {
  buildDaySchedule,
  type ScheduleBlock,
} from "@/lib/itinerary/daySchedule";
import { getDisplayRouteStops } from "@/lib/itinerary/routeDisplay";
import type {
  Accommodation,
  Itinerary,
  ItineraryDay,
  StayAssignment,
} from "@/types/domain";

/** A single day hydrated with its computed schedule and city context. */
export interface PreparedDay {
  day: ItineraryDay;
  schedule: ScheduleBlock[];
  stayContext: DayStayContext | undefined;
  /** True on the first day at this base city (arrival / check-in day). */
  isArrival: boolean;
  /** 1-based day number within the current city stay (e.g. "2 of 3"). */
  cityStayDayNumber: number;
  /** Total days the itinerary spends at this city. */
  cityStayTotalDays: number;
  /**
   * Display name of the city this day's travel leg departs from. Only
   * populated when `day.travel` is set; used by the timeline to render
   * the leg chip ("Jaipur → Jodhpur · 3h 20m").
   */
  travelFromName?: string;
}

/**
 * A node on the trip progress ribbon. A "stop" is one unbroken run of days
 * at the same base city — revisits produce separate stops.
 */
export interface ProgressStop {
  id: string;
  name: string;
  /** Sequential stop index starting at 1. */
  order: number;
  /** Zero-based day indices the itinerary spends at this stop. */
  dayIndices: number[];
  /** Stays ({@link StayAssignment}) anchored to this stop, if any. */
  nights: number;
  isStart: boolean;
  isEnd: boolean;
}

export interface ItineraryStats {
  totalTravelHours: number;
  totalActivityHours: number;
  destinationCount: number;
  startName: string;
  endName: string;
  travelDays: number;
  stayDays: number;
}

export function prepareDayPlan(args: {
  itinerary: Itinerary;
  stayByDayIndex: Map<number, DayStayContext>;
  startTime: string | undefined;
}): PreparedDay[] {
  const { itinerary, stayByDayIndex, startTime } = args;
  const days = itinerary.day_plan;

  const cityRuns = computeCityRuns(days);

  const nameById = new Map<string, string>();
  for (const day of days) {
    if (day.base_node_id && day.base_node_name) {
      nameById.set(day.base_node_id, day.base_node_name);
    }
  }

  return days.map((day, index) => {
    const run = cityRuns[index] ?? { offset: 0, total: 1 };
    const prev = index > 0 ? days[index - 1] : undefined;
    let travelFromName: string | undefined;
    if (day.travel) {
      travelFromName =
        nameById.get(day.travel.from_node_id) ??
        prev?.base_node_name ??
        undefined;
    }
    return {
      day,
      schedule: buildDaySchedule({ day, startTime }),
      stayContext: stayByDayIndex.get(day.day_index),
      isArrival: run.offset === 0,
      cityStayDayNumber: run.offset + 1,
      cityStayTotalDays: run.total,
      travelFromName,
    };
  });
}

export function buildProgressStops(args: {
  itinerary: Itinerary;
  stays: StayAssignment[];
}): ProgressStop[] {
  const { itinerary, stays } = args;
  const days = itinerary.day_plan;
  const runs = computeCityRunBlocks(days);
  const nameById = new Map<string, string>();
  for (const day of days) {
    if (!day.base_node_id || !day.base_node_name) continue;
    nameById.set(day.base_node_id, day.base_node_name);
  }
  const displayStops = getDisplayRouteStops(itinerary);
  if (displayStops.length > 0) {
    for (const stop of displayStops) {
      if (stop.name) nameById.set(stop.id, stop.name);
    }
  }

  const nightsByNodeFirstDay = new Map<string, number>();
  for (const stay of stays) {
    const key = `${stay.nodeId}:${stay.startDay}`;
    nightsByNodeFirstDay.set(key, stay.nights);
  }

  return runs.map((run, index) => ({
    id: run.id,
    name: nameById.get(run.id) ?? run.id,
    order: index + 1,
    dayIndices: run.dayIndices,
    nights: nightsByNodeFirstDay.get(`${run.id}:${run.dayIndices[0]}`) ?? 0,
    isStart: index === 0,
    isEnd: index === runs.length - 1,
  }));
}

export function buildStayEntries(
  itinerary: Itinerary,
  accommodations: Accommodation[],
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

export function buildStayByDayIndex(
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

export function deriveItineraryStats(itinerary: Itinerary): ItineraryStats {
  const totalTravelHours = itinerary.day_plan.reduce(
    (acc, day) => acc + day.total_travel_hours,
    0,
  );
  const totalActivityHours = itinerary.day_plan.reduce(
    (acc, day) => acc + day.total_activity_hours,
    0,
  );
  const travelDays = itinerary.day_plan.filter((day) =>
    Boolean(day.travel),
  ).length;
  const stayDays = itinerary.day_plan.length - travelDays;

  const displayStops = getDisplayRouteStops(itinerary);
  const destinationCount =
    displayStops.length > 0
      ? new Set(displayStops.map((stop) => stop.id)).size
      : new Set(
          itinerary.day_plan
            .map((day) => day.base_node_id)
            .filter((nodeId) => nodeId.length > 0),
        ).size;
  const firstDay = itinerary.day_plan[0];
  const lastDay = itinerary.day_plan.at(-1);
  const startName = displayStops[0]?.name ?? firstDay?.base_node_name ?? "";
  const endName =
    displayStops.at(-1)?.name ?? lastDay?.base_node_name ?? startName;

  return {
    totalTravelHours,
    totalActivityHours,
    destinationCount,
    startName,
    endName,
    travelDays,
    stayDays,
  };
}

// ---------------------------------------------------------------------------

function computeCityRuns(
  days: ItineraryDay[],
): Array<{ offset: number; total: number }> {
  const runs = computeCityRunBlocks(days);
  const result = Array.from({ length: days.length }, () => ({
    offset: 0,
    total: 1,
  }));
  const arrayIndexByDayIndex = new Map(
    days.map((day, index) => [day.day_index, index]),
  );
  for (const run of runs) {
    run.dayIndices.forEach((dayIndex, offset) => {
      const targetIndex = arrayIndexByDayIndex.get(dayIndex);
      if (targetIndex !== undefined) {
        result[targetIndex] = { offset, total: run.dayIndices.length };
      }
    });
  }
  return result;
}

function computeCityRunBlocks(
  days: ItineraryDay[],
): Array<{ id: string; dayIndices: number[] }> {
  const runs: Array<{ id: string; dayIndices: number[] }> = [];
  for (const day of days) {
    if (!day.base_node_id) continue;
    const last = runs[runs.length - 1];
    if (last && last.id === day.base_node_id) {
      last.dayIndices.push(day.day_index);
    } else {
      runs.push({ id: day.base_node_id, dayIndices: [day.day_index] });
    }
  }
  return runs;
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
