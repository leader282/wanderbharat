import assert from "node:assert/strict";
import test from "node:test";

import type { Accommodation, ItineraryDay } from "@/types/domain";
import { planAccommodations } from "@/lib/itinerary/accommodation";
import type { HotelDataProvider } from "@/lib/providers/hotels/HotelDataProvider";
import {
  ProviderDisabledError,
  ProviderResponseError,
  ProviderTimeoutError,
} from "@/lib/providers/hotels/providerErrors";
import type {
  HotelOfferSnapshot,
  HotelSearchSnapshot,
  HotelSearchResult,
} from "@/lib/providers/hotels/types";

function makeDay(
  day_index: number,
  base_node_id: string,
  base_node_name: string,
): ItineraryDay {
  return {
    day_index,
    base_node_id,
    base_node_name,
    activities: [],
    total_activity_hours: 0,
    total_travel_hours: 0,
  };
}

function makeAccommodation(
  overrides: Partial<Accommodation> = {},
): Accommodation {
  return {
    id: "acc_test",
    regionId: "test-region",
    nodeId: "node_jaipur",
    name: "Test Stay",
    category: "midrange",
    pricePerNight: 2600,
    currency: "INR",
    rating: 4.2,
    reviewCount: 900,
    amenities: ["wifi", "breakfast", "air_conditioning"],
    location: { lat: 26.9, lng: 75.8 },
    distanceFromCenterKm: 1.2,
    active: true,
    ...overrides,
  };
}

test("planAccommodations is deterministic and keeps repeated city blocks separate", async () => {
  const days = [
    makeDay(0, "node_jaipur", "Jaipur"),
    makeDay(1, "node_jaipur", "Jaipur"),
    makeDay(2, "node_udaipur", "Udaipur"),
    makeDay(3, "node_jaipur", "Jaipur"),
  ];

  const getByNode = async (nodeId: string): Promise<Accommodation[]> => {
    if (nodeId === "node_jaipur") {
      return [
        makeAccommodation({
          id: "acc_jaipur_budget",
          nodeId,
          category: "budget",
          pricePerNight: 2100,
          rating: 4.1,
          reviewCount: 1200,
          amenities: ["wifi", "breakfast"],
          distanceFromCenterKm: 1.8,
        }),
        makeAccommodation({
          id: "acc_jaipur_heritage",
          nodeId,
          category: "heritage",
          pricePerNight: 2600,
          rating: 4.7,
          reviewCount: 1800,
          amenities: [
            "wifi",
            "breakfast",
            "courtyard",
            "air_conditioning",
          ],
          distanceFromCenterKm: 0.6,
        }),
      ];
    }

    return [
      makeAccommodation({
        id: "acc_udaipur_mid",
        nodeId,
        name: "Udaipur Lakeside Residency",
        category: "midrange",
        pricePerNight: 3000,
        rating: 4.4,
        reviewCount: 1100,
        distanceFromCenterKm: 0.8,
      }),
    ];
  };

  const first = await planAccommodations(
    {
      days,
      budget: { min: 0, max: 30000, currency: "INR" },
      travellers: { adults: 2, children: 0 },
      travelStyle: "balanced",
      accommodationPreference: "midrange",
      interests: ["heritage"],
    },
    { getByNode },
  );
  const second = await planAccommodations(
    {
      days,
      budget: { min: 0, max: 30000, currency: "INR" },
      travellers: { adults: 2, children: 0 },
      travelStyle: "balanced",
      accommodationPreference: "midrange",
      interests: ["heritage"],
    },
    { getByNode },
  );

  assert.deepEqual(second, first);
  assert.deepEqual(
    first.stays.map((stay) => ({
      nodeId: stay.nodeId,
      startDay: stay.startDay,
      endDay: stay.endDay,
      nights: stay.nights,
      accommodationId: stay.accommodationId,
    })),
    [
      {
        nodeId: "node_jaipur",
        startDay: 0,
        endDay: 1,
        nights: 2,
        accommodationId: "acc_jaipur_budget",
      },
      {
        nodeId: "node_udaipur",
        startDay: 2,
        endDay: 2,
        nights: 1,
        accommodationId: "acc_udaipur_mid",
      },
      {
        nodeId: "node_jaipur",
        startDay: 3,
        endDay: 3,
        nights: 1,
        accommodationId: "acc_jaipur_budget",
      },
    ],
  );
  assert.deepEqual(first.warnings, []);
});

