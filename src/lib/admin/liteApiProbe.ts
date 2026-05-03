import { createHash } from "node:crypto";

import {
  type LiteApiProviderConfig,
  resolveLiteApiProviderConfig,
} from "@/lib/providers/hotels/liteApiConfig";
import { LiteApiHotelDataProvider } from "@/lib/providers/hotels/liteApiHotelDataProvider";
import {
  ProviderDisabledError,
  ProviderResponseError,
  ProviderTimeoutError,
} from "@/lib/providers/hotels/providerErrors";
import type {
  HotelOfferResult,
  HotelOfferSnapshot,
  HotelRateSearchInput,
  HotelSearchInput,
  HotelSearchResult,
  HotelSearchSnapshot,
  ProviderCallLog,
  ProviderCallStatus,
} from "@/lib/providers/hotels/types";
import {
  createProviderCallLog,
  type CreateProviderCallLogInput,
} from "@/lib/repositories/providerCallLogRepository";
import { saveHotelOfferSnapshot } from "@/lib/repositories/hotelOfferSnapshotRepository";
import { saveHotelSearchSnapshot } from "@/lib/repositories/hotelSearchSnapshotRepository";

const ADMIN_TEST_REGION = "admin_test";
const SEARCH_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const TOP_HOTEL_CARD_LIMIT = 8;

export interface LiteApiProbeInput {
  city_name?: string;
  country_code: string;
  latitude?: number;
  longitude?: number;
  radius_meters: number;
  checkin_date: string;
  checkout_date: string;
  adults: number;
  children_ages: number[];
  rooms: number;
  currency: string;
  guest_nationality: string;
  max_results?: number;
}

export type LiteApiProbeErrorKind =
  | "provider_disabled"
  | "timeout"
  | "provider_failure"
  | "no_results"
  | "internal_error";

export interface LiteApiProbeError {
  kind: LiteApiProbeErrorKind;
  code?: string;
  message: string;
}

export interface LiteApiProbeProviderStatus {
  enabled_flag: boolean;
  api_key_present: boolean;
  available: boolean;
  timeout_ms: number;
  max_results_default: number;
}

export interface LiteApiProbeRequestSummary {
  region: string;
  node_id: string;
  city_name: string | null;
  country_code: string;
  anchor: { lat: number; lng: number } | null;
  radius_meters: number;
  checkin_date: string;
  checkout_date: string;
  adults: number;
  children_ages: number[];
  rooms_requested: number;
  rooms_used_for_rates: number;
  currency: string;
  guest_nationality: string;
  max_results: number;
}

export interface LiteApiProbeHotelCard {
  provider_hotel_id: string;
  name: string;
  address: string | null;
  star_rating: number | null;
  guest_rating: number | null;
  distance_from_anchor_km: number | null;
  cheapest_total_amount: number | null;
  currency: string;
}

/**
 * Per-upstream-call diagnostic surfaced to admin clients. Mirrors a subset of
 * {@link ProviderCallLog} so the test console can render endpoint, status,
 * timing, and error context without requiring Firestore lookups.
 */
export interface LiteApiProbeProviderCallEntry {
  id: string;
  endpoint: string;
  status: ProviderCallStatus;
  duration_ms: number;
  result_count: number;
  error_code: string | null;
  error_message: string | null;
}

export interface LiteApiProbeResult {
  ok: boolean;
  provider_status: LiteApiProbeProviderStatus;
  request_summary: LiteApiProbeRequestSummary;
  response_time_ms: number;
  hotels_count: number;
  rates_count: number;
  cheapest_total_amount: number | null;
  median_total_amount: number | null;
  currency: string;
  provider_call_log_id: string | null;
  provider_call_log_ids: string[];
  provider_calls: LiteApiProbeProviderCallEntry[];
  hotel_search_snapshot_id: string | null;
  hotel_offer_snapshot_id: string | null;
  top_hotels: LiteApiProbeHotelCard[];
  normalized_json: {
    hotels: HotelSearchResult[];
    rates_snapshot: HotelOfferSnapshot | null;
  };
  error?: LiteApiProbeError;
}

