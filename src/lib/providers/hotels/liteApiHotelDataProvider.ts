import { createHash } from "node:crypto";

import type { HotelDataProvider } from "@/lib/providers/hotels/HotelDataProvider";
import {
  resolveLiteApiProviderConfig,
  type LiteApiProviderConfig,
} from "@/lib/providers/hotels/liteApiConfig";
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
  ProviderCallLog,
  ProviderCallStatus,
} from "@/lib/providers/hotels/types";
import { createProviderCallLog } from "@/lib/repositories/providerCallLogRepository";

interface LiteApiHotelDataProviderOptions {
  config?: LiteApiProviderConfig;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  logCall?: (
    entry: Omit<ProviderCallLog, "id" | "created_at"> & {
      id?: string;
      created_at?: number;
    },
  ) => Promise<void>;
}

const HOTEL_SEARCH_ENDPOINT = "/data/hotels";
const HOTEL_RATES_ENDPOINT = "/hotels/rates";

export class LiteApiHotelDataProvider implements HotelDataProvider {
  readonly provider = "liteapi" as const;

  private readonly config: LiteApiProviderConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;
  private readonly logCall: NonNullable<LiteApiHotelDataProviderOptions["logCall"]>;

  constructor(options: LiteApiHotelDataProviderOptions = {}) {
    assertServerRuntime();
    this.config = options.config ?? resolveLiteApiProviderConfig();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.logCall = options.logCall ?? defaultProviderLogWriter;
  }

