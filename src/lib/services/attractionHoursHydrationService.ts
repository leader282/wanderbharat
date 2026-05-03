import type {
  AttractionOpeningHours,
  DataQualityIssueCode,
  DataQualityIssueSeverity,
  GraphNode,
  OpeningHoursConfidence,
  OpeningHoursWeekday,
  OpeningPeriod,
} from "@/types/domain";
import { OPENING_HOURS_WEEKDAYS } from "@/types/domain";
import {
  buildDataQualityIssueId,
  createIssue,
  type CreateDataQualityIssueInput,
} from "@/lib/repositories/dataQualityRepository";
import {
  createProviderCallLog,
  type CreateProviderCallLogInput,
} from "@/lib/repositories/providerCallLogRepository";
import {
  findAttractionsByGooglePlaceId,
  getNode,
} from "@/lib/repositories/nodeRepository";
import { upsertAttractionOpeningHours } from "@/lib/repositories/attractionHoursRepository";
import {
  fetchPlaceOpeningHoursById,
  type PlaceOpeningHoursDetails,
  type PlaceOpeningHoursPeriod,
  type PlaceOpeningHoursPoint,
} from "@/lib/services/placesService";

const DAY_INDEX = new Map<OpeningHoursWeekday, number>(
  OPENING_HOURS_WEEKDAYS.map((day, index) => [day, index]),
);
const DEFAULT_REGION_TIMEZONE = "Asia/Kolkata";

type HydrationConfidence = Extract<OpeningHoursConfidence, "cached" | "verified">;

export interface HydrateAttractionOpeningHoursInput {
  google_place_id?: string;
  attraction_id?: string;
  confidence?: HydrationConfidence;
  timezone?: string;
  actor?: string;
}

export interface HydrateAttractionOpeningHoursResult {
  attraction_id: string;
  google_place_id: string;
  confidence: OpeningHoursConfidence;
  weekly_periods_count: number;
  closed_days_count: number;
  business_status?: string;
}

export interface HydrateAttractionOpeningHoursDependencies {
  nowMs?: () => number;
  fetchPlaceOpeningHours?: (
    googlePlaceId: string,
  ) => Promise<PlaceOpeningHoursDetails>;
  findAttractionsByPlaceId?: (googlePlaceId: string) => Promise<GraphNode[]>;
  getAttractionById?: (attractionId: string) => Promise<GraphNode | null>;
  upsertOpeningHours?: (records: AttractionOpeningHours[]) => Promise<void>;
  createDataQualityIssue?: (
    issue: CreateDataQualityIssueInput,
  ) => Promise<unknown>;
  createProviderCall?: (input: CreateProviderCallLogInput) => Promise<unknown>;
}

