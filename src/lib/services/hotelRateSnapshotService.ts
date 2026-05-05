import { createHash } from "node:crypto";

import type { StayBlock } from "@/lib/itinerary/stayBlocks";
import { normaliseTravellers } from "@/lib/itinerary/planningLimits";
import type { HotelDataProvider } from "@/lib/providers/hotels/HotelDataProvider";
import { buildLiteApiRateCacheKey } from "@/lib/providers/hotels/liteApiHotelDataProvider";
import {
  ProviderDisabledError,
  ProviderResponseError,
  ProviderTimeoutError,
} from "@/lib/providers/hotels/providerErrors";
import type {
  HotelOfferSnapshot,
  HotelRateSearchInput,
  HotelSearchInput,
  HotelSearchSnapshot,
} from "@/lib/providers/hotels/types";
import type {
  Coordinates,
  LocalDateString,
  StayHotelRateOption,
  TravellerComposition,
} from "@/types/domain";

const DEFAULT_MAX_PROVIDER_CALLS = 6;
const DEFAULT_SEARCH_RADIUS_KM = 8;
const DEFAULT_MAX_RESULTS = 20;
const SEARCH_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

type HotelUnavailableReason =
  | "provider_disabled"
  | "provider_timeout"
  | "provider_error"
  | "no_rates"
  | "no_hotels"
  | "call_limit_exceeded"
  | "missing_anchor"
  | "missing_child_ages"
  | "missing_trip_start_date";

export interface StayHotelRatePlan {
  blockKey: string;
  nodeId: string;
  nodeName: string;
  startDay: number;
  endDay: number;
  nights: number;
  status: "live" | "cached" | "unknown";
  unavailableReason?: HotelUnavailableReason;
  options: StayHotelRateOption[];
  searchSnapshotId?: string | null;
  offerSnapshotId?: string | null;
  lastCheckedAt?: number | null;
  expiresAt?: number | null;
}

export interface ResolveStayHotelRatePlansInput {
  region: string;
  tripStartDate?: LocalDateString;
  stayBlocks: StayBlock[];
  travellers: TravellerComposition;
  currency: string;
  cityLocationsByNodeId?: Record<string, Coordinates>;
}

export interface ResolveStayHotelRatePlansDependencies {
  provider: HotelDataProvider;
  nowMs?: () => number;
  maxProviderCalls?: number;
  searchRadiusKm?: number;
  maxResults?: number;
  findLatestSearchSnapshotByQueryKey?: (
    queryKey: string,
  ) => Promise<HotelSearchSnapshot | null>;
  saveHotelSearchSnapshot?: (
    snapshot: HotelSearchSnapshot,
  ) => Promise<HotelSearchSnapshot>;
  findLatestOfferSnapshotByCacheKey?: (
    cacheKey: string,
  ) => Promise<HotelOfferSnapshot | null>;
  saveHotelOfferSnapshot?: (
    snapshot: HotelOfferSnapshot,
  ) => Promise<HotelOfferSnapshot>;
}

export interface ResolveStayHotelRatePlansResult {
  plans: StayHotelRatePlan[];
  warnings: string[];
  providerCallsUsed: number;
}