  async searchHotels(input: HotelSearchInput): Promise<HotelSearchResult[]> {
    const endpoint = HOTEL_SEARCH_ENDPOINT;
    const requestSummary = buildHotelSearchSummary(input, this.config.maxResults);
    const startedAt = this.nowMs();

    try {
      this.assertProviderEnabled();
      const url = this.buildHotelSearchUrl(input);
      const response = await this.fetchWithTimeout(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-Key": this.config.apiKey!,
        },
      });
      const payload = await this.readJsonResponse(response, endpoint);
      const results = normaliseHotelSearchResults(payload);
      await this.writeProviderLog({
        endpoint,
        region: input.region,
        node_id: input.node_id,
        request_summary: requestSummary,
        status: "success",
        duration_ms: this.nowMs() - startedAt,
        result_count: results.length,
      });
      return results;
    } catch (error) {
      const providerError = this.normaliseProviderError(error, endpoint);
      await this.writeProviderLog({
        endpoint,
        region: input.region,
        node_id: input.node_id,
        request_summary: requestSummary,
        status: statusFromError(providerError),
        duration_ms: this.nowMs() - startedAt,
        result_count: 0,
        error_code: providerError.code,
        error_message: providerError.message,
      });
      throw providerError;
    }
  }

  async searchRates(input: HotelRateSearchInput): Promise<HotelOfferSnapshot> {
    const endpoint = HOTEL_RATES_ENDPOINT;
    const requestSummary = buildHotelRateSummary(input, this.config.maxResults);
    const startedAt = this.nowMs();

    try {
      this.assertProviderEnabled();
      const payload = buildRateRequestPayload(input, this.config.maxResults);
      const response = await this.fetchWithTimeout(
        new URL(HOTEL_RATES_ENDPOINT, `${this.config.baseUrl}/`),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-API-Key": this.config.apiKey!,
          },
          body: JSON.stringify(payload),
        },
      );
      const json = await this.readJsonResponse(response, endpoint);
      const offers = normaliseHotelOffers(json, input);
      const now = this.nowMs();
      const snapshot = buildOfferSnapshot({ input, offers, fetchedAt: now });
      await this.writeProviderLog({
        endpoint,
        region: input.region,
        node_id: input.node_id,
        request_summary: requestSummary,
        status: offers.length > 0 ? "success" : "empty",
        duration_ms: now - startedAt,
        result_count: offers.length,
      });
      return snapshot;
    } catch (error) {
      const providerError = this.normaliseProviderError(error, endpoint);
      await this.writeProviderLog({
        endpoint,
        region: input.region,
        node_id: input.node_id,
        request_summary: requestSummary,
        status: statusFromError(providerError),
        duration_ms: this.nowMs() - startedAt,
        result_count: 0,
        error_code: providerError.code,
        error_message: providerError.message,
      });
      throw providerError;
    }
  }

  private assertProviderEnabled(): void {
    if (!this.config.enabled) {
      throw new ProviderDisabledError(
        "LiteAPI provider is disabled (LITEAPI_ENABLED is false).",
      );
    }
    if (!this.config.apiKey) {
      throw new ProviderDisabledError(
        "LiteAPI provider is enabled but LITEAPI_API_KEY is missing.",
      );
    }
  }

  private buildHotelSearchUrl(input: HotelSearchInput): URL {
    if (!input.city_name && !input.anchor) {
      throw new ProviderResponseError({
        code: "liteapi_invalid_search_input",
        endpoint: HOTEL_SEARCH_ENDPOINT,
        status: null,
        message:
          "Hotel search requires city_name or anchor coordinates for LiteAPI.",
      });
    }

    const limit = clampLimit(input.limit ?? this.config.maxResults, this.config.maxResults);
    const url = new URL(HOTEL_SEARCH_ENDPOINT, `${this.config.baseUrl}/`);
    if (input.city_name) {
      url.searchParams.set("cityName", input.city_name.trim());
    }
    if (input.country_code) {
      url.searchParams.set("countryCode", input.country_code.trim().toUpperCase());
    }
    if (input.anchor) {
      url.searchParams.set("latitude", String(input.anchor.lat));
      url.searchParams.set("longitude", String(input.anchor.lng));
      if (Number.isFinite(input.radius_km)) {
        url.searchParams.set("radius", String(Math.max(1, Math.round(input.radius_km!))));
      }
    }
    url.searchParams.set("limit", String(limit));
    return url;
  }

  private async fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    try {
      const response = await this.fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw new ProviderResponseError({
          code: `liteapi_http_${response.status}`,
          endpoint:
            input instanceof URL
              ? input.pathname
              : new URL(String(input), `${this.config.baseUrl}/`).pathname,
          status: response.status,
          message: buildProviderResponseMessage(
            response.status,
            response.statusText,
            responseText,
            this.config.apiKey,
          ),
        });
      }
      return response;
    } catch (error) {
      if (isAbortError(error)) {
        const endpoint =
          input instanceof URL
            ? input.pathname
            : new URL(String(input), `${this.config.baseUrl}/`).pathname;
        throw new ProviderTimeoutError({
          endpoint,
          timeoutMs: this.config.timeoutMs,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async readJsonResponse(
    response: Response,
    endpoint: string,
  ): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new ProviderResponseError({
        code: "liteapi_invalid_json",
        endpoint,
        status: response.status,
        message: `LiteAPI returned invalid JSON for ${endpoint}.`,
      });
    }
  }

  private normaliseProviderError(
    error: unknown,
    endpoint: string,
  ): ProviderDisabledError | ProviderTimeoutError | ProviderResponseError {
    if (
      error instanceof ProviderDisabledError ||
      error instanceof ProviderTimeoutError ||
      error instanceof ProviderResponseError
    ) {
      return error;
    }
    return new ProviderResponseError({
      code: "liteapi_unexpected_error",
      endpoint,
      status: null,
      message:
        error instanceof Error && error.message
          ? `LiteAPI request failed before a valid response was received: ${sanitiseTextSnippet(error.message, this.config.apiKey)}`
          : "LiteAPI request failed before a valid response was received.",
    });
  }

  private async writeProviderLog(
    entry: Omit<ProviderCallLog, "id" | "provider" | "created_at"> & {
      error_code?: string;
      error_message?: string;
    },
  ): Promise<void> {
    try {
      await this.logCall({
        provider: this.provider,
        endpoint: entry.endpoint,
        request_summary: entry.request_summary,
        status: entry.status,
        duration_ms: Math.max(0, Math.trunc(entry.duration_ms)),
        result_count: Math.max(0, Math.trunc(entry.result_count)),
        error_code: entry.error_code ?? null,
        error_message: entry.error_message ?? null,
        region: entry.region,
        node_id: entry.node_id,
      });
    } catch {
      // Logging should never make provider calls fail.
    }
  }
}

function normaliseHotelSearchResults(payload: unknown): HotelSearchResult[] {
  const rows = readDataArray(payload);
  const out: HotelSearchResult[] = [];
  for (const row of rows) {
    const providerHotelId = normaliseString(
      row.hotelId ?? row.id ?? row.hotel_id ?? row.code,
    );
    const name = normaliseString(row.name ?? row.hotelName ?? row.hotel_name);
    if (!providerHotelId || !name) continue;

    const location = readCoordinates(row);
    out.push({
      provider: "liteapi",
      provider_hotel_id: providerHotelId,
      name,
      address: normaliseNullableString(
        row.address ?? row.formattedAddress ?? row.formatted_address,
      ),
      location,
      star_rating: normaliseNullableNumber(
        row.starRating ?? row.star_rating ?? row.stars,
      ),
      guest_rating: normaliseNullableNumber(row.rating ?? row.guestRating),
      review_count: normaliseNullableNumber(
        row.reviewsCount ?? row.reviewCount ?? row.review_count,
      ),
      distance_from_anchor_km: normaliseNullableNumber(
        row.distanceKm ?? row.distance_km,
      ),
    });
  }
  return out.sort((left, right) =>
    left.provider_hotel_id.localeCompare(right.provider_hotel_id),
  );
}

function normaliseHotelOffers(
  payload: unknown,
  input: HotelRateSearchInput,
): HotelOfferResult[] {
  const rows = readDataArray(payload);
  const nights = computeNights(input.checkin, input.checkout);
  const out: HotelOfferResult[] = [];

  for (const row of rows) {
    const providerHotelId = normaliseString(row.hotelId ?? row.hotel_id ?? row.id);
    if (!providerHotelId) continue;
    const roomTypes = toRecordArray(row.roomTypes);
    for (const roomType of roomTypes) {
      const roomTypeId =
        normaliseString(roomType.roomTypeId ?? roomType.id) ??
        `${providerHotelId}_room`;
      const rates = toRecordArray(roomType.rates);
      const leadRate = rates[0];
      const offerId = normaliseString(roomType.offerId ?? roomType.offer_id);
      const totalAmount =
        readMoneyAmount(roomType.offerRetailRate) ??
        readMoneyAmount(leadRate?.retailRate) ??
        null;
      const currency =
        normaliseCurrency(
          readMoneyCurrency(roomType.offerRetailRate) ??
            readMoneyCurrency(leadRate?.retailRate),
        ) ?? normaliseCurrency(input.currency);
      const nightlyAmount =
        totalAmount === null
          ? null
          : Number((totalAmount / Math.max(1, nights)).toFixed(2));

      out.push({
        provider: "liteapi",
        provider_hotel_id: providerHotelId,
        room_type_id: roomTypeId,
        room_name:
          normaliseString(leadRate?.name ?? roomType.name ?? roomType.roomName) ??
          "Room",
        board_type: normaliseNullableString(
          leadRate?.boardType ?? leadRate?.board_type,
        ),
        board_name: normaliseNullableString(
          leadRate?.boardName ?? leadRate?.board_name,
        ),
        total_amount: totalAmount,
        nightly_amount: nightlyAmount,
        currency: currency ?? "INR",
        max_occupancy: normaliseNullableNumber(
          leadRate?.maxOccupancy ?? leadRate?.max_occupancy,
        ),
        adult_count: normaliseNullableNumber(
          leadRate?.adultCount ?? leadRate?.adult_count,
        ),
        child_count: normaliseNullableNumber(
          leadRate?.childCount ?? leadRate?.child_count,
        ),
        refundable_tag: normaliseNullableString(
          asRecord(leadRate?.cancellationPolicies)?.refundableTag ??
            asRecord(leadRate?.cancellationPolicies)?.refundable_tag,
        ),
        provider_offer_id_hash: offerId ? hashText(offerId).slice(0, 24) : null,
      });
    }
  }

  return out.sort((left, right) => {
    const hotelDiff = left.provider_hotel_id.localeCompare(right.provider_hotel_id);
    if (hotelDiff !== 0) return hotelDiff;
    const priceLeft = left.total_amount ?? Number.POSITIVE_INFINITY;
    const priceRight = right.total_amount ?? Number.POSITIVE_INFINITY;
    if (priceLeft !== priceRight) return priceLeft - priceRight;
    return left.room_type_id.localeCompare(right.room_type_id);
  });
}

function buildOfferSnapshot(args: {
  input: HotelRateSearchInput;
  offers: HotelOfferResult[];
  fetchedAt: number;
}): HotelOfferSnapshot {
  const cacheKey = buildLiteApiRateCacheKey(args.input);
  const nights = computeNights(args.input.checkin, args.input.checkout);
  return {
    id: `${cacheKey}_${args.fetchedAt}`,
    cache_key: cacheKey,
    provider: "liteapi",
    region: args.input.region,
    node_id: args.input.node_id,
    hotel_ids: normaliseHotelIds(args.input.hotel_ids),
    checkin: args.input.checkin,
    checkout: args.input.checkout,
    nights,
    currency: normaliseCurrency(args.input.currency) ?? "INR",
    guest_nationality:
      normaliseNationality(args.input.guest_nationality) ?? "IN",
    occupancies: normaliseOccupancies(args.input.occupancies),
    offers: args.offers,
    min_total_amount: minimumAmount(args.offers, "total_amount"),
    min_nightly_amount: minimumAmount(args.offers, "nightly_amount"),
    result_count: args.offers.length,
    status: args.offers.length > 0 ? "success" : "empty",
    fetched_at: args.fetchedAt,
    // Rate signals are volatile; keep cache freshness intentionally short.
    expires_at: args.fetchedAt + 6 * 60 * 60 * 1000,
  };
}

function buildRateRequestPayload(
  input: HotelRateSearchInput,
  defaultMaxResults: number,
): Record<string, unknown> {
  const hotelIds = normaliseHotelIds(input.hotel_ids);
  if (hotelIds.length === 0) {
    throw new ProviderResponseError({
      code: "liteapi_invalid_rates_input",
      endpoint: HOTEL_RATES_ENDPOINT,
      status: null,
      message: "Hotel rate search requires at least one hotel id.",
    });
  }

  return {
    hotelIds,
    occupancies: normaliseOccupancies(input.occupancies).map((occupancy) => ({
      adults: occupancy.adults,
      children: occupancy.children_ages,
    })),
    currency: normaliseCurrency(input.currency) ?? "INR",
    guestNationality: normaliseNationality(input.guest_nationality) ?? "IN",
    checkin: input.checkin,
    checkout: input.checkout,
    limit: clampLimit(input.limit ?? defaultMaxResults, defaultMaxResults),
  };
}

function buildHotelSearchSummary(
  input: HotelSearchInput,
  defaultMaxResults: number,
): Record<string, unknown> {
  return {
    region: input.region,
    node_id: input.node_id,
    city_name: input.city_name ?? null,
    country_code: normaliseCountryCode(input.country_code),
    anchor: input.anchor
      ? { lat: input.anchor.lat, lng: input.anchor.lng }
      : null,
    radius_km:
      input.radius_km === undefined ? null : Math.max(1, Math.round(input.radius_km)),
    limit: clampLimit(input.limit ?? defaultMaxResults, defaultMaxResults),
  };
}

function buildHotelRateSummary(
  input: HotelRateSearchInput,
  defaultMaxResults: number,
): Record<string, unknown> {
  return {
    region: input.region,
    node_id: input.node_id,
    checkin: input.checkin,
    checkout: input.checkout,
    currency: normaliseCurrency(input.currency) ?? "INR",
    guest_nationality: normaliseNationality(input.guest_nationality) ?? "IN",
    hotel_ids_count: input.hotel_ids.length,
    occupancies: normaliseOccupancies(input.occupancies).map((occupancy) => ({
      adults: occupancy.adults,
      children_count: occupancy.children_ages.length,
    })),
    limit: clampLimit(input.limit ?? defaultMaxResults, defaultMaxResults),
  };
}

export function buildLiteApiRateCacheKey(input: HotelRateSearchInput): string {
  const serialisable = {
    provider: "liteapi",
    region: input.region.trim().toLowerCase(),
    node_id: input.node_id.trim(),
    hotel_ids: normaliseHotelIds(input.hotel_ids),
    checkin: input.checkin,
    checkout: input.checkout,
    currency: normaliseCurrency(input.currency) ?? "INR",
    guest_nationality: normaliseNationality(input.guest_nationality) ?? "IN",
    occupancies: normaliseOccupancies(input.occupancies),
  };
  return `liteapi_${hashText(JSON.stringify(serialisable)).slice(0, 32)}`;
}

function normaliseHotelIds(hotelIds: string[]): string[] {
  return Array.from(
    new Set(hotelIds.map((hotelId) => hotelId.trim()).filter(Boolean)),
  ).sort();
}

function minimumAmount(
  offers: HotelOfferResult[],
  field: "total_amount" | "nightly_amount",
): number | null {
  const amounts = offers
    .map((offer) => offer[field])
    .filter((amount): amount is number => amount !== null);
  if (amounts.length === 0) return null;
  return Math.min(...amounts);
}

function normaliseOccupancies(
  occupancies: HotelRateSearchInput["occupancies"],
): HotelRateSearchInput["occupancies"] {
  const cleaned = occupancies
    .map((occupancy) => ({
      adults: Math.max(1, Math.trunc(occupancy.adults)),
      children_ages: occupancy.children_ages
        .map((age) => Math.max(0, Math.trunc(age)))
        .sort((left, right) => left - right),
    }))
    .sort((left, right) => {
      if (left.adults !== right.adults) return left.adults - right.adults;
      if (left.children_ages.length !== right.children_ages.length) {
        return left.children_ages.length - right.children_ages.length;
      }
      return left.children_ages.join(",").localeCompare(right.children_ages.join(","));
    });

  return cleaned.length > 0 ? cleaned : [{ adults: 1, children_ages: [] }];
}

function readDataArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return toRecordArray(payload);
  }
  const record = asRecord(payload);
  if (!record) return [];
  return toRecordArray(record.data ?? record.hotels ?? record.results);
}

