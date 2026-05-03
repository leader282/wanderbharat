import { FieldPath } from "firebase-admin/firestore";

import type {
  AttractionOpeningHours,
  DataSourceType,
  OpeningHoursConfidence,
  OpeningHoursException,
  OpeningHoursWeekday,
  OpeningPeriod,
} from "@/types/domain";
import {
  DATA_SOURCE_TYPES,
  OPENING_HOURS_CONFIDENCE_LEVELS,
  OPENING_HOURS_WEEKDAYS,
} from "@/types/domain";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { chunk } from "@/lib/utils/concurrency";

const CONFIDENCE_SET = new Set<OpeningHoursConfidence>(
  OPENING_HOURS_CONFIDENCE_LEVELS,
);
const SOURCE_SET = new Set<DataSourceType>(DATA_SOURCE_TYPES);
const WEEKDAY_SET = new Set<OpeningHoursWeekday>(OPENING_HOURS_WEEKDAYS);
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_PAGE_SIZE = 500;

export interface FindAttractionOpeningHoursQuery {
  region?: string;
  regions?: string[];
  limit?: number;
  pageSize?: number;
}

function db() {
  return getAdminDb();
}

function baseQuery(
  query: FindAttractionOpeningHoursQuery,
): FirebaseFirestore.Query {
  let firestoreQuery: FirebaseFirestore.Query = db().collection(
    COLLECTIONS.attraction_hours,
  );

  const regions =
    query.regions && query.regions.length > 0
      ? query.regions
      : query.region
        ? [query.region]
        : [];

  if (regions.length === 1) {
    firestoreQuery = firestoreQuery.where("region", "==", regions[0]);
  } else if (regions.length > 1) {
    firestoreQuery = firestoreQuery.where("region", "in", regions.slice(0, 10));
  }

  return firestoreQuery;
}

export async function* streamAttractionOpeningHours(
  query: FindAttractionOpeningHoursQuery = {},
): AsyncGenerator<AttractionOpeningHours, void, void> {
  const pageSize = Math.max(
    1,
    Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, 1_000),
  );
  const hardCap = query.limit ?? Number.POSITIVE_INFINITY;
  let emitted = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (emitted < hardCap) {
    let paged = baseQuery(query).orderBy(FieldPath.documentId()).limit(pageSize);
    if (last) paged = paged.startAfter(last.id);
    const snap = await paged.get();
    if (snap.empty) return;

    for (const doc of snap.docs) {
      if (emitted >= hardCap) return;
      yield normaliseAttractionOpeningHours(
        doc.id,
        doc.data() as Partial<AttractionOpeningHours>,
      );
      emitted += 1;
    }

    if (snap.docs.length < pageSize) return;
    last = snap.docs[snap.docs.length - 1];
  }
}

export async function findAttractionOpeningHours(
  query: FindAttractionOpeningHoursQuery = {},
): Promise<AttractionOpeningHours[]> {
  const out: AttractionOpeningHours[] = [];
  for await (const entry of streamAttractionOpeningHours(query)) {
    out.push(entry);
  }
  return sortByAttractionId(out);
}

export async function getAttractionOpeningHours(
  attractionId: string,
): Promise<AttractionOpeningHours | null> {
  const id = attractionId.trim();
  if (!id) return null;
  const snap = await db().collection(COLLECTIONS.attraction_hours).doc(id).get();
  if (!snap.exists) return null;
  return normaliseAttractionOpeningHours(
    snap.id,
    snap.data() as Partial<AttractionOpeningHours>,
  );
}

export async function getAttractionOpeningHoursByAttractionIds(
  attractionIds: string[],
): Promise<AttractionOpeningHours[]> {
  const ids = attractionIds.map((id) => id.trim()).filter((id) => id.length > 0);
  if (ids.length === 0) return [];

  const out: AttractionOpeningHours[] = [];
  for (const ids10 of chunk(Array.from(new Set(ids)), 10)) {
    const snap = await db()
      .collection(COLLECTIONS.attraction_hours)
      .where(FieldPath.documentId(), "in", ids10)
      .get();
    for (const doc of snap.docs) {
      out.push(
        normaliseAttractionOpeningHours(
          doc.id,
          doc.data() as Partial<AttractionOpeningHours>,
        ),
      );
    }
  }
  return sortByAttractionId(out);
}

export async function upsertAttractionOpeningHours(
  records: AttractionOpeningHours[],
): Promise<void> {
  if (records.length === 0) return;

  const batchSize = 400;
  await withFirestoreDiagnostics("upsertAttractionOpeningHours", async () => {
    for (const slice of chunk(records, batchSize)) {
      const batch = db().batch();
      for (const record of slice) {
        const id = record.attraction_id.trim();
        if (!id) continue;
        batch.set(
          db().collection(COLLECTIONS.attraction_hours).doc(id),
          stripUndefinedDeep({
            ...record,
            id,
            attraction_id: id,
          }),
          { merge: true },
        );
      }
      await batch.commit();
    }
  });
}