export async function resolveStayHotelRatePlans(
  input: ResolveStayHotelRatePlansInput,
  deps: ResolveStayHotelRatePlansDependencies,
): Promise<ResolveStayHotelRatePlansResult> {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const maxProviderCalls = Math.max(
    0,
    Math.trunc(deps.maxProviderCalls ?? DEFAULT_MAX_PROVIDER_CALLS),
  );
  const searchRadiusKm = Math.max(
    1,
    Math.trunc(deps.searchRadiusKm ?? DEFAULT_SEARCH_RADIUS_KM),
  );
  const maxResults = Math.max(
    1,
    Math.trunc(deps.maxResults ?? DEFAULT_MAX_RESULTS),
  );
  const travellers = normaliseTravellers(input.travellers);
  const currency = (input.currency || "INR").trim().toUpperCase() || "INR";
  const orderedBlocks = [...input.stayBlocks].sort((left, right) => {
    const startDiff = left.startDay - right.startDay;
    if (startDiff !== 0) return startDiff;
    return left.nodeId.localeCompare(right.nodeId);
  });

  let providerCallsUsed = 0;
  const warnings: string[] = [];
  const plans: StayHotelRatePlan[] = [];

  if (
    travellers.children > 0 &&
    (!Array.isArray(travellers.children_ages) ||
      travellers.children_ages.length !== travellers.children)
  ) {
    for (const block of orderedBlocks) {
      const blockKey = buildBlockKey(block);
      warnings.push(
        `Hotel rates are unavailable for ${block.nodeName}: child ages are missing.`,
      );
      plans.push(
        unknownPlan(block, blockKey, "missing_child_ages", {
          searchSnapshotId: null,
          offerSnapshotId: null,
        }),
      );
    }
    return {
      plans,
      warnings: dedupeWarnings(warnings),
      providerCallsUsed,
    };
  }

  for (const block of orderedBlocks) {
    const blockKey = buildBlockKey(block);

    if (!input.tripStartDate) {
      warnings.push(
        `Hotel rates are unavailable for ${block.nodeName}: trip start date is missing.`,
      );
      plans.push(
        unknownPlan(block, blockKey, "missing_trip_start_date", {
          searchSnapshotId: null,
          offerSnapshotId: null,
        }),
      );
      continue;
    }

    const anchor = input.cityLocationsByNodeId?.[block.nodeId];
    if (!anchor) {
      warnings.push(
        `Hotel rates are unavailable for ${block.nodeName}: city coordinates are missing.`,
      );
      plans.push(
        unknownPlan(block, blockKey, "missing_anchor", {
          searchSnapshotId: null,
          offerSnapshotId: null,
        }),
      );
      continue;
    }

    const checkin = addDaysToLocalDate(input.tripStartDate, block.startDay);
    const checkout = checkin ? addDaysToLocalDate(checkin, block.nights) : null;
    if (!checkin || !checkout) {
      warnings.push(
        `Hotel rates are unavailable for ${block.nodeName}: invalid trip dates.`,
      );
      plans.push(
        unknownPlan(block, blockKey, "missing_trip_start_date", {
          searchSnapshotId: null,
          offerSnapshotId: null,
        }),
      );
      continue;
    }

    const searchInput: HotelSearchInput = {
      region: input.region,
      node_id: block.nodeId,
      city_name: block.nodeName,
      anchor,
      radius_km: searchRadiusKm,
      limit: maxResults,
    };
    const searchQueryKey = buildSearchQueryKey(searchInput);
    const latestSearchSnapshot = deps.findLatestSearchSnapshotByQueryKey
      ? await deps.findLatestSearchSnapshotByQueryKey(searchQueryKey)
      : null;

    let searchSnapshot = isFreshSnapshot(latestSearchSnapshot, nowMs())
      ? latestSearchSnapshot
      : null;
    if (!searchSnapshot) {
      if (providerCallsUsed >= maxProviderCalls) {
        if (hasSearchResults(latestSearchSnapshot)) {
          searchSnapshot = latestSearchSnapshot;
          warnings.push(
            `LiteAPI call limit reached; reused cached hotel search for ${block.nodeName}.`,
          );
        } else {
          warnings.push(
            `LiteAPI call limit reached; hotel rates are unavailable for ${block.nodeName}.`,
          );
          plans.push(
            unknownPlan(block, blockKey, "call_limit_exceeded", {
              searchSnapshotId: latestSearchSnapshot?.id ?? null,
              offerSnapshotId: null,
            }),
          );
          continue;
        }
      } else {
        try {
          providerCallsUsed += 1;
          const hotels = await deps.provider.searchHotels(searchInput);
          const fetchedAt = nowMs();
          searchSnapshot = {
            id: `${searchQueryKey}_${fetchedAt}`,
            provider: deps.provider.provider,
            region: searchInput.region,
            node_id: searchInput.node_id,
            city_name: searchInput.city_name ?? null,
            country_code: searchInput.country_code ?? null,
            anchor: searchInput.anchor ?? null,
            radius_km: searchInput.radius_km ?? null,
            query_key: searchQueryKey,
            result_count: hotels.length,
            results: hotels,
            fetched_at: fetchedAt,
            expires_at: fetchedAt + SEARCH_SNAPSHOT_TTL_MS,
          };
          if (deps.saveHotelSearchSnapshot) {
            try {
              searchSnapshot = await deps.saveHotelSearchSnapshot(searchSnapshot);
            } catch {
              warnings.push(
                `LiteAPI hotel search for ${block.nodeName} succeeded, but the search snapshot could not be persisted.`,
              );
            }
          }
        } catch (error) {
          if (hasSearchResults(latestSearchSnapshot)) {
            searchSnapshot = latestSearchSnapshot;
            warnings.push(
              `LiteAPI search failed for ${block.nodeName}; reused cached hotels.`,
            );
          } else {
            const { reason, warning } = mapProviderFailure(error, block.nodeName);
            warnings.push(warning);
            plans.push(
              unknownPlan(block, blockKey, reason, {
                searchSnapshotId: null,
                offerSnapshotId: null,
              }),
            );
            continue;
          }
        }
      }
    }

    if (!searchSnapshot || searchSnapshot.results.length === 0) {
      warnings.push(
        `LiteAPI returned no hotels for ${block.nodeName} for this stay window.`,
      );
      plans.push(
        unknownPlan(block, blockKey, "no_hotels", {
          searchSnapshotId: searchSnapshot?.id ?? null,
          offerSnapshotId: null,
        }),
      );
      continue;
    }

    const occupancies = buildOccupancies(travellers);
    const rateInput: HotelRateSearchInput = {
      region: input.region,
      node_id: block.nodeId,
      hotel_ids: searchSnapshot.results.map((hotel) => hotel.provider_hotel_id),
      checkin,
      checkout,
      occupancies,
      currency,
      guest_nationality:
        travellers.guest_nationality?.trim().toUpperCase() || "IN",
      limit: maxResults,
    };
    const rateCacheKey = buildLiteApiRateCacheKey(rateInput);
    const latestOfferSnapshot = deps.findLatestOfferSnapshotByCacheKey
      ? await deps.findLatestOfferSnapshotByCacheKey(rateCacheKey)
      : null;

    let offerSnapshot = isFreshSnapshot(latestOfferSnapshot, nowMs())
      ? latestOfferSnapshot
      : null;
    let rateStatus: "live" | "cached" = offerSnapshot ? "cached" : "live";

    if (!offerSnapshot) {
      if (providerCallsUsed >= maxProviderCalls) {
        if (hasOfferResults(latestOfferSnapshot)) {
          offerSnapshot = latestOfferSnapshot;
          rateStatus = "cached";
          warnings.push(
            `LiteAPI call limit reached; reused cached hotel rates for ${block.nodeName}.`,
          );
        } else {
          warnings.push(
            `LiteAPI call limit reached; hotel rates are unavailable for ${block.nodeName}.`,
          );
          plans.push(
            unknownPlan(block, blockKey, "call_limit_exceeded", {
              searchSnapshotId: searchSnapshot.id,
              offerSnapshotId: latestOfferSnapshot?.id ?? null,
            }),
          );
          continue;
        }
      } else {
        try {
          providerCallsUsed += 1;
          offerSnapshot = await deps.provider.searchRates(rateInput);
          rateStatus = "live";
          if (deps.saveHotelOfferSnapshot) {
            try {
              offerSnapshot = await deps.saveHotelOfferSnapshot(offerSnapshot);
            } catch {
              warnings.push(
                `LiteAPI hotel rates for ${block.nodeName} succeeded, but the rate snapshot could not be persisted.`,
              );
            }
          }
        } catch (error) {
          if (hasOfferResults(latestOfferSnapshot)) {
            offerSnapshot = latestOfferSnapshot;
            rateStatus = "cached";
            warnings.push(
              `LiteAPI rates failed for ${block.nodeName}; reused cached rates.`,
            );
          } else {
            const { reason, warning } = mapProviderFailure(error, block.nodeName);
            warnings.push(warning);
            plans.push(
              unknownPlan(block, blockKey, reason, {
                searchSnapshotId: searchSnapshot.id,
                offerSnapshotId: null,
              }),
            );
            continue;
          }
        }
      }
    }

    if (!offerSnapshot || offerSnapshot.offers.length === 0) {
      warnings.push(
        `LiteAPI returned no rates for ${block.nodeName} for selected dates and travellers.`,
      );
      plans.push(
        unknownPlan(block, blockKey, "no_rates", {
          searchSnapshotId: searchSnapshot.id,
          offerSnapshotId: offerSnapshot?.id ?? null,
          lastCheckedAt: offerSnapshot?.fetched_at ?? null,
          expiresAt: offerSnapshot?.expires_at ?? null,
        }),
      );
      continue;
    }

    plans.push({
      blockKey,
      nodeId: block.nodeId,
      nodeName: block.nodeName,
      startDay: block.startDay,
      endDay: block.endDay,
      nights: block.nights,
      status: rateStatus,
      options: normaliseStayOptions({
        searchSnapshot,
        offerSnapshot,
        confidence: rateStatus,
      }),
      searchSnapshotId: searchSnapshot.id,
      offerSnapshotId: offerSnapshot.id,
      lastCheckedAt: offerSnapshot.fetched_at,
      expiresAt: offerSnapshot.expires_at,
    });
  }

  return {
    plans,
    warnings: dedupeWarnings(warnings),
    providerCallsUsed,
  };
}

