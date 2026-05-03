"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type {
  AttractionOpeningHours,
  DataSourceType,
  OpeningHoursConfidence,
  OpeningPeriod,
} from "@/types/domain";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  isManualHoursConfidence,
  isManualHoursSourceType,
  MANUAL_HOURS_CONFIDENCE_LEVELS,
  MANUAL_HOURS_SOURCE_TYPES,
  parseClosedDaysInput,
  parseWeeklyPeriodsInput,
} from "@/lib/admin/attractionHoursValidation";
import {
  getAttractionOpeningHours,
  upsertAttractionOpeningHours,
} from "@/lib/repositories/attractionHoursRepository";
import { getNode } from "@/lib/repositories/nodeRepository";
import { hydrateAttractionOpeningHours } from "@/lib/services/attractionHoursHydrationService";

export async function hydrateAttractionHoursAction(formData: FormData): Promise<void> {
  const actor = await requireAdminIdentity();
  const attractionId = readOptionalString(formData, "attraction_id");
  const googlePlaceId = readOptionalString(formData, "google_place_id");
  let redirectStatus: "success" | "empty" | "error" = "success";
  let redirectMessage = "Opening hours hydrated from Google Places.";
  let resolvedAttractionId: string | undefined;

  try {
    const result = await hydrateAttractionOpeningHours({
      attraction_id: attractionId,
      google_place_id: googlePlaceId,
      actor,
    });
    resolvedAttractionId = result.attraction_id;
    if (
      result.weekly_periods_count === 0 &&
      result.closed_days_count === 0
    ) {
      redirectStatus = "empty";
      redirectMessage =
        "Google Places returned no opening-hours schedule; a data quality issue was recorded.";
    } else {
      redirectMessage = `Hydrated ${result.weekly_periods_count} weekly period${result.weekly_periods_count === 1 ? "" : "s"} for ${result.attraction_id}.`;
    }
  } catch (error) {
    redirectStatus = "error";
    redirectMessage = toAdminMessage(error);
  }

  revalidatePath("/admin/attraction-hours");
  revalidatePath("/admin/data-quality");
  redirect(
    buildHoursRedirectUrl({
      params: {
        hydration_status: redirectStatus,
        hydration_message: redirectMessage,
      },
      attractionId: resolvedAttractionId ?? attractionId,
    }),
  );
}

export async function upsertAttractionHoursAction(formData: FormData): Promise<void> {
  await requireAdminIdentity();

  let status: "success" | "error" = "success";
  let message = "Opening-hours schedule saved.";
  const requestedAttractionId = readOptionalString(formData, "attraction_id");

  try {
    const now = Date.now();
    const attractionId = readRequiredString(formData, "attraction_id");
    const attraction = await getAttractionOrThrow(attractionId);

    // Manual saves are restricted to confidence/source values that an admin
    // can honestly produce. `live`/`cached` and provider source types are
    // reserved for the hydration pipelines and rejected here so a manual
    // edit can never claim provider-grade provenance.
    const confidence = readManualConfidence(formData);
    const sourceType = readManualSourceType(formData);
    const timezone = readOptionalString(formData, "timezone") ?? null;
    const weeklyPeriodsText = readOptionalString(formData, "weekly_periods") ?? "";
    const closedDaysRaw = readStringList(formData, "closed_days");

    if (confidence === "unknown") {
      // Refuse to silently drop schedule data when the admin pairs an
      // "unknown" save with concrete periods/closed days. The dedicated
      // "Mark unknown" button is the right path to clear a schedule;
      // surfacing this as an error keeps the admin's intent intact.
      if (weeklyPeriodsText.trim().length > 0 || closedDaysRaw.length > 0) {
        throw new Error(
          "Confidence is 'unknown' but a schedule was provided. Use 'Mark unknown' to clear, or pick verified/estimated to save the schedule.",
        );
      }
    }

    const weeklyPeriods: OpeningPeriod[] =
      confidence === "unknown" ? [] : parseWeeklyPeriodsInput(weeklyPeriodsText);
    const closedDays =
      confidence === "unknown" ? [] : parseClosedDaysInput(closedDaysRaw);

    if (
      confidence !== "unknown" &&
      weeklyPeriods.length === 0 &&
      closedDays.length === 0
    ) {
      throw new Error(
        "Provide weekly periods or closed days. Use 'Mark unknown' when schedule is unavailable.",
      );
    }

    const closedSet = new Set(closedDays);
    const conflict = weeklyPeriods.find((period) => closedSet.has(period.day));
    if (conflict) {
      throw new Error(
        `Day "${conflict.day}" cannot be both open and closed in the same record.`,
      );
    }

    // Mirror the cost-side `computeVerifiedSnapshot` pattern: only refresh
    // verified_at when the schedule actually changed. A re-save with the
    // identical weekly_periods/closed_days/confidence triplet must not
    // bump the verification age — that signal is reserved for "an admin
    // re-checked and reaffirmed this exact schedule".
    const existing = await getAttractionOpeningHours(attraction.id);
    const verifiedAt = computeVerifiedAt({
      existing,
      nextConfidence: confidence,
      nextWeeklyPeriods: weeklyPeriods,
      nextClosedDays: closedDays,
      now,
    });

    await upsertAttractionOpeningHours([
      {
        id: attraction.id,
        attraction_id: attraction.id,
        region: attraction.region,
        timezone,
        weekly_periods: weeklyPeriods,
        closed_days: closedDays.length > 0 ? closedDays : undefined,
        source_type: sourceType,
        confidence,
        fetched_at: now,
        verified_at: verifiedAt,
        updated_at: now,
      },
    ]);
    message = `Saved ${weeklyPeriods.length} period${weeklyPeriods.length === 1 ? "" : "s"} for ${attraction.name}.`;
  } catch (error) {
    status = "error";
    message = toAdminMessage(error);
  }

  revalidatePath("/admin/attraction-hours");
  revalidatePath("/admin/data-quality");
  redirect(
    buildHoursRedirectUrl({
      params: { schedule_status: status, schedule_message: message },
      attractionId: requestedAttractionId,
    }),
  );
}