function readCoordinates(row: Record<string, unknown>) {
  const lat =
    normaliseNullableNumber(row.latitude) ??
    normaliseNullableNumber(asRecord(row.location)?.latitude) ??
    normaliseNullableNumber(asRecord(row.location)?.lat);
  const lng =
    normaliseNullableNumber(row.longitude) ??
    normaliseNullableNumber(asRecord(row.location)?.longitude) ??
    normaliseNullableNumber(asRecord(row.location)?.lng);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

function readMoneyAmount(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) return null;
  const direct = normaliseNullableNumber(record.amount);
  if (direct !== null) return direct;
  const total = Array.isArray(record.total) ? record.total[0] : null;
  return normaliseNullableNumber(asRecord(total)?.amount);
}

function readMoneyCurrency(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const direct = normaliseCurrency(record.currency);
  if (direct) return direct;
  const total = Array.isArray(record.total) ? record.total[0] : null;
  return normaliseCurrency(asRecord(total)?.currency);
}

function buildProviderResponseMessage(
  status: number,
  statusText: string,
  text: string,
  apiKey: string | null,
): string {
  const snippet = sanitiseTextSnippet(text, apiKey);
  const suffix = snippet ? `: ${snippet}` : "";
  return `LiteAPI request failed (${status} ${statusText || "error"})${suffix}`;
}