function normaliseStayOptions(args: {
  searchSnapshot: HotelSearchSnapshot;
  offerSnapshot: HotelOfferSnapshot;
  confidence: "live" | "cached";
}): StayHotelRateOption[] {
  const hotelsById = new Map(
    args.searchSnapshot.results.map((hotel) => [hotel.provider_hotel_id, hotel]),
  );

  return [...args.offerSnapshot.offers]
    .map((offer) => {
      const hotel = hotelsById.get(offer.provider_hotel_id);
      return {
        provider: "liteapi",
        provider_hotel_id: offer.provider_hotel_id,
        hotel_name: hotel?.name ?? offer.provider_hotel_id,
        room_type_id: offer.room_type_id,
        room_name: offer.room_name,
        board_name: offer.board_name ?? null,
        refundable_tag: offer.refundable_tag ?? null,
        currency: offer.currency,
        nightly_amount: offer.nightly_amount,
        total_amount: offer.total_amount,
        source_type: "liteapi",
        confidence: args.confidence,
        fetched_at: args.offerSnapshot.fetched_at,
        expires_at: args.offerSnapshot.expires_at,
        search_snapshot_id: args.searchSnapshot.id,
        offer_snapshot_id: args.offerSnapshot.id,
        address: hotel?.address ?? null,
        star_rating: hotel?.star_rating ?? null,
        guest_rating: hotel?.guest_rating ?? null,
        review_count: hotel?.review_count ?? null,
        distance_from_anchor_km: hotel?.distance_from_anchor_km ?? null,
      } satisfies StayHotelRateOption;
    })
    .sort(compareStayOptions);
}

