/**
 * Render-time scheduler for the daily plan UI, and a pure feasibility
 * check that the itinerary engine reuses to gate placement.
 *
 * The engine deals exclusively in *durations* (`duration_hours`,
 * `travel_time_hours`). For the itinerary timeline we want *clock times*
 * ("9:00 – 11:30 AM") because users read a daily plan to know **when** to
 * be where, not just for how long.
 *
 * This module is a pure helper: given a day's data plus the user's
 * preferred start time, it produces an ordered list of timed blocks
 * (travel, activities, an optional lunch break) with start/end
 * minutes-from-midnight already computed. Buffer time between blocks is
 * absorbed into the cursor and is never rendered as its own row.
 *
 * The engine imports `isDayScheduleFeasible` from here so the placement
 * loop and the rendered timeline always agree on whether a candidate
 * activity fits inside its opening windows and the day's total span.
 */

import type {
  ItineraryActivity,
  ItineraryDay,
  TransportMode,
} from "@/types/domain";

/** Default day start when the user hasn't expressed a preference. */
export const DEFAULT_DAY_START = "09:00";

/**
 * Buffer/meal rules that drive scheduling. Exposed for tests and so the
 * UI layer can reuse the same constants when explaining the schedule
 * (e.g. "we leave 15 min between activities").
 */
export const SCHEDULE_RULES = {
  /** Settle-in time after travel before the first activity. */
  postTravelBufferMin: 15,
  /** Buffer between consecutive activities. */
  betweenActivitiesBufferMin: 15,
  /** Lunch is anchored at the first natural break inside this window. */
  lunchWindow: { startMin: 12 * 60 + 30, endMin: 15 * 60 },
  lunchDurationMin: 60,
} as const;

export type ScheduleBlockKind = "travel" | "activity" | "meal";

interface ScheduleBlockBase {
  kind: ScheduleBlockKind;
  /** Minutes since local midnight when the block starts. */
  startMin: number;
  /** Minutes since local midnight when the block ends. */
  endMin: number;
  /** Convenience: endMin - startMin. */
  durationMin: number;
}

export interface TravelScheduleBlock extends ScheduleBlockBase {
  kind: "travel";
  transportMode: TransportMode;
  distanceKm: number;
  toName: string;
}

export interface ActivityScheduleBlock extends ScheduleBlockBase {
  kind: "activity";
  activity: ItineraryActivity;
}

export interface MealScheduleBlock extends ScheduleBlockBase {
  kind: "meal";
  label: string;
}

export type ScheduleBlock =
  | TravelScheduleBlock
  | ActivityScheduleBlock
  | MealScheduleBlock;

export interface BuildDayScheduleArgs {
  day: ItineraryDay;
  /** "HH:MM" 24-hour. Falls back to DEFAULT_DAY_START on missing/invalid. */
  startTime?: string;
  /**
   * Optional hard cap on the total wall-clock span for the day, measured from
   * `startTime`. The engine passes the travel-style maximum here when checking
   * whether operating hours still leave a feasible plan.
   */
  maxDaySpanHours?: number;
}

export interface DayScheduleResult {
  blocks: ScheduleBlock[];
  isFeasible: boolean;
  unscheduledActivities: ItineraryActivity[];
}

/**
 * Build the chronologically ordered list of blocks for a single day.
 *
 * Algorithm (deliberately simple — easy to reason about, easy to test):
 *
 *   cursor = startMin
 *   if day.travel: push travel block, cursor += travel duration
 *   for each activity i (in given order):
 *     if i > 0 OR day.travel exists:
 *       cursor += inter-block buffer (15 min, 15 min after travel too)
 *     if lunch not yet placed AND cursor is inside the lunch window
 *        AND there's at least one activity left to schedule:
 *       push lunch block, cursor += 60
 *     push activity block, cursor += duration
 *     if lunch not yet placed AND activity ended inside the lunch window:
 *       push lunch block, cursor += 60
 *   if lunch not yet placed AND the active day wrapped before lunch:
 *     push lunch at the start of the lunch window
 *
 * Lunch is intentionally only inserted at *natural breaks* (between
 * activities, right before an activity, or after a multi-activity morning),
 * never mid-activity. If the day starts after the lunch window or has no
 * activities, no lunch is inserted.
 */
