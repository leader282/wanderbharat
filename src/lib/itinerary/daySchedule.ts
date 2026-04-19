/**
 * Render-time scheduler for the daily plan UI.
 *
 * The engine deals exclusively in *durations* (`duration_hours`,
 * `travel_time_hours`). For the itinerary timeline we want *clock times*
 * ("9:00 – 11:30 AM") because users read a daily plan to know **when** to
 * be where, not just for how long.
 *
 * This module is a pure presentation helper: given a day's data plus the
 * user's preferred start time, it produces an ordered list of timed
 * blocks (travel, activities, an optional lunch break) with start/end
 * minutes-from-midnight already computed. Buffer time between blocks is
 * absorbed into the cursor and is never rendered as its own row.
 *
 * Engine code does not import from this file.
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
  lunchWindow: { startMin: 12 * 60 + 30, endMin: 14 * 60 + 30 },
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
 *
 * Lunch is intentionally only inserted at *natural breaks* (between
 * activities or right before the first one), never mid-activity. If the
 * day starts after the lunch window or has no activities, no lunch is
 * inserted.
 */
export function buildDaySchedule({
  day,
  startTime,
}: BuildDayScheduleArgs): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = [];
  let cursor = parseTimeToMinutes(startTime) ?? parseTimeToMinutes(DEFAULT_DAY_START)!;
  let lunchPlaced = false;

  if (day.travel) {
    const durationMin = hoursToMinutes(day.travel.travel_time_hours);
    if (durationMin > 0) {
      blocks.push({
        kind: "travel",
        startMin: cursor,
        endMin: cursor + durationMin,
        durationMin,
        transportMode: day.travel.transport_mode,
        distanceKm: day.travel.distance_km,
        toName: day.base_node_name,
      });
      cursor += durationMin;
    }
  }

  const activities = day.activities;
  const hadTravelBlock = blocks.length > 0;
  let activitiesScheduled = 0;

  for (const activity of activities) {
    const durationMin = hoursToMinutes(activity.duration_hours);
    if (durationMin <= 0) continue;

    if (activitiesScheduled === 0 && hadTravelBlock) {
      cursor += SCHEDULE_RULES.postTravelBufferMin;
    } else if (activitiesScheduled > 0) {
      cursor += SCHEDULE_RULES.betweenActivitiesBufferMin;
    }

    if (
      !lunchPlaced &&
      cursor >= SCHEDULE_RULES.lunchWindow.startMin &&
      cursor <= SCHEDULE_RULES.lunchWindow.endMin
    ) {
      blocks.push({
        kind: "meal",
        startMin: cursor,
        endMin: cursor + SCHEDULE_RULES.lunchDurationMin,
        durationMin: SCHEDULE_RULES.lunchDurationMin,
        label: "Lunch",
      });
      cursor += SCHEDULE_RULES.lunchDurationMin;
      lunchPlaced = true;
    }

    blocks.push({
      kind: "activity",
      startMin: cursor,
      endMin: cursor + durationMin,
      durationMin,
      activity,
    });
    cursor += durationMin;
    activitiesScheduled += 1;
  }

  return blocks;
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

function hoursToMinutes(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 60);
}

function periodFor(totalMinutes: number): "AM" | "PM" {
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return wrapped >= 12 * 60 ? "PM" : "AM";
}