test("planAccommodations falls back to over-budget stays and null assignments gracefully", async () => {
  const result = await planAccommodations(
    {
      days: [
        makeDay(0, "node_ajmer", "Ajmer"),
        makeDay(1, "node_mount_abu", "Mount Abu"),
      ],
      budget: { min: 0, max: 3000, currency: "INR" },
      travellers: { adults: 2, children: 0 },
      travelStyle: "relaxed",
      accommodationPreference: "premium",
    },
    {
      getByNode: async (nodeId) => {
        if (nodeId === "node_ajmer") {
          return [
            makeAccommodation({
              id: "acc_ajmer_premium",
              nodeId,
              category: "premium",
              pricePerNight: 1800,
              rating: 4.4,
              reviewCount: 700,
              amenities: ["wifi", "breakfast", "spa"],
            }),
          ];
        }

        return [
          makeAccommodation({
            id: "acc_mount_abu_inactive",
            nodeId,
            category: "premium",
            active: false,
          }),
        ];
      },
    },
  );

  assert.deepEqual(
    result.stays.map((stay) => ({
      nodeId: stay.nodeId,
      accommodationId: stay.accommodationId,
      totalCost: stay.totalCost,
    })),
    [
      {
        nodeId: "node_ajmer",
        accommodationId: "acc_ajmer_premium",
        totalCost: 1800,
      },
      {
        nodeId: "node_mount_abu",
        accommodationId: null,
        totalCost: 0,
      },
    ],
  );
  assert.deepEqual(result.warnings, [
    "Only over-budget accommodations were available in Ajmer; selected the best deterministic fallback.",
    "No active accommodations matched the travel-style filters for Mount Abu.",
  ]);
});

test("planAccommodations filters out room mixes that cannot fit the traveller party", async () => {
  const result = await planAccommodations(
    {
      days: [makeDay(0, "node_jodhpur", "Jodhpur")],
      budget: { min: 0, max: 12000, currency: "INR" },
      travellers: { adults: 2, children: 2 },
      travelStyle: "balanced",
      accommodationPreference: "midrange",
    },
    {
      getByNode: async (nodeId) => [
        makeAccommodation({
          id: "acc_too_small",
          nodeId,
          name: "Compact Inn",
          category: "budget",
          pricePerNight: 1800,
          roomTypes: [
            {
              id: "compact-double",
              name: "Compact Double",
              pricePerNight: 1800,
              maxAdults: 2,
              maxChildren: 0,
              maxOccupancy: 2,
            },
          ],
        }),
        makeAccommodation({
          id: "acc_family",
          nodeId,
          name: "Family Courtyard",
          category: "midrange",
          pricePerNight: 3200,
          roomTypes: [
            {
              id: "family-suite",
              name: "Family Suite",
              pricePerNight: 3200,
              maxAdults: 2,
              maxChildren: 2,
              maxOccupancy: 4,
            },
          ],
        }),
      ],
    },
  );

  assert.equal(result.stays[0]?.accommodationId, "acc_family");
  assert.equal(result.stays[0]?.roomAllocation?.totalRooms, 1);
  assert.equal(result.stays[0]?.roomAllocation?.rooms[0]?.roomTypeName, "Family Suite");
  assert.deepEqual(result.warnings, []);
});

function makeHotel(
  id: string,
  name: string,
  distance = 1.2,
): HotelSearchResult {
  return {
    provider: "liteapi",
    provider_hotel_id: id,
    name,
    address: `${name}, Jaipur`,
    location: { lat: 26.9, lng: 75.8 },
    star_rating: 4.1,
    guest_rating: 4.3,
    review_count: 900,
    distance_from_anchor_km: distance,
  };
}

function makeSearchSnapshot(hotels: HotelSearchResult[]): HotelSearchSnapshot {
  return {
    id: "search_snapshot_test",
    provider: "liteapi",
    region: "rajasthan",
    node_id: "node_jaipur",
    city_name: "Jaipur",
    country_code: "IN",
    anchor: { lat: 26.9124, lng: 75.7873 },
    radius_km: 8,
    query_key: "search_query_test",
    result_count: hotels.length,
    results: hotels,
    fetched_at: 1_700_000_000_000,
    expires_at: 1_700_000_000_000 + 60 * 60 * 1000,
  };
}

