import { formatDuration } from "@/lib/itinerary/daySchedule";
import {
  formatRoundedHours,
  titleCaseWords,
} from "@/lib/itinerary/presentation";
import type { PreparedDay } from "@/lib/itinerary/pageModel";
import type { TransportMode } from "@/types/domain";

export function getInitialOpenDayIndices(
  preparedDays: Array<Pick<PreparedDay, "day">>,
): Set<number> {
  const firstDayIndex = preparedDays[0]?.day.day_index;
  return firstDayIndex === undefined ? new Set<number>() : new Set([firstDayIndex]);
}

export function toggleOpenDayIndex(
  openIndices: ReadonlySet<number>,
  dayIndex: number,
): Set<number> {
  const next = new Set(openIndices);
  if (next.has(dayIndex)) next.delete(dayIndex);
  else next.add(dayIndex);
  return next;
}

export function setAllOpenDayIndices(
  preparedDays: Array<Pick<PreparedDay, "day">>,
  open: boolean,
): Set<number> {
  return open
    ? new Set(preparedDays.map((prepared) => prepared.day.day_index))
    : new Set<number>();
}

export function buildDaySummaryLine(args: {
  activityCount: number;
  travelHours: number;
  isArrivalDay: boolean;
  hasStay: boolean;
}): string {
  const segments: string[] = [];
  if (args.travelHours > 0) {
    segments.push(`${formatRoundedHours(args.travelHours)}h travel`);
  }
  if (args.activityCount > 0) {
    segments.push(
      `${args.activityCount} ${args.activityCount === 1 ? "stop" : "stops"}`,
    );
  }
  if (args.isArrivalDay) segments.push("arrival");
  if (args.hasStay) segments.push("check-in");
  if (segments.length === 0) return "A flexible rest day.";
  return segments.join(" · ");
}

export function buildTravelLegRouteLabel(
  fromName: string,
  toName: string,
): string {
  return fromName ? `${fromName} → ${toName}` : `→ ${toName}`;
}

export function buildTravelLegAriaLabel(args: {
  fromName: string;
  toName: string;
  mode: TransportMode;
  travelHours: number;
  distanceKm: number;
}): string {
  const durationLabel = formatDuration(Math.max(0, args.travelHours) * 60);
  const km = Math.round(args.distanceKm);
  const routeLabel = buildTravelLegRouteLabel(args.fromName, args.toName);
  return `Travel leg: ${routeLabel}, ${durationLabel} by ${titleCaseWords(
    args.mode,
  )}${km > 0 ? `, ${km} kilometres` : ""}`;
}