interface ProbeProvider {
  searchHotels(input: HotelSearchInput): Promise<HotelSearchResult[]>;
  searchRates(input: HotelRateSearchInput): Promise<HotelOfferSnapshot>;
}

export interface LiteApiProbeDependencies {
  nowMs?: () => number;
  resolveConfig?: () => LiteApiProviderConfig;
  createProviderCallLog?: (
    input: CreateProviderCallLogInput,
  ) => Promise<ProviderCallLog>;
  saveHotelSearchSnapshot?: (
    snapshot: HotelSearchSnapshot,
  ) => Promise<HotelSearchSnapshot>;
  saveHotelOfferSnapshot?: (
    snapshot: HotelOfferSnapshot,
  ) => Promise<HotelOfferSnapshot>;
  providerFactory?: (args: {
    config: LiteApiProviderConfig;
    nowMs: () => number;
    logCall: (
      entry: Omit<ProviderCallLog, "id" | "created_at"> & {
        id?: string;
        created_at?: number;
      },
    ) => Promise<void>;
  }) => ProbeProvider;
}

export async function runLiteApiProbe(
  input: LiteApiProbeInput,
  deps: LiteApiProbeDependencies = {},
): Promise<LiteApiProbeResult> {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const startedAt = nowMs();
  const config = (deps.resolveConfig ?? resolveLiteApiProviderConfig)();
  const maxResults = clampMaxResults(input.max_results, config.maxResults);
  const anchor = toAnchor(input);
  const nodeId = buildAdminNodeId(input);
  const occupancies = buildOccupancies(input.adults, input.children_ages, input.rooms);
  const providerStatus = buildProviderStatus(config);
  const requestSummary: LiteApiProbeRequestSummary = {
    region: ADMIN_TEST_REGION,
    node_id: nodeId,
    city_name: input.city_name ?? null,
    country_code: input.country_code,
    anchor: anchor ?? null,
    radius_meters: input.radius_meters,
    checkin_date: input.checkin_date,
    checkout_date: input.checkout_date,
    adults: input.adults,
    children_ages: [...input.children_ages],
    rooms_requested: input.rooms,
    rooms_used_for_rates: occupancies.length,
    currency: input.currency,
    guest_nationality: input.guest_nationality,
    max_results: maxResults,
  };

  const createProviderCallLogFn =
    deps.createProviderCallLog ?? createProviderCallLog;
  const saveHotelSearchSnapshotFn =
    deps.saveHotelSearchSnapshot ?? saveHotelSearchSnapshot;
  const saveHotelOfferSnapshotFn =
    deps.saveHotelOfferSnapshot ?? saveHotelOfferSnapshot;
  const providerFactory = deps.providerFactory ?? defaultProviderFactory;

  const providerCallLogs: ProviderCallLog[] = [];
  const provider = providerFactory({
    config,
    nowMs,
    logCall: async (entry) => {
      const saved = await createProviderCallLogFn(entry);
      providerCallLogs.push(saved);
    },
  });

  const searchInput: HotelSearchInput = {
    region: ADMIN_TEST_REGION,
    node_id: nodeId,
    city_name: input.city_name,
    country_code: input.country_code,
    anchor,
    radius_km: Number((input.radius_meters / 1000).toFixed(3)),
    limit: maxResults,
  };

  let hotels: HotelSearchResult[] = [];
  let ratesSnapshot: HotelOfferSnapshot | null = null;
  let hotelSearchSnapshotId: string | null = null;
  let hotelOfferSnapshotId: string | null = null;

  try {
    hotels = await provider.searchHotels(searchInput);

    const searchSnapshot = buildSearchSnapshot({
      input: searchInput,
      hotels,
      fetchedAt: nowMs(),
    });
    hotelSearchSnapshotId = (
      await saveHotelSearchSnapshotFn(searchSnapshot)
    ).id;

    if (hotels.length === 0) {
      return buildProbeResult({
        ok: false,
        startedAt,
        nowMs,
        requestSummary,
        providerStatus,
        providerCallLogs,
        hotels,
        ratesSnapshot,
        hotelSearchSnapshotId,
        hotelOfferSnapshotId,
        currency: input.currency,
        error: {
          kind: "no_results",
          code: "liteapi_no_hotels",
          message:
            "LiteAPI returned no hotels for this search. Try a wider radius or different dates.",
        },
      });
    }

    ratesSnapshot = await provider.searchRates({
      region: ADMIN_TEST_REGION,
      node_id: nodeId,
      hotel_ids: hotels.map((hotel) => hotel.provider_hotel_id),
      checkin: input.checkin_date,
      checkout: input.checkout_date,
      occupancies,
      currency: input.currency,
      guest_nationality: input.guest_nationality,
      limit: maxResults,
    });
    hotelOfferSnapshotId = (await saveHotelOfferSnapshotFn(ratesSnapshot)).id;

    if (ratesSnapshot.offers.length === 0) {
      return buildProbeResult({
        ok: false,
        startedAt,
        nowMs,
        requestSummary,
        providerStatus,
        providerCallLogs,
        hotels,
        ratesSnapshot,
        hotelSearchSnapshotId,
        hotelOfferSnapshotId,
        currency: ratesSnapshot.currency,
        error: {
          kind: "no_results",
          code: "liteapi_no_rates",
          message:
            "LiteAPI found hotels, but no rates matched this traveller/date combination.",
        },
      });
    }

    return buildProbeResult({
      ok: true,
      startedAt,
      nowMs,
      requestSummary,
      providerStatus,
      providerCallLogs,
      hotels,
      ratesSnapshot,
      hotelSearchSnapshotId,
      hotelOfferSnapshotId,
      currency: ratesSnapshot.currency,
    });
  } catch (error) {
    return buildProbeResult({
      ok: false,
      startedAt,
      nowMs,
      requestSummary,
      providerStatus,
      providerCallLogs,
      hotels,
      ratesSnapshot,
      hotelSearchSnapshotId,
      hotelOfferSnapshotId,
      currency: ratesSnapshot?.currency ?? input.currency,
      error: mapProbeError(error, config.apiKey),
    });
  }
}