export function buildDaySchedule(args: BuildDayScheduleArgs): ScheduleBlock[] {
  return buildDayScheduleResult(args).blocks;
}

export function buildDayScheduleResult({
  day,
  startTime,
  maxDaySpanHours,
}: BuildDayScheduleArgs): DayScheduleResult {
  const blocks: ScheduleBlock[] = [];
  let cursor = parseTimeToMinutes(startTime) ?? parseTimeToMinutes(DEFAULT_DAY_START)!;
  const latestEndMin =
    maxDaySpanHours !== undefined
      ? cursor + hoursToMinutes(maxDaySpanHours)
      : undefined;
  let lunchPlaced = false;
  const unscheduledActivities: ItineraryActivity[] = [];

  if (day.travel) {
    const durationMin = hoursToMinutes(day.travel.travel_time_hours);
    if (durationMin > 0) {
      const endMin = cursor + durationMin;
      blocks.push({
        kind: "travel",
        startMin: cursor,
        endMin,
        durationMin,
        transportMode: day.travel.transport_mode,
        distanceKm: day.travel.distance_km,
        toName: day.base_node_name,
      });
      cursor = endMin;
    }
  }

  const activities = day.activities;
  const hadTravelBlock = blocks.length > 0;
  let activitiesScheduled = 0;

  for (let index = 0; index < activities.length; index++) {
    const activity = activities[index];
    const durationMin = hoursToMinutes(activity.duration_hours);
    if (durationMin <= 0) continue;
    const hasRemainingActivities = activities
      .slice(index + 1)
      .some((candidate) => hoursToMinutes(candidate.duration_hours) > 0);

    let nextCursor = cursor;
    if (activitiesScheduled === 0 && hadTravelBlock) {
      nextCursor += SCHEDULE_RULES.postTravelBufferMin;
    } else if (activitiesScheduled > 0) {
      nextCursor += SCHEDULE_RULES.betweenActivitiesBufferMin;
    }

    let activityStart = resolveActivityStart({
      cursor: nextCursor,
      activity,
      durationMin,
      latestEndMin,
    });
    if (activityStart === null) {
      unscheduledActivities.push(activity);
      continue;
    }

    if (
      !lunchPlaced &&
      activityStart >= SCHEDULE_RULES.lunchWindow.startMin &&
      canPlaceLunchAt(activityStart, latestEndMin)
    ) {
      const afterLunchStart = resolveActivityStart({
        cursor: activityStart + SCHEDULE_RULES.lunchDurationMin,
        activity,
        durationMin,
        latestEndMin,
      });
      if (afterLunchStart !== null) {
        blocks.push(makeLunchBlock(activityStart));
        lunchPlaced = true;
        activityStart = afterLunchStart;
      }
    }

    blocks.push({
      kind: "activity",
      startMin: activityStart,
      endMin: activityStart + durationMin,
      durationMin,
      activity,
    });
    cursor = activityStart + durationMin;
    activitiesScheduled += 1;

    if (
      !lunchPlaced &&
      hasRemainingActivities &&
      canPlaceLunchAt(cursor, latestEndMin)
    ) {
      blocks.push(makeLunchBlock(cursor));
      lunchPlaced = true;
      cursor += SCHEDULE_RULES.lunchDurationMin;
    }
  }

  if (
    !lunchPlaced &&
    activitiesScheduled > 1 &&
    cursor < SCHEDULE_RULES.lunchWindow.startMin &&
    canPlaceLunchAt(SCHEDULE_RULES.lunchWindow.startMin, latestEndMin)
  ) {
    blocks.push(makeLunchBlock(SCHEDULE_RULES.lunchWindow.startMin));
  }

  return {
    blocks,
    isFeasible:
      unscheduledActivities.length === 0 &&
      (latestEndMin === undefined ||
        blocks.every((block) => block.endMin <= latestEndMin)),
    unscheduledActivities,
  };
}