function sanitiseTextSnippet(text: string, apiKey: string | null): string {
  if (!text) return "";
  let output = text;
  if (apiKey) {
    output = output.split(apiKey).join("[REDACTED]");
  }
  output = output.replace(/\s+/g, " ").trim();
  if (output.length > 220) {
    output = `${output.slice(0, 220)}...`;
  }
  return output;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError")
  );
}

function normaliseString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseNullableString(value: unknown): string | null {
  return normaliseString(value);
}

function normaliseNullableNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normaliseCurrency(value: unknown): string | null {
  const raw = normaliseString(value);
  if (!raw) return null;
  return raw.toUpperCase();
}

function normaliseCountryCode(value: unknown): string | null {
  const raw = normaliseString(value);
  if (!raw) return null;
  return raw.toUpperCase();
}

function normaliseNationality(value: unknown): string | null {
  return normaliseCountryCode(value);
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function computeNights(checkin: string, checkout: string): number {
  const start = parseLocalDate(checkin);
  const end = parseLocalDate(checkout);
  if (start === null || end === null) return 1;
  const diff = Math.round((end - start) / (24 * 60 * 60 * 1000));
  return Math.max(1, diff);
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

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clampLimit(limit: number, maxLimit: number): number {
  const int = Math.trunc(limit);
  if (!Number.isFinite(int) || int <= 0) return Math.max(1, maxLimit);
  return Math.max(1, Math.min(int, maxLimit));
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("LiteAPI hotel provider can only be constructed on the server.");
  }
}

function statusFromError(
  error: ProviderDisabledError | ProviderTimeoutError | ProviderResponseError,
): ProviderCallStatus {
  if (error instanceof ProviderDisabledError) return "disabled";
  if (error instanceof ProviderTimeoutError) return "timeout";
  return "error";
}

async function defaultProviderLogWriter(
  entry: Omit<ProviderCallLog, "id" | "created_at"> & {
    id?: string;
    created_at?: number;
  },
): Promise<void> {
  await createProviderCallLog(entry);
}