export async function markAttractionHoursUnknownAction(
  formData: FormData,
): Promise<void> {
  await requireAdminIdentity();

  let status: "success" | "error" = "success";
  let message = "Attraction marked as unknown opening-hours.";
  const requestedAttractionId = readOptionalString(formData, "attraction_id");

  try {
    const now = Date.now();
    const attractionId = readRequiredString(formData, "attraction_id");
    const attraction = await getAttractionOrThrow(attractionId);
    const timezone = readOptionalString(formData, "timezone") ?? null;

    await upsertAttractionOpeningHours([
      {
        id: attraction.id,
        attraction_id: attraction.id,
        region: attraction.region,
        timezone,
        weekly_periods: [],
        closed_days: undefined,
        source_type: "manual",
        confidence: "unknown",
        fetched_at: now,
        verified_at: null,
        updated_at: now,
      },
    ]);
  } catch (error) {
    status = "error";
    message = toAdminMessage(error);
  }

  revalidatePath("/admin/attraction-hours");
  revalidatePath("/admin/data-quality");
  redirect(
    buildHoursRedirectUrl({
      params: { schedule_status: status, schedule_message: message },
      attractionId: requestedAttractionId,
    }),
  );
}

async function requireAdminIdentity(): Promise<string> {
  const auth = await requireAdminUser();
  if (!auth.ok) {
    throw new Error("Admin access required.");
  }
  return auth.user.email ?? auth.user.uid;
}

async function getAttractionOrThrow(attractionId: string) {
  const attraction = await getNode(attractionId);
  if (!attraction || attraction.type !== "attraction") {
    throw new Error(`Attraction "${attractionId}" was not found.`);
  }
  return attraction;
}

function readRequiredString(formData: FormData, key: string): string {
  const value = readOptionalString(formData, key);
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function readOptionalString(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringList(formData: FormData, key: string): string[] {
  const values = formData.getAll(key);
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function readManualConfidence(formData: FormData): OpeningHoursConfidence {
  const value = readOptionalString(formData, "confidence");
  if (!value) return "verified";
  if (!isManualHoursConfidence(value)) {
    throw new Error(
      `Confidence "${value}" is not allowed for manual edits. Choose one of: ${MANUAL_HOURS_CONFIDENCE_LEVELS.join(", ")}.`,
    );
  }
  return value;
}

function readManualSourceType(formData: FormData): DataSourceType {
  const value = readOptionalString(formData, "source_type");
  if (!value) return "manual";
  if (!isManualHoursSourceType(value)) {
    throw new Error(
      `Source type "${value}" is not allowed for manual edits. Choose one of: ${MANUAL_HOURS_SOURCE_TYPES.join(", ")}.`,
    );
  }
  return value;
}

function periodsAreEquivalent(
  left: OpeningPeriod[],
  right: readonly OpeningPeriod[] | undefined,
): boolean {
  if (!right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!b) return false;
    if (a.day !== b.day || a.opens !== b.opens || a.closes !== b.closes) {
      return false;
    }
  }
  return true;
}

function closedDaysAreEquivalent(
  left: readonly string[],
  right: readonly string[] | undefined,
): boolean {
  if (!right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function computeVerifiedAt(args: {
  existing: AttractionOpeningHours | null | undefined;
  nextConfidence: OpeningHoursConfidence;
  nextWeeklyPeriods: OpeningPeriod[];
  nextClosedDays: readonly string[];
  now: number;
}): number | null {
  if (args.nextConfidence !== "verified") {
    return null;
  }
  // Fresh verification when no prior record exists or any field changed.
  const reaffirmation =
    args.existing &&
    args.existing.confidence === "verified" &&
    periodsAreEquivalent(args.nextWeeklyPeriods, args.existing.weekly_periods) &&
    closedDaysAreEquivalent(args.nextClosedDays, args.existing.closed_days ?? []);
  if (!reaffirmation) {
    return args.now;
  }
  return args.existing?.verified_at ?? args.now;
}

function buildHoursRedirectUrl(args: {
  params: Record<string, string>;
  attractionId?: string;
}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(args.params)) {
    search.set(key, value);
  }
  // Anchor the redirect to the just-edited attraction so admins fixing the
  // top-N backlog don't have to scroll the long list back to where they
  // were after every save.
  const hash = args.attractionId ? `#attr-${args.attractionId}` : "";
  return `/admin/attraction-hours?${search.toString()}${hash}`;
}

function toAdminMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Opening-hours action failed.";
  }
  if (error.message.includes("google_place_id is required")) {
    return "This attraction is missing google_place_id; a data quality issue was recorded.";
  }
  if (error.message.includes("linked to multiple attractions")) {
    return error.message;
  }
  if (error.message.includes("No attraction node is linked")) {
    return error.message;
  }
  if (error.message.includes("line")) {
    return error.message;
  }
  return error.message;
}