function makeRatesSnapshot(args: {
  id?: string;
  hotelIds: string[];
  offers: Array<{ hotelId: string; roomId: string; total: number }>;
}): HotelOfferSnapshot {
  return {
    id: args.id ?? "rate_snapshot_test",
    cache_key: "cache_key_test",
    provider: "liteapi",
    region: "rajasthan",
    node_id: "node_jaipur",
    hotel_ids: args.hotelIds,
    checkin: "2026-06-10",
    checkout: "2026-06-12",
    nights: 2,
    currency: "INR",
    guest_nationality: "IN",
    occupancies: [{ adults: 2, children_ages: [] }],
    offers: args.offers.map((offer) => ({
      provider: "liteapi",
      provider_hotel_id: offer.hotelId,
      room_type_id: offer.roomId,
      room_name: "Deluxe Room",
      board_type: "BB",
      board_name: "Breakfast",
      total_amount: offer.total,
      nightly_amount: Number((offer.total / 2).toFixed(2)),
      currency: "INR",
      max_occupancy: 3,
      adult_count: 2,
      child_count: 0,
      refundable_tag: "refundable",
      provider_offer_id_hash: `${offer.hotelId}_${offer.roomId}`,
    })),
    min_total_amount:
      args.offers.length > 0
        ? Math.min(...args.offers.map((offer) => offer.total))
        : null,
    min_nightly_amount:
      args.offers.length > 0
        ? Number((Math.min(...args.offers.map((offer) => offer.total)) / 2).toFixed(2))
        : null,
    result_count: args.offers.length,
    status: args.offers.length > 0 ? "success" : "empty",
    fetched_at: 1_700_000_000_000,
    expires_at: 1_700_000_000_000 + 60 * 60 * 1000,
  };
}

test("planAccommodations attaches LiteAPI options and uses selected rates", async () => {
  let getByNodeCalls = 0;
  const provider: HotelDataProvider = {
    provider: "liteapi",
    searchHotels: async () => [
      makeHotel("h_1", "Amber Palace", 0.8),
      makeHotel("h_2", "Pink City Stay", 1.4),
      makeHotel("h_3", "City Suites", 1.8),
    ],
    searchRates: async () =>
      makeRatesSnapshot({
        hotelIds: ["h_1", "h_2", "h_3"],
        offers: [
          { hotelId: "h_1", roomId: "r_1", total: 5200 },
          { hotelId: "h_2", roomId: "r_2", total: 6000 },
          { hotelId: "h_3", roomId: "r_3", total: 6400 },
          { hotelId: "h_1", roomId: "r_4", total: 7000 },
          { hotelId: "h_2", roomId: "r_5", total: 7600 },
          { hotelId: "h_3", roomId: "r_6", total: 8200 },
        ],
      }),
  };

  const result = await planAccommodations(
    {
      days: [makeDay(0, "node_jaipur", "Jaipur"), makeDay(1, "node_jaipur", "Jaipur")],
      budget: { min: 0, max: 30000, currency: "INR" },
      travellers: { adults: 2, children: 0, rooms: 1, guest_nationality: "IN" },
      travelStyle: "balanced",
      tripStartDate: "2026-06-10",
      region: "rajasthan",
      cityLocationsByNodeId: { node_jaipur: { lat: 26.9124, lng: 75.7873 } },
    },
    {
      getByNode: async () => {
        getByNodeCalls += 1;
        return [];
      },
      hotelDataProvider: provider,
      maxHotelProviderCalls: 4,
      nowMs: () => 1_700_000_000_000,
    },
  );

  assert.equal(getByNodeCalls, 0);
  assert.equal(result.stays.length, 1);
  assert.equal(result.stays[0]?.hotelRateStatus, "live");
  assert.equal(result.stays[0]?.nightlyCost, 2600);
  assert.equal(result.stays[0]?.totalCost, 5200);
  assert.equal(result.stays[0]?.hotelRateOptions?.length, 5);
  assert.equal(result.stays[0]?.hotelRateOptions?.[0]?.hotel_name, "Amber Palace");
  assert.deepEqual(result.warnings, []);
});

test("planAccommodations continues with unknown stay when provider is disabled", async () => {
  const provider: HotelDataProvider = {
    provider: "liteapi",
    searchHotels: async () => {
      throw new ProviderDisabledError("disabled");
    },
    searchRates: async () => makeRatesSnapshot({ hotelIds: [], offers: [] }),
  };

  const result = await planAccommodations(
    {
      days: [makeDay(0, "node_jaipur", "Jaipur")],
      budget: { min: 0, max: 20000, currency: "INR" },
      travellers: { adults: 2, children: 0, rooms: 1, guest_nationality: "IN" },
      travelStyle: "balanced",
      tripStartDate: "2026-06-10",
      region: "rajasthan",
      cityLocationsByNodeId: { node_jaipur: { lat: 26.9124, lng: 75.7873 } },
    },
    {
      getByNode: async () => [],
      hotelDataProvider: provider,
      nowMs: () => 1_700_000_000_000,
    },
  );

  assert.equal(result.stays[0]?.nightlyCost, null);
  assert.equal(result.stays[0]?.totalCost, null);
  assert.equal(result.stays[0]?.hotelRateStatus, "unknown");
  assert.equal(result.stays[0]?.hotelRateUnavailableReason, "provider_disabled");
  assert.ok(result.warnings.some((warning) => warning.includes("disabled")));
});

