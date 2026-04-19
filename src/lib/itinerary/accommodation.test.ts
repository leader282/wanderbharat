import assert from "node:assert/strict";
import test from "node:test";

import type { Accommodation, ItineraryDay } from "@/types/domain";
import { planAccommodations } from "@/lib/itinerary/accommodation";

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