function buildProviderStatus(config: LiteApiProviderConfig): LiteApiProbeProviderStatus {
  const apiKeyPresent = Boolean(config.apiKey);
  return {
    enabled_flag: config.enabled,
    api_key_present: apiKeyPresent,
    available: config.enabled && apiKeyPresent,
    timeout_ms: config.timeoutMs,
    max_results_default: config.maxResults,
  };
}

function buildProbeResult(args: {
  ok: boolean;
  startedAt: number;
  nowMs: () => number;
  requestSummary: LiteApiProbeRequestSummary;
  providerStatus: LiteApiProbeProviderStatus;
  providerCallLogs: ProviderCallLog[];
  hotels: HotelSearchResult[];
  ratesSnapshot: HotelOfferSnapshot | null;
  hotelSearchSnapshotId: string | null;
  hotelOfferSnapshotId: string | null;
  currency: string;
  error?: LiteApiProbeError;
}): LiteApiProbeResult {
  const offers = args.ratesSnapshot?.offers ?? [];
  const sortedAmounts = offers
    .map((offer) => offer.total_amount)
    .filter((amount): amount is number => amount !== null)
    .sort((left, right) => left - right);
  const cheapestTotalAmount = sortedAmounts[0] ?? null;
  const medianTotalAmount = median(sortedAmounts);

  return {
    ok: args.ok,
    provider_status: args.providerStatus,
    request_summary: args.requestSummary,
    response_time_ms: Math.max(0, args.nowMs() - args.startedAt),
    hotels_count: args.hotels.length,
    rates_count: offers.length,
    cheapest_total_amount: cheapestTotalAmount,
    median_total_amount: medianTotalAmount,
    currency: args.currency,
    provider_call_log_id: args.providerCallLogs.at(-1)?.id ?? null,
    provider_call_log_ids: args.providerCallLogs.map((entry) => entry.id),
    provider_calls: args.providerCallLogs.map((entry) => ({
      id: entry.id,
      endpoint: entry.endpoint,
      status: entry.status,
      duration_ms: entry.duration_ms,
      result_count: entry.result_count,
      error_code: entry.error_code ?? null,
      error_message: entry.error_message ?? null,
    })),
    hotel_search_snapshot_id: args.hotelSearchSnapshotId,
    hotel_offer_snapshot_id: args.hotelOfferSnapshotId,
    top_hotels: buildTopHotelCards(args.hotels, offers, args.currency),
    normalized_json: {
      hotels: args.hotels,
      rates_snapshot: args.ratesSnapshot,
    },
    error: args.error,
  };
}