export async function hydrateAttractionOpeningHours(
  input: HydrateAttractionOpeningHoursInput,
  deps: HydrateAttractionOpeningHoursDependencies = {},
): Promise<HydrateAttractionOpeningHoursResult> {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const fetchPlaceOpeningHours =
    deps.fetchPlaceOpeningHours ?? fetchPlaceOpeningHoursById;
  const findAttractionsByPlaceId =
    deps.findAttractionsByPlaceId ?? findAttractionsByGooglePlaceId;
  const getAttractionById = deps.getAttractionById ?? getNode;
  const upsertOpeningHours = deps.upsertOpeningHours ?? upsertAttractionOpeningHours;
  const createDataQualityIssue = deps.createDataQualityIssue ?? createIssue;
  const createProviderCall = deps.createProviderCall ?? createProviderCallLog;

  const defaultConfidence = input.confidence ?? "cached";
  const requestedAttractionId = normaliseString(input.attraction_id);
  const attraction = requestedAttractionId
    ? await resolveAttractionById(requestedAttractionId, getAttractionById)
    : null;
  const googlePlaceId =
    normaliseString(input.google_place_id) ??
    (attraction ? readGooglePlaceId(attraction) : undefined);

  if (!googlePlaceId) {
    await createDataQualityIssue(
      buildDataQualityIssue({
        code: "missing_google_place_id",
        severity: "warning",
        attractionId: requestedAttractionId ?? undefined,
        message:
          requestedAttractionId != null
            ? `Attraction "${requestedAttractionId}" is missing google_place_id, so opening-hours hydration could not run.`
            : "Google place id is required to hydrate attraction opening hours.",
        details: {
          source: "admin_attraction_hours_hydration",
        },
      }),
    );
    throw new Error("google_place_id is required.");
  }

  const targetAttraction =
    attraction ?? (await resolveAttractionByPlaceId(googlePlaceId, findAttractionsByPlaceId));

  const startedAt = nowMs();
  try {
    const details = await fetchPlaceOpeningHours(googlePlaceId);
    const normalised = normaliseOpeningHoursFromGoogle({
      attraction: targetAttraction,
      details,
      fetchedAt: startedAt,
      confidence: defaultConfidence,
      timezone: input.timezone,
    });
    await upsertOpeningHours([normalised]);

    const hasUsableHours =
      normalised.weekly_periods.length > 0 ||
      (normalised.closed_days?.length ?? 0) > 0;
    if (!hasUsableHours) {
      await createDataQualityIssue(
        buildDataQualityIssue({
          code: "missing_opening_hours",
          severity: "warning",
          attractionId: targetAttraction.id,
          message: `Google Places returned no opening-hours schedule for attraction "${targetAttraction.name}".`,
          details: {
            google_place_id: googlePlaceId,
            region: targetAttraction.region,
            business_status: details.business_status ?? null,
            source: "admin_attraction_hours_hydration",
          },
        }),
      );
    }

    await safeCreateProviderCall(createProviderCall, {
      provider: "google_places",
      endpoint: "places.details.opening_hours",
      request_summary: {
        google_place_id: googlePlaceId,
        attraction_id: targetAttraction.id,
        business_status: details.business_status ?? null,
        actor: input.actor ?? null,
      },
      status: hasUsableHours ? "success" : "empty",
      duration_ms: Math.max(0, nowMs() - startedAt),
      result_count: normalised.weekly_periods.length,
      region: targetAttraction.region,
      node_id: targetAttraction.id,
    });

    return {
      attraction_id: targetAttraction.id,
      google_place_id: googlePlaceId,
      confidence: normalised.confidence,
      weekly_periods_count: normalised.weekly_periods.length,
      closed_days_count: normalised.closed_days?.length ?? 0,
      business_status: details.business_status,
    };
  } catch (error) {
    await createDataQualityIssue(
      buildDataQualityIssue({
        code: "missing_opening_hours",
        severity: "critical",
        attractionId: targetAttraction.id,
        message: `Google Places opening-hours hydration failed for attraction "${targetAttraction.name}".`,
        details: {
          google_place_id: googlePlaceId,
          region: targetAttraction.region,
          error: toErrorMessage(error),
          source: "admin_attraction_hours_hydration",
        },
      }),
    );

    await safeCreateProviderCall(createProviderCall, {
      provider: "google_places",
      endpoint: "places.details.opening_hours",
      request_summary: {
        google_place_id: googlePlaceId,
        attraction_id: targetAttraction.id,
        actor: input.actor ?? null,
      },
      status: "error",
      duration_ms: Math.max(0, nowMs() - startedAt),
      result_count: 0,
      error_code: "google_places_error",
      error_message: toErrorMessage(error),
      region: targetAttraction.region,
      node_id: targetAttraction.id,
    });

    throw error;
  }
}

async function resolveAttractionById(
  attractionId: string,
  getAttractionById: (attractionId: string) => Promise<GraphNode | null>,
): Promise<GraphNode> {
  const attraction = await getAttractionById(attractionId);
  if (!attraction || attraction.type !== "attraction") {
    throw new Error(`Attraction "${attractionId}" was not found.`);
  }
  return attraction;
}

async function resolveAttractionByPlaceId(
  googlePlaceId: string,
  findAttractionsByPlaceId: (googlePlaceId: string) => Promise<GraphNode[]>,
): Promise<GraphNode> {
  const matches = (await findAttractionsByPlaceId(googlePlaceId)).filter(
    (node) => node.type === "attraction",
  );
  if (matches.length === 0) {
    throw new Error(
      `No attraction node is linked to google_place_id "${googlePlaceId}".`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `google_place_id "${googlePlaceId}" is linked to multiple attractions; provide attraction_id explicitly.`,
    );
  }
  return matches[0];
}

function normaliseOpeningHoursFromGoogle(args: {
  attraction: GraphNode;
  details: PlaceOpeningHoursDetails;
  fetchedAt: number;
  confidence: HydrationConfidence;
  timezone?: string;
}): AttractionOpeningHours {
  const businessStatus = normaliseBusinessStatus(args.details.business_status);
  const providerClosed = businessStatus.startsWith("CLOSED");

  const weeklyPeriods = providerClosed
    ? []
    : normaliseWeeklyPeriods(args.details.regular_opening_hours_periods);
  const closedDays = providerClosed
    ? [...OPENING_HOURS_WEEKDAYS]
    : deriveClosedDays(weeklyPeriods);
  const confidence: OpeningHoursConfidence =
    weeklyPeriods.length > 0 || (closedDays?.length ?? 0) > 0
      ? args.confidence
      : "unknown";

  return {
    id: args.attraction.id,
    attraction_id: args.attraction.id,
    region: args.attraction.region,
    timezone: resolveTimezone(args.attraction, args.timezone),
    weekly_periods: weeklyPeriods,
    closed_days: closedDays,
    source_type: "google_places",
    confidence,
    fetched_at: args.fetchedAt,
    verified_at: confidence === "verified" ? args.fetchedAt : null,
    updated_at: args.fetchedAt,
  };
}