function compareStayOptions(
  left: StayHotelRateOption,
  right: StayHotelRateOption,
): number {
  const nightlyLeft = left.nightly_amount ?? Number.POSITIVE_INFINITY;
  const nightlyRight = right.nightly_amount ?? Number.POSITIVE_INFINITY;
  if (nightlyLeft !== nightlyRight) return nightlyLeft - nightlyRight;

  const totalLeft = left.total_amount ?? Number.POSITIVE_INFINITY;
  const totalRight = right.total_amount ?? Number.POSITIVE_INFINITY;
  if (totalLeft !== totalRight) return totalLeft - totalRight;

  const hotelDiff = left.provider_hotel_id.localeCompare(right.provider_hotel_id);
  if (hotelDiff !== 0) return hotelDiff;
  return left.room_type_id.localeCompare(right.room_type_id);
}

function buildOccupancies(
  travellers: TravellerComposition,
): HotelRateSearchInput["occupancies"] {
  const adults = Math.max(1, Math.trunc(travellers.adults));
  const childrenAges = Array.isArray(travellers.children_ages)
    ? [...travellers.children_ages]
        .map((age) => Math.max(0, Math.trunc(age)))
        .sort((left, right) => left - right)
    : [];
  const requestedRooms = Math.max(1, Math.trunc(travellers.rooms ?? 1));
  const roomCount = Math.max(1, Math.min(requestedRooms, adults));

  const occupancies: HotelRateSearchInput["occupancies"] = Array.from(
    { length: roomCount },
    () => ({
      adults: 0,
      children_ages: [],
    }),
  );

  for (let index = 0; index < adults; index += 1) {
    occupancies[index % roomCount].adults += 1;
  }
  for (let index = 0; index < childrenAges.length; index += 1) {
    occupancies[index % roomCount].children_ages.push(childrenAges[index]);
  }
  return occupancies;
}

