"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminUser } from "@/lib/auth/admin";
import {
  buildLiteApiRateCacheKey,
  LiteApiHotelDataProvider,
} from "@/lib/providers/hotels/liteApiHotelDataProvider";
import {
  ProviderDisabledError,
  ProviderResponseError,
  ProviderTimeoutError,
} from "@/lib/providers/hotels/providerErrors";
import type {
  HotelOfferSnapshot,
  HotelRateSearchInput,
} from "@/lib/providers/hotels/types";
import {
  getHotelOfferSnapshot,
  saveHotelOfferSnapshot,
} from "@/lib/repositories/hotelOfferSnapshotRepository";
import { listProviderCallLogs } from "@/lib/repositories/providerCallLogRepository";

const RETEST_COOLDOWN_MS = 90_000;
const MAX_RETEST_LIMIT = 100;
const DEFAULT_RETEST_LIMIT = 20;
const ERROR_SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const MAX_STAY_NIGHTS = 30;

export async function retestHotelRateSnapshotAction(
  formData: FormData,
): Promise<void> {
  const requestedSnapshotId = readOptionalString(formData, "snapshot_id");
  let status: "success" | "error" = "success";
  let message = "LiteAPI rate probe completed.";
  let targetSnapshotId = requestedSnapshotId;

  try {
    const result = await rerunHotelRateSnapshot(formData);
    targetSnapshotId = result.saved_snapshot_id;
    message = `Stored refreshed rates for ${result.node_id} (${result.result_count} offers, status: ${result.status}).`;
  } catch (error) {
    status = "error";
    message = toAdminMessage(error);
  }

  revalidatePath("/admin/hotels");
  redirect(
    buildHotelsRedirectUrl({
      status,
      message,
      snapshotId: targetSnapshotId,
    }),
  );
}