function normaliseWeeklyPeriods(
  periods: PlaceOpeningHoursPeriod[],
): OpeningPeriod[] {
  const out: OpeningPeriod[] = [];
  for (const period of periods) {
    const openPoint = parsePoint(period.open);
    const closePoint = parsePoint(period.close);
    if (openPoint && !closePoint) {
      return OPENING_HOURS_WEEKDAYS.map((day) => ({
        day,
        opens: "00:00",
        closes: "23:59",
      }));
    }
    if (!openPoint || !closePoint) continue;

    let closeDayIndex = closePoint.dayIndex;
    if (
      closeDayIndex < openPoint.dayIndex ||
      (closeDayIndex === openPoint.dayIndex &&
        closePoint.minutes <= openPoint.minutes)
    ) {
      closeDayIndex += 7;
    }

    for (
      let dayCursor = openPoint.dayIndex;
      dayCursor <= closeDayIndex;
      dayCursor += 1
    ) {
      const day = OPENING_HOURS_WEEKDAYS[dayCursor % 7];
      const startMin =
        dayCursor === openPoint.dayIndex ? openPoint.minutes : 0;
      const endMin = dayCursor === closeDayIndex ? closePoint.minutes : 24 * 60;
      appendPeriod(out, day, startMin, endMin);
    }
  }

  return sortAndDedupePeriods(out);
}

function appendPeriod(
  target: OpeningPeriod[],
  day: OpeningHoursWeekday,
  startMin: number,
  endMin: number,
): void {
  if (endMin <= startMin) return;
  const closesMin = endMin === 24 * 60 ? 23 * 60 + 59 : endMin;
  if (closesMin <= startMin) return;
  target.push({
    day,
    opens: toTimeString(startMin),
    closes: toTimeString(closesMin),
  });
}

function sortAndDedupePeriods(periods: OpeningPeriod[]): OpeningPeriod[] {
  const seen = new Set<string>();
  return periods
    .slice()
    .sort((left, right) => {
      const dayDiff =
        (DAY_INDEX.get(left.day) ?? 0) - (DAY_INDEX.get(right.day) ?? 0);
      if (dayDiff !== 0) return dayDiff;
      if (left.opens !== right.opens) return left.opens.localeCompare(right.opens);
      return left.closes.localeCompare(right.closes);
    })
    .filter((period) => {
      const key = `${period.day}|${period.opens}|${period.closes}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function deriveClosedDays(
  weeklyPeriods: OpeningPeriod[],
): OpeningHoursWeekday[] | undefined {
  if (weeklyPeriods.length === 0) {
    return undefined;
  }

  const openDays = new Set<OpeningHoursWeekday>(weeklyPeriods.map((period) => period.day));
  const closedDays = OPENING_HOURS_WEEKDAYS.filter((day) => !openDays.has(day));
  return closedDays.length > 0 ? closedDays : undefined;
}

function parsePoint(
  point: PlaceOpeningHoursPoint | undefined,
): { dayIndex: number; minutes: number } | null {
  if (!point) return null;
  const day = Number(point.day);
  if (!Number.isInteger(day) || day < 0 || day > 6) return null;
  const hour = Number(point.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const minute = Number.isInteger(point.minute) ? Number(point.minute) : 0;
  if (minute < 0 || minute > 59) return null;
  return {
    dayIndex: day,
    minutes: hour * 60 + minute,
  };
}

function buildDataQualityIssue(args: {
  code: DataQualityIssueCode;
  severity: DataQualityIssueSeverity;
  attractionId?: string;
  message: string;
  details?: Record<string, unknown>;
}): CreateDataQualityIssueInput {
  return {
    id: buildIssueId(args.code, args.attractionId ?? "unknown"),
    entity_type: "attraction",
    entity_id: args.attractionId,
    severity: args.severity,
    code: args.code,
    message: args.message,
    details: args.details,
  };
}

function buildIssueId(code: DataQualityIssueCode, attractionId: string): string {
  return buildDataQualityIssueId(code, "attraction", attractionId);
}

function normaliseString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normaliseBusinessStatus(value: unknown): string {
  return normaliseString(value)?.toUpperCase() ?? "";
}

function toTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

function readGooglePlaceId(attraction: GraphNode): string | undefined {
  return normaliseString(attraction.metadata.google_place_id);
}

function resolveTimezone(attraction: GraphNode, explicit?: string): string {
  return (
    normaliseString(explicit) ??
    normaliseString(attraction.metadata.timezone) ??
    normaliseString(attraction.metadata.region_timezone) ??
    DEFAULT_REGION_TIMEZONE
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function safeCreateProviderCall(
  createProviderCall: (input: CreateProviderCallLogInput) => Promise<unknown>,
  input: CreateProviderCallLogInput,
): Promise<void> {
  try {
    await createProviderCall(input);
  } catch {
    // Logging should not fail hydration writes or issue tracking.
  }
}
