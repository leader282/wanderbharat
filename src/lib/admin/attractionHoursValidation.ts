import type {
  DataSourceType,
  OpeningHoursConfidence,
  OpeningHoursWeekday,
  OpeningPeriod,
} from "@/types/domain";
import { OPENING_HOURS_WEEKDAYS } from "@/types/domain";

/**
 * Confidence values an admin is allowed to set when manually saving a
 * schedule. `live` and `cached` are intentionally excluded — they imply a
 * provider call (Google/LiteAPI) actually happened, and the manual editor
 * cannot honestly produce that signal. The Google hydration action sets
 * those values directly, bypassing this whitelist.
 */
export const MANUAL_HOURS_CONFIDENCE_LEVELS: readonly OpeningHoursConfidence[] = [
  "verified",
  "estimated",
  "unknown",
] as const;

/**
 * Source types an admin is allowed to select for a manual save. `mock`
 * is forbidden by the architecture rule "Never silently show mock values
 * as real". `google_places` and `liteapi` are reserved for the hydration
 * pipelines, and `system` for backfill jobs.
 */
export const MANUAL_HOURS_SOURCE_TYPES: readonly DataSourceType[] = [
  "manual",
  "official_website",
  "estimated",
] as const;

const MANUAL_HOURS_CONFIDENCE_SET = new Set<OpeningHoursConfidence>(
  MANUAL_HOURS_CONFIDENCE_LEVELS,
);
const MANUAL_HOURS_SOURCE_SET = new Set<DataSourceType>(
  MANUAL_HOURS_SOURCE_TYPES,
);

export function isManualHoursConfidence(
  value: string,
): value is OpeningHoursConfidence {
  return MANUAL_HOURS_CONFIDENCE_SET.has(value as OpeningHoursConfidence);
}

export function isManualHoursSourceType(
  value: string,
): value is DataSourceType {
  return MANUAL_HOURS_SOURCE_SET.has(value as DataSourceType);
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_SET = new Set<OpeningHoursWeekday>(OPENING_HOURS_WEEKDAYS);
const DAY_ORDER = new Map<OpeningHoursWeekday, number>(
  OPENING_HOURS_WEEKDAYS.map((day, index) => [day, index]),
);
const PERIOD_LINE_PATTERN =
  /^(sun|mon|tue|wed|thu|fri|sat)\s+([0-2]\d:[0-5]\d)\s*(?:-|to|\s)\s*([0-2]\d:[0-5]\d)$/i;

export function parseWeeklyPeriodsInput(input: string): OpeningPeriod[] {
  const lines = input
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const parsed: OpeningPeriod[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(PERIOD_LINE_PATTERN);
    if (!match) {
      throw new Error(
        `Invalid period at line ${index + 1}. Use "mon 09:00-17:00" format.`,
      );
    }

    const day = match[1].toLowerCase() as OpeningHoursWeekday;
    if (!DAY_SET.has(day)) {
      throw new Error(
        `Invalid weekday "${match[1]}" at line ${index + 1}. Use sun..sat.`,
      );
    }

    const opens = match[2];
    const closes = match[3];
    if (!TIME_PATTERN.test(opens) || !TIME_PATTERN.test(closes)) {
      throw new Error(
        `Invalid time format at line ${index + 1}. Use 24-hour HH:MM.`,
      );
    }
    if (toMinutes(opens) >= toMinutes(closes)) {
      throw new Error(
        `Opening period at line ${index + 1} must have opens < closes.`,
      );
    }

    parsed.push({ day, opens, closes });
  }

  const deduped = dedupePeriods(parsed);
  const sorted = sortPeriods(deduped);
  assertNoOverlaps(sorted);
  return sorted;
}

export function parseClosedDaysInput(values: string[]): OpeningHoursWeekday[] {
  const deduped: OpeningHoursWeekday[] = [];
  const seen = new Set<OpeningHoursWeekday>();

  for (const raw of values) {
    const candidate = raw.trim().toLowerCase() as OpeningHoursWeekday;
    if (!DAY_SET.has(candidate)) {
      throw new Error(`Invalid closed day "${raw}". Use sun..sat values.`);
    }
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    deduped.push(candidate);
  }

  return deduped.sort(
    (left, right) => (DAY_ORDER.get(left) ?? 0) - (DAY_ORDER.get(right) ?? 0),
  );
}

export function formatWeeklyPeriods(periods: OpeningPeriod[]): string {
  if (periods.length === 0) return "";
  return sortPeriods(periods)
    .map((period) => `${period.day} ${period.opens}-${period.closes}`)
    .join("\n");
}

function dedupePeriods(periods: OpeningPeriod[]): OpeningPeriod[] {
  const seen = new Set<string>();
  const out: OpeningPeriod[] = [];
  for (const period of periods) {
    const key = `${period.day}|${period.opens}|${period.closes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(period);
  }
  return out;
}

function sortPeriods(periods: OpeningPeriod[]): OpeningPeriod[] {
  return [...periods].sort((left, right) => {
    const dayDiff = (DAY_ORDER.get(left.day) ?? 0) - (DAY_ORDER.get(right.day) ?? 0);
    if (dayDiff !== 0) return dayDiff;

    const openDiff = toMinutes(left.opens) - toMinutes(right.opens);
    if (openDiff !== 0) return openDiff;

    return toMinutes(left.closes) - toMinutes(right.closes);
  });
}

function assertNoOverlaps(periods: OpeningPeriod[]): void {
  const byDay = new Map<OpeningHoursWeekday, OpeningPeriod[]>();
  for (const period of periods) {
    const list = byDay.get(period.day) ?? [];
    list.push(period);
    byDay.set(period.day, list);
  }

  for (const [day, periodsForDay] of byDay.entries()) {
    const sorted = sortPeriods(periodsForDay);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (toMinutes(current.opens) < toMinutes(previous.closes)) {
        throw new Error(
          `Overlapping periods found for ${day}: ${previous.opens}-${previous.closes} and ${current.opens}-${current.closes}.`,
        );
      }
    }
  }
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}