function buildSearchQueryKey(input: HotelSearchInput): string {
  const payload = {
    provider: "liteapi",
    region: input.region.trim().toLowerCase(),
    node_id: input.node_id.trim(),
    city_name: input.anchor
      ? null
      : (input.city_name?.trim().toLowerCase() ?? null),
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
  const digest = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
  return `liteapi_search_${digest}`;
}

function buildBlockKey(block: StayBlock): string {
  return `${block.nodeId}:${block.startDay}:${block.endDay}`;
}

function unknownPlan(
  block: StayBlock,
  blockKey: string,
  reason: HotelUnavailableReason,
  ids: {
    searchSnapshotId: string | null;
    offerSnapshotId: string | null;
    lastCheckedAt?: number | null;
    expiresAt?: number | null;
  },
): StayHotelRatePlan {
  return {
    blockKey,
    nodeId: block.nodeId,
    nodeName: block.nodeName,
    startDay: block.startDay,
    endDay: block.endDay,
    nights: block.nights,
    status: "unknown",
    unavailableReason: reason,
    options: [],
    searchSnapshotId: ids.searchSnapshotId,
    offerSnapshotId: ids.offerSnapshotId,
    lastCheckedAt: ids.lastCheckedAt ?? null,
    expiresAt: ids.expiresAt ?? null,
  };
}

function mapProviderFailure(error: unknown, cityName: string): {
  reason: HotelUnavailableReason;
  warning: string;
} {
  if (error instanceof ProviderDisabledError) {
    return {
      reason: "provider_disabled",
      warning: `LiteAPI is disabled; hotel rates are unavailable for ${cityName}.`,
    };
  }
  if (error instanceof ProviderTimeoutError) {
    return {
      reason: "provider_timeout",
      warning: `LiteAPI timed out while loading hotel rates for ${cityName}.`,
    };
  }
  if (error instanceof ProviderResponseError) {
    return {
      reason: "provider_error",
      warning: `LiteAPI failed while loading hotel rates for ${cityName}: ${error.code}.`,
    };
  }
  return {
    reason: "provider_error",
    warning: `LiteAPI failed while loading hotel rates for ${cityName}.`,
  };
}

function hasSearchResults(snapshot: HotelSearchSnapshot | null): boolean {
  return Boolean(snapshot && Array.isArray(snapshot.results) && snapshot.results.length > 0);
}

function hasOfferResults(snapshot: HotelOfferSnapshot | null): boolean {
  return Boolean(snapshot && Array.isArray(snapshot.offers) && snapshot.offers.length > 0);
}

function isFreshSnapshot(
  snapshot: { expires_at: number } | null,
  nowMs: number,
): boolean {
  if (!snapshot) return false;
  if (!Number.isFinite(snapshot.expires_at)) return false;
  return snapshot.expires_at > nowMs;
}

function dedupeWarnings(warnings: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const warning of warnings) {
    const trimmed = warning.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function addDaysToLocalDate(
  dateString: string,
  daysToAdd: number,
): LocalDateString | null {
  const dateValue = parseLocalDate(dateString);
  if (dateValue === null) return null;
  const date = new Date(dateValue);
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return date.toISOString().slice(0, 10);
}

function parseLocalDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return utc;
}