function buildSearchSnapshot(args: {
  input: HotelSearchInput;
  hotels: HotelSearchResult[];
  fetchedAt: number;
}): HotelSearchSnapshot {
  const queryKey = buildSearchQueryKey(args.input);
  return {
    id: `${queryKey}_${args.fetchedAt}`,
    provider: "liteapi",
    region: args.input.region,
    node_id: args.input.node_id,
    city_name: args.input.city_name ?? null,
    country_code: args.input.country_code ?? null,
    anchor: args.input.anchor ?? null,
    radius_km: args.input.radius_km ?? null,
    query_key: queryKey,
    result_count: args.hotels.length,
    results: args.hotels,
    fetched_at: args.fetchedAt,
    expires_at: args.fetchedAt + SEARCH_SNAPSHOT_TTL_MS,
  };
}

function buildSearchQueryKey(input: HotelSearchInput): string {
  const payload = {
    provider: "liteapi",
    region: input.region.trim().toLowerCase(),
    node_id: input.node_id.trim(),
    city_name: input.city_name?.trim().toLowerCase() ?? null,
    country_code: input.country_code?.trim().toUpperCase() ?? null,
    anchor: input.anchor
      ? {
          lat: Number(input.anchor.lat.toFixed(6)),
          lng: Number(input.anchor.lng.toFixed(6)),
        }
      : null,
    radius_km:
      input.radius_km === undefined
        ? null
        : Number(input.radius_km.toFixed(3)),
    limit: input.limit ?? null,
  };
  const digest = hashText(JSON.stringify(payload)).slice(0, 32);
  return `liteapi_search_${digest}`;
}

function buildTopHotelCards(
  hotels: HotelSearchResult[],
  offers: HotelOfferResult[],
  fallbackCurrency: string,
): LiteApiProbeHotelCard[] {
  const perHotelMinAmount = new Map<string, number>();
  const perHotelCurrency = new Map<string, string>();

  for (const offer of offers) {
    if (offer.total_amount === null) continue;
    const existing = perHotelMinAmount.get(offer.provider_hotel_id);
    if (existing === undefined || offer.total_amount < existing) {
      perHotelMinAmount.set(offer.provider_hotel_id, offer.total_amount);
      perHotelCurrency.set(offer.provider_hotel_id, offer.currency);
    }
  }

  return hotels
    .map((hotel) => {
      const cheapest = perHotelMinAmount.get(hotel.provider_hotel_id) ?? null;
      return {
        provider_hotel_id: hotel.provider_hotel_id,
        name: hotel.name,
        address: hotel.address ?? null,
        star_rating: hotel.star_rating ?? null,
        guest_rating: hotel.guest_rating ?? null,
        distance_from_anchor_km: hotel.distance_from_anchor_km ?? null,
        cheapest_total_amount: cheapest,
        currency:
          perHotelCurrency.get(hotel.provider_hotel_id) ??
          fallbackCurrency.toUpperCase(),
      };
    })
    .sort((left, right) => {
      const leftPrice = left.cheapest_total_amount ?? Number.POSITIVE_INFINITY;
      const rightPrice = right.cheapest_total_amount ?? Number.POSITIVE_INFINITY;
      if (leftPrice !== rightPrice) return leftPrice - rightPrice;
      const leftStars = left.star_rating ?? -1;
      const rightStars = right.star_rating ?? -1;
      if (leftStars !== rightStars) return rightStars - leftStars;
      return left.name.localeCompare(right.name);
    })
    .slice(0, TOP_HOTEL_CARD_LIMIT);
}