function normaliseAttractionOpeningHours(
  docId: string,
  raw: Partial<AttractionOpeningHours>,
): AttractionOpeningHours {
  const attractionId = normaliseString(raw.attraction_id) ?? docId;
  const weeklyPeriods = Array.isArray(raw.weekly_periods)
    ? raw.weekly_periods
        .map((period) => normaliseOpeningPeriod(period))
        .filter((period): period is OpeningPeriod => Boolean(period))
    : [];
  const closedDays = Array.isArray(raw.closed_days)
    ? raw.closed_days
        .map((day) => normaliseWeekday(day))
        .filter((day): day is OpeningHoursWeekday => Boolean(day))
    : [];
  const exceptions = Array.isArray(raw.exceptions)
    ? raw.exceptions
        .map((entry) => normaliseException(entry))
        .filter((entry): entry is OpeningHoursException => Boolean(entry))
    : undefined;
  const sourceType = SOURCE_SET.has(raw.source_type as DataSourceType)
    ? (raw.source_type as DataSourceType)
    : "system";
  const confidence = CONFIDENCE_SET.has(raw.confidence as OpeningHoursConfidence)
    ? (raw.confidence as OpeningHoursConfidence)
    : weeklyPeriods.length > 0 || closedDays.length > 0
      ? "estimated"
      : "unknown";

  return {
    id: attractionId,
    attraction_id: attractionId,
    region: normaliseString(raw.region) ?? "",
    timezone: normaliseNullableString(raw.timezone),
    weekly_periods: sortOpeningPeriods(weeklyPeriods),
    closed_days: dedupeWeekdays(closedDays),
    exceptions: exceptions && exceptions.length > 0 ? exceptions : undefined,
    source_type: sourceType,
    confidence,
    fetched_at: normaliseNullableNumber(raw.fetched_at),
    verified_at: normaliseNullableNumber(raw.verified_at),
    updated_at: normaliseOptionalNumber(raw.updated_at),
  };
}

function normaliseOpeningPeriod(value: unknown): OpeningPeriod | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<OpeningPeriod>;
  const day = normaliseWeekday(candidate.day);
  const opens = normaliseTimeString(candidate.opens);
  const closes = normaliseTimeString(candidate.closes);
  if (!day || !opens || !closes) return null;
  if (toMinutes(opens) >= toMinutes(closes)) return null;
  return { day, opens, closes };
}

function normaliseException(value: unknown): OpeningHoursException | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<OpeningHoursException>;
  const date = normaliseString(candidate.date);
  if (!date) return null;
  const opens = normaliseTimeString(candidate.opens);
  const closes = normaliseTimeString(candidate.closes);
  return {
    date,
    closed:
      typeof candidate.closed === "boolean" ? candidate.closed : undefined,
    opens: opens ?? undefined,
    closes: closes ?? undefined,
  };
}

function sortOpeningPeriods(periods: OpeningPeriod[]): OpeningPeriod[] {
  const dayIndex = new Map<OpeningHoursWeekday, number>(
    OPENING_HOURS_WEEKDAYS.map((day, index) => [day, index]),
  );
  return [...periods].sort((left, right) => {
    const dayDiff = (dayIndex.get(left.day) ?? 0) - (dayIndex.get(right.day) ?? 0);
    if (dayDiff !== 0) return dayDiff;
    const openDiff = toMinutes(left.opens) - toMinutes(right.opens);
    if (openDiff !== 0) return openDiff;
    const closeDiff = toMinutes(left.closes) - toMinutes(right.closes);
    if (closeDiff !== 0) return closeDiff;
    return 0;
  });
}

function dedupeWeekdays(days: OpeningHoursWeekday[]): OpeningHoursWeekday[] {
  const seen = new Set<OpeningHoursWeekday>();
  const out: OpeningHoursWeekday[] = [];
  for (const day of days) {
    if (seen.has(day)) continue;
    seen.add(day);
    out.push(day);
  }
  return out;
}

function sortByAttractionId(
  records: AttractionOpeningHours[],
): AttractionOpeningHours[] {
  return [...records].sort((left, right) =>
    left.attraction_id.localeCompare(right.attraction_id),
  );
}

function normaliseString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normaliseNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return normaliseString(value);
}

function normaliseOptionalNumber(value: unknown): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Number(value);
}

function normaliseNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return normaliseOptionalNumber(value);
}

function normaliseWeekday(value: unknown): OpeningHoursWeekday | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase() as OpeningHoursWeekday;
  return WEEKDAY_SET.has(candidate) ? candidate : null;
}

function normaliseTimeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return TIME_PATTERN.test(trimmed) ? trimmed : null;
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => entry !== undefined) as T;
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      const cleaned = stripUndefinedDeep(nested);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out as T;
  }

  return value;
}