export function isDayScheduleFeasible(args: BuildDayScheduleArgs): boolean {
  return buildDayScheduleResult(args).isFeasible;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Render minutes-since-midnight as a 12-hour clock string. AM/PM is
 * dropped when both ends of a range share the same period — see
 * {@link formatTimeRange}.
 */
export function formatClock(
  totalMinutes: number,
  options: { withPeriod?: boolean } = {},
): string {
  const { withPeriod = true } = options;
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = m.toString().padStart(2, "0");
  return withPeriod ? `${h12}:${mm} ${period}` : `${h12}:${mm}`;
}

/**
 * Render a [startMin, endMin] range in compact form. Same-period ranges
 * (both AM or both PM) only carry the period suffix once at the end:
 * `9:00 – 11:30 AM`. Cross-period ranges spell both: `11:00 AM – 1:30 PM`.
 * Any range that spills past midnight gets a trailing "(+1d)".
 */
export function formatTimeRange(startMin: number, endMin: number): string {
  const sPeriod = periodFor(startMin);
  const ePeriod = periodFor(endMin);
  const overflowsDay = endMin >= 24 * 60;

  const start =
    sPeriod === ePeriod && !overflowsDay
      ? formatClock(startMin, { withPeriod: false })
      : formatClock(startMin);
  const end = formatClock(endMin);
  const tail = overflowsDay ? " (+1d)" : "";
  return `${start} – ${end}${tail}`;
}

/**
 * Render a duration in minutes as a compact human label:
 * `45m`, `2h`, `2h 30m`. Anything < 1 minute renders as `0m`.
 */
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function parseTimeToMinutes(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function resolveActivityStart(args: {
  cursor: number;
  activity: ItineraryActivity;
  durationMin: number;
  latestEndMin?: number;
}): number | null {
  if (args.activity.opening_hours_state === "closed") {
    return null;
  }

  const periodWindows = parseActivityPeriods(args.activity);
  if (periodWindows.length > 0) {
    for (const period of periodWindows) {
      const startMin = Math.max(args.cursor, period.opens);
      const endMin = startMin + args.durationMin;
      if (endMin > period.closes) continue;
      if (args.latestEndMin !== undefined && endMin > args.latestEndMin) continue;
      return startMin;
    }
    return null;
  }

  const openingTime = parseTimeToMinutes(args.activity.opening_time);
  const startMin =
    openingTime === null ? args.cursor : Math.max(args.cursor, openingTime);
  const endMin = startMin + args.durationMin;

  if (args.activity.opening_hours_state !== "unknown") {
    const closingTime = parseTimeToMinutes(args.activity.closing_time);
    if (closingTime !== null && endMin > closingTime) return null;
  }

  if (args.latestEndMin !== undefined && endMin > args.latestEndMin) return null;
  return startMin;
}

function canPlaceLunchAt(startMin: number, latestEndMin?: number): boolean {
  if (startMin < SCHEDULE_RULES.lunchWindow.startMin) return false;
  if (startMin > SCHEDULE_RULES.lunchWindow.endMin) return false;
  const endMin = startMin + SCHEDULE_RULES.lunchDurationMin;
  return latestEndMin === undefined || endMin <= latestEndMin;
}

function makeLunchBlock(startMin: number): MealScheduleBlock {
  return {
    kind: "meal",
    startMin,
    endMin: startMin + SCHEDULE_RULES.lunchDurationMin,
    durationMin: SCHEDULE_RULES.lunchDurationMin,
    label: "Lunch",
  };
}

function parseActivityPeriods(
  activity: ItineraryActivity,
): Array<{ opens: number; closes: number }> {
  if (!Array.isArray(activity.opening_periods)) return [];

  const windows: Array<{ opens: number; closes: number }> = [];
  for (const period of activity.opening_periods) {
    const opens = parseTimeToMinutes(period.opens);
    const closes = parseTimeToMinutes(period.closes);
    if (opens === null || closes === null) continue;
    if (closes <= opens) continue;
    windows.push({ opens, closes });
  }

  windows.sort((left, right) => {
    if (left.opens !== right.opens) return left.opens - right.opens;
    return left.closes - right.closes;
  });
  return windows;
}

function hoursToMinutes(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 60);
}

function periodFor(totalMinutes: number): "AM" | "PM" {
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return wrapped >= 12 * 60 ? "PM" : "AM";
}