function buildOccupancies(
  adults: number,
  childrenAges: number[],
  requestedRooms: number,
): HotelRateSearchInput["occupancies"] {
  const roomCount = Math.max(1, Math.min(Math.trunc(requestedRooms), adults));
  const occupancies: HotelRateSearchInput["occupancies"] = Array.from(
    { length: roomCount },
    () => ({ adults: 0, children_ages: [] }),
  );

  for (let index = 0; index < adults; index += 1) {
    occupancies[index % roomCount].adults += 1;
  }

  const sortedChildAges = [...childrenAges].sort((left, right) => left - right);
  for (let index = 0; index < sortedChildAges.length; index += 1) {
    occupancies[index % roomCount].children_ages.push(sortedChildAges[index]);
  }

  return occupancies;
}

function mapProbeError(
  error: unknown,
  apiKey: string | null,
): LiteApiProbeError {
  if (error instanceof ProviderDisabledError) {
    return {
      kind: "provider_disabled",
      code: error.code,
      message: sanitiseProbeMessage(error.message, apiKey),
    };
  }
  if (error instanceof ProviderTimeoutError) {
    return {
      kind: "timeout",
      code: error.code,
      message: sanitiseProbeMessage(error.message, apiKey),
    };
  }
  if (error instanceof ProviderResponseError) {
    return {
      kind: "provider_failure",
      code: error.code,
      message: sanitiseProbeMessage(error.message, apiKey),
    };
  }
  return {
    kind: "internal_error",
    code: "liteapi_probe_internal_error",
    message: sanitiseProbeMessage(
      error instanceof Error && error.message
        ? error.message
        : "LiteAPI probe failed unexpectedly.",
      apiKey,
    ),
  };
}

/**
 * Defense-in-depth redaction for the probe-level catch block. The
 * provider already redacts upstream LiteAPI text, but a non-provider
 * failure (e.g. Firestore write throwing with an embedded URL) would
 * otherwise bypass that. Mirrors the provider's `sanitiseTextSnippet`.
 */
function sanitiseProbeMessage(value: string, apiKey: string | null): string {
  const fallback = "LiteAPI probe failed unexpectedly.";
  if (!value) return fallback;
  let output = value;
  if (apiKey) {
    output = output.split(apiKey).join("[REDACTED]");
  }
  output = output.replace(/\s+/g, " ").trim();
  if (output.length > 220) {
    output = `${output.slice(0, 220)}...`;
  }
  return output.length > 0 ? output : fallback;
}

function defaultProviderFactory(args: {
  config: LiteApiProviderConfig;
  nowMs: () => number;
  logCall: (
    entry: Omit<ProviderCallLog, "id" | "created_at"> & {
      id?: string;
      created_at?: number;
    },
  ) => Promise<void>;
}): ProbeProvider {
  return new LiteApiHotelDataProvider({
    config: args.config,
    nowMs: args.nowMs,
    logCall: args.logCall,
  });
}

function toAnchor(input: LiteApiProbeInput): { lat: number; lng: number } | undefined {
  if (
    input.latitude === undefined ||
    input.longitude === undefined ||
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude)
  ) {
    return undefined;
  }
  return {
    lat: input.latitude,
    lng: input.longitude,
  };
}

function buildAdminNodeId(input: LiteApiProbeInput): string {
  const citySlug = slugify(input.city_name ?? "");
  if (citySlug) {
    return `admin_city_${citySlug}`;
  }

  if (input.latitude !== undefined && input.longitude !== undefined) {
    const latToken = `${input.latitude.toFixed(3)}`.replace(/[^\d.-]+/g, "_");
    const lngToken = `${input.longitude.toFixed(3)}`.replace(/[^\d.-]+/g, "_");
    return `admin_geo_${latToken}_${lngToken}`;
  }

  return "admin_liteapi_probe";
}

function clampMaxResults(
  requested: number | undefined,
  defaultMaxResults: number,
): number {
  const parsed = Math.trunc(requested ?? defaultMaxResults);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, defaultMaxResults);
  return Math.max(1, Math.min(parsed, 100));
}

function slugify(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 48);
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function median(sortedValues: number[]): number | null {
  if (sortedValues.length === 0) return null;
  const mid = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[mid];
  return Number(((sortedValues[mid - 1] + sortedValues[mid]) / 2).toFixed(2));
}