async function rerunHotelRateSnapshot(formData: FormData): Promise<{
  saved_snapshot_id: string;
  node_id: string;
  result_count: number;
  status: HotelOfferSnapshot["status"];
}> {
  await requireAdminIdentity();

  const confirmation = readRequiredString(formData, "confirm_retest");
  if (confirmation !== "yes") {
    throw new Error("Tick confirmation before running a provider re-test.");
  }

  const snapshotId = readRequiredString(formData, "snapshot_id");
  const snapshot = await getHotelOfferSnapshot(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot "${snapshotId}" was not found.`);
  }
  if (snapshot.provider !== "liteapi") {
    throw new Error(
      `Snapshot "${snapshotId}" uses unsupported provider "${snapshot.provider}".`,
    );
  }

  const rateInput = toRateSearchInput(snapshot);
  if (rateInput.hotel_ids.length === 0) {
    throw new Error(
      "This snapshot has no hotel ids to probe. Run a fresh city search in LiteAPI test console first.",
    );
  }
  validateRateSearchDates(rateInput);

  await enforceRetestCooldown(snapshot);

  const provider = new LiteApiHotelDataProvider();
  try {
    const refreshed = await provider.searchRates(rateInput);
    const saved = await saveHotelOfferSnapshot(refreshed);
    return {
      saved_snapshot_id: saved.id,
      node_id: saved.node_id,
      result_count: saved.result_count,
      status: saved.status,
    };
  } catch (error) {
    const fallbackSnapshot = buildErrorSnapshot(rateInput, error);
    await saveHotelOfferSnapshot(fallbackSnapshot);
    throw error;
  }
}

async function enforceRetestCooldown(snapshot: HotelOfferSnapshot): Promise<void> {
  const recentLogs = await listProviderCallLogs({
    provider: snapshot.provider,
    limit: 200,
  });
  const now = Date.now();
  const latestMatch = recentLogs.find((entry) => {
    if (entry.endpoint !== "/hotels/rates") return false;
    if (entry.region !== snapshot.region) return false;
    if (entry.node_id !== snapshot.node_id) return false;
    const ageMs = now - entry.created_at;
    return ageMs >= 0 && ageMs < RETEST_COOLDOWN_MS;
  });

  if (latestMatch) {
    const ageSeconds = Math.max(
      1,
      Math.floor((now - latestMatch.created_at) / 1000),
    );
    const waitSeconds = Math.max(
      1,
      Math.ceil((RETEST_COOLDOWN_MS - (now - latestMatch.created_at)) / 1000),
    );
    throw new Error(
      `A LiteAPI rates call for this stay block ran ${ageSeconds}s ago. Wait ${waitSeconds}s before testing again.`,
    );
  }
}

function toRateSearchInput(snapshot: HotelOfferSnapshot): HotelRateSearchInput {
  const hotelIds = Array.from(
    new Set(
      snapshot.hotel_ids
        .map((hotelId) => hotelId.trim())
        .filter((hotelId) => hotelId.length > 0),
    ),
  );
  const occupancies = snapshot.occupancies
    .map((occupancy) => ({
      adults: Math.max(1, Math.trunc(occupancy.adults)),
      children_ages: occupancy.children_ages
        .map((age) => Math.max(0, Math.trunc(age)))
        .sort((left, right) => left - right),
    }))
    .sort((left, right) => {
      if (left.adults !== right.adults) return left.adults - right.adults;
      return left.children_ages.length - right.children_ages.length;
    });

  return {
    region: snapshot.region,
    node_id: snapshot.node_id,
    hotel_ids: hotelIds,
    checkin: snapshot.checkin,
    checkout: snapshot.checkout,
    occupancies:
      occupancies.length > 0 ? occupancies : [{ adults: 1, children_ages: [] }],
    currency: snapshot.currency,
    guest_nationality: snapshot.guest_nationality,
    limit: resolveRetestLimit(snapshot, hotelIds.length),
  };
}

function resolveRetestLimit(
  snapshot: HotelOfferSnapshot,
  hotelCount: number,
): number {
  const baseline = Math.max(
    DEFAULT_RETEST_LIMIT,
    hotelCount,
    snapshot.result_count,
    snapshot.offers.length,
  );
  return Math.max(1, Math.min(Math.trunc(baseline), MAX_RETEST_LIMIT));
}

function validateRateSearchDates(input: HotelRateSearchInput): void {
  const checkin = parseLocalDate(input.checkin);
  const checkout = parseLocalDate(input.checkout);
  if (checkin === null || checkout === null) {
    throw new Error("Stored snapshot has invalid check-in or checkout dates.");
  }
  if (checkout <= checkin) {
    throw new Error("Stored snapshot checkout must be after check-in.");
  }
  if (checkin < currentUtcMidnightMs()) {
    throw new Error(
      "Stored snapshot check-in is in the past. Create a new future-dated probe instead.",
    );
  }
  const nights = Math.round((checkout - checkin) / (24 * 60 * 60 * 1000));
  if (nights > MAX_STAY_NIGHTS) {
    throw new Error(`Stored snapshot stay length exceeds ${MAX_STAY_NIGHTS} nights.`);
  }
}

function buildErrorSnapshot(
  input: HotelRateSearchInput,
  error: unknown,
): HotelOfferSnapshot {
  const fetchedAt = Date.now();
  const cacheKey = buildLiteApiRateCacheKey(input);
  return {
    id: `${cacheKey}_${fetchedAt}`,
    cache_key: cacheKey,
    provider: "liteapi",
    region: input.region,
    node_id: input.node_id,
    hotel_ids: [...input.hotel_ids],
    checkin: input.checkin,
    checkout: input.checkout,
    nights: computeNights(input.checkin, input.checkout),
    currency: input.currency,
    guest_nationality: input.guest_nationality,
    occupancies: input.occupancies,
    offers: [],
    min_total_amount: null,
    min_nightly_amount: null,
    result_count: 0,
    status: "error",
    fetched_at: fetchedAt,
    expires_at: fetchedAt + ERROR_SNAPSHOT_TTL_MS,
    error_code: resolveErrorCode(error),
    error_message: sanitiseErrorMessage(error),
  };
}

function resolveErrorCode(error: unknown): string {
  if (
    error instanceof ProviderDisabledError ||
    error instanceof ProviderTimeoutError ||
    error instanceof ProviderResponseError
  ) {
    return error.code;
  }
  return "liteapi_retest_failed";
}

function sanitiseErrorMessage(error: unknown): string {
  const fallback = "LiteAPI retest failed.";
  if (!(error instanceof Error)) return fallback;
  const collapsed = error.message.replace(/\s+/g, " ").trim();
  if (!collapsed) return fallback;
  if (collapsed.length <= 220) return collapsed;
  return `${collapsed.slice(0, 220)}...`;
}

function computeNights(checkin: string, checkout: string): number {
  const start = parseLocalDate(checkin);
  const end = parseLocalDate(checkout);
  if (start === null || end === null) return 1;
  const nights = Math.round((end - start) / (24 * 60 * 60 * 1000));
  return Math.max(1, nights);
}

function parseLocalDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = Date.UTC(year, month - 1, day);
  const check = new Date(date);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function currentUtcMidnightMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function toAdminMessage(error: unknown): string {
  if (error instanceof ProviderDisabledError) {
    return "LiteAPI is disabled or missing API credentials in server environment.";
  }
  if (error instanceof ProviderTimeoutError) {
    return "LiteAPI timed out while refreshing this stay block.";
  }
  if (error instanceof ProviderResponseError) {
    return sanitiseErrorMessage(error);
  }
  if (error instanceof Error) {
    return sanitiseErrorMessage(error);
  }
  return "LiteAPI retest failed.";
}

function buildHotelsRedirectUrl(args: {
  status: "success" | "error";
  message: string;
  snapshotId?: string;
}): string {
  const search = new URLSearchParams();
  search.set("action_status", args.status);
  search.set("action_message", args.message);
  const hash = args.snapshotId ? `#rate-${args.snapshotId}` : "";
  return `/admin/hotels?${search.toString()}${hash}`;
}

async function requireAdminIdentity(): Promise<string> {
  const auth = await requireAdminUser();
  if (!auth.ok) {
    throw new Error("Admin access required.");
  }
  return auth.user.email ?? auth.user.uid;
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