test("planAccommodations continues with warning when provider returns an error", async () => {
  const provider: HotelDataProvider = {
    provider: "liteapi",
    searchHotels: async () => [makeHotel("h_1", "Amber Palace")],
    searchRates: async () => {
      throw new ProviderResponseError({
        code: "liteapi_http_500",
        endpoint: "/hotels/rates",
        status: 500,
        message: "upstream failed",
      });
    },
  };

  const result = await planAccommodations(
    {
      days: [makeDay(0, "node_jaipur", "Jaipur")],
      budget: { min: 0, max: 20000, currency: "INR" },
      travellers: { adults: 2, children: 0, rooms: 1, guest_nationality: "IN" },
      travelStyle: "balanced",
      tripStartDate: "2026-06-10",
      region: "rajasthan",
      cityLocationsByNodeId: { node_jaipur: { lat: 26.9124, lng: 75.7873 } },
    },
    {
      getByNode: async () => [],
      hotelDataProvider: provider,
      nowMs: () => 1_700_000_000_000,
    },
  );

  assert.equal(result.stays[0]?.nightlyCost, null);
  assert.equal(result.stays[0]?.hotelRateUnavailableReason, "provider_error");
  assert.ok(result.warnings.some((warning) => warning.includes("failed")));
});

test("planAccommodations continues with warning when provider times out", async () => {
  const provider: HotelDataProvider = {
    provider: "liteapi",
    searchHotels: async () => [makeHotel("h_1", "Amber Palace")],
    searchRates: async () => {
      throw new ProviderTimeoutError({
        endpoint: "/hotels/rates",
        timeoutMs: 5000,
      });
    },
  };

  const result = await planAccommodations(
    {
      days: [makeDay(0, "node_jaipur", "Jaipur")],
      budget: { min: 0, max: 20000, currency: "INR" },
      travellers: { adults: 2, children: 0, rooms: 1, guest_nationality: "IN" },
      travelStyle: "balanced",
      tripStartDate: "2026-06-10",
      region: "rajasthan",
      cityLocationsByNodeId: { node_jaipur: { lat: 26.9124, lng: 75.7873 } },
    },
    {
      getByNode: async () => [],
      hotelDataProvider: provider,
      nowMs: () => 1_700_000_000_000,
    },
  );

  assert.equal(result.stays[0]?.nightlyCost, null);
  assert.equal(result.stays[0]?.hotelRateUnavailableReason, "provider_timeout");
  assert.ok(result.warnings.some((warning) => warning.includes("timed out")));
});

test("planAccommodations continues with warning when LiteAPI returns no rates", async () => {
  const provider: HotelDataProvider = {
    provider: "liteapi",
    searchHotels: async () => [makeHotel("h_1", "Amber Palace")],
    searchRates: async () =>
      makeRatesSnapshot({
        hotelIds: ["h_1"],
        offers: [],
      }),
  };

  const result = await planAccommodations(
    {
      days: [makeDay(0, "node_jaipur", "Jaipur")],
      budget: { min: 0, max: 20000, currency: "INR" },
      travellers: { adults: 2, children: 0, rooms: 1, guest_nationality: "IN" },
      travelStyle: "balanced",
      tripStartDate: "2026-06-10",
      region: "rajasthan",
      cityLocationsByNodeId: { node_jaipur: { lat: 26.9124, lng: 75.7873 } },
    },
    {
      getByNode: async () => [],
      hotelDataProvider: provider,
      nowMs: () => 1_700_000_000_000,
    },
  );

  assert.equal(result.stays[0]?.nightlyCost, null);
  assert.equal(result.stays[0]?.hotelRateUnavailableReason, "no_rates");
  assert.ok(result.warnings.some((warning) => warning.includes("no rates")));
});

test("planAccommodations enforces the hotel provider call limit after stay blocks", async () => {
  let providerCalls = 0;
  const provider: HotelDataProvider = {
    provider: "liteapi",
    searchHotels: async () => {
      providerCalls += 1;
      return [makeHotel("h_1", "Amber Palace")];
    },
    searchRates: async () => {
      providerCalls += 1;
      return makeRatesSnapshot({
        hotelIds: ["h_1"],
        offers: [{ hotelId: "h_1", roomId: "r_1", total: 3000 }],
      });
    },
  };

  const result = await planAccommodations(
    {
      days: [
        makeDay(0, "node_jaipur", "Jaipur"),
        makeDay(1, "node_udaipur", "Udaipur"),
      ],
      budget: { min: 0, max: 40000, currency: "INR" },
      travellers: { adults: 2, children: 0, rooms: 1, guest_nationality: "IN" },
      travelStyle: "balanced",
      tripStartDate: "2026-06-10",
      region: "rajasthan",
      cityLocationsByNodeId: {
        node_jaipur: { lat: 26.9124, lng: 75.7873 },
        node_udaipur: { lat: 24.5854, lng: 73.7125 },
      },
    },
    {
      getByNode: async () => [],
      hotelDataProvider: provider,
      maxHotelProviderCalls: 2,
      nowMs: () => 1_700_000_000_000,
    },
  );

  assert.equal(providerCalls, 2);
  assert.equal(result.stays[0]?.hotelRateStatus, "live");
  assert.equal(result.stays[1]?.hotelRateStatus, "unknown");
  assert.equal(
    result.stays[1]?.hotelRateUnavailableReason,
    "call_limit_exceeded",
  );
});

test("planAccommodations reuses fresh cached hotel snapshots without provider calls", async () => {
  let providerCalls = 0;
  const hotels = [makeHotel("h_1", "Amber Palace")];
  const provider: HotelDataProvider = {
    provider: "liteapi",
    searchHotels: async () => {
      providerCalls += 1;
      return hotels;
    },
    searchRates: async () => {
      providerCalls += 1;
      return makeRatesSnapshot({
        hotelIds: ["h_1"],
        offers: [{ hotelId: "h_1", roomId: "r_1", total: 4200 }],
      });
    },
  };

  const result = await planAccommodations(
    {
      days: [makeDay(0, "node_jaipur", "Jaipur")],
      budget: { min: 0, max: 40000, currency: "INR" },
      travellers: { adults: 2, children: 0, rooms: 1, guest_nationality: "IN" },
      travelStyle: "balanced",
      tripStartDate: "2026-06-10",
      region: "rajasthan",
      cityLocationsByNodeId: { node_jaipur: { lat: 26.9124, lng: 75.7873 } },
    },
    {
      getByNode: async () => [],
      hotelDataProvider: provider,
      findLatestHotelSearchSnapshotByQueryKey: async () =>
        makeSearchSnapshot(hotels),
      findLatestHotelOfferSnapshotByCacheKey: async () =>
        makeRatesSnapshot({
          hotelIds: ["h_1"],
          offers: [{ hotelId: "h_1", roomId: "r_1", total: 4200 }],
        }),
      nowMs: () => 1_700_000_000_000,
    },
  );

  assert.equal(providerCalls, 0);
  assert.equal(result.stays[0]?.hotelRateStatus, "cached");
  assert.equal(result.stays[0]?.totalCost, 4200);
});

test("planAccommodations uses live rates even when snapshot persistence fails", async () => {
  const provider: HotelDataProvider = {
    provider: "liteapi",
    searchHotels: async () => [makeHotel("h_1", "Amber Palace")],
    searchRates: async () =>
      makeRatesSnapshot({
        hotelIds: ["h_1"],
        offers: [{ hotelId: "h_1", roomId: "r_1", total: 5200 }],
      }),
  };

  const result = await planAccommodations(
    {
      days: [makeDay(0, "node_jaipur", "Jaipur")],
      budget: { min: 0, max: 40000, currency: "INR" },
      travellers: { adults: 2, children: 0, rooms: 1, guest_nationality: "IN" },
      travelStyle: "balanced",
      tripStartDate: "2026-06-10",
      region: "rajasthan",
      cityLocationsByNodeId: { node_jaipur: { lat: 26.9124, lng: 75.7873 } },
    },
    {
      getByNode: async () => [],
      hotelDataProvider: provider,
      saveHotelSearchSnapshot: async () => {
        throw new Error("write failed");
      },
      saveHotelOfferSnapshot: async () => {
        throw new Error("write failed");
      },
      nowMs: () => 1_700_000_000_000,
    },
  );

  assert.equal(result.stays[0]?.hotelRateStatus, "live");
  assert.equal(result.stays[0]?.totalCost, 5200);
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("snapshot could not be persisted"),
    ),
  );
});
