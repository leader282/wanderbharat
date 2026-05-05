import assert from "node:assert/strict";
import test from "node:test";

import type { Itinerary } from "@/types/domain";
import {
  computeLodgingSubtotal,
  computeNightlyAverage,
  integrateAccommodationPlanIntoItinerary,
} from "@/lib/itinerary/accommodationBudget";

function makeItinerary(): Itinerary {
  return {
    id: "it_test",
    user_id: null,
    region: "rajasthan",
    start_node: "node_jaipur",
    end_node: "node_udaipur",
    days: 3,
    preferences: {
      travel_style: "balanced",
      budget: { min: 0, max: 999999, currency: "INR" },
      travellers: { adults: 2, children: 0 },
      transport_modes: ["road"],
      accommodation_preference: "midrange",
    },
    nodes: ["node_jaipur", "node_udaipur"],
    day_plan: [
      {
        day_index: 0,
        base_node_id: "node_jaipur",
        base_node_name: "Jaipur",
        activities: [],
        total_activity_hours: 4,
        total_travel_hours: 0,
      },
      {
        day_index: 1,
        base_node_id: "node_udaipur",
        base_node_name: "Udaipur",
        travel: {
          from_node_id: "node_jaipur",
          to_node_id: "node_udaipur",
          transport_mode: "road",
          distance_km: 390,
          travel_time_hours: 7,
        },
        activities: [],
        total_activity_hours: 3,
        total_travel_hours: 7,
      },
      {
        day_index: 2,
        base_node_id: "node_udaipur",
        base_node_name: "Udaipur",
        activities: [],
        total_activity_hours: 5,
        total_travel_hours: 0,
      },
    ],
    stays: [],
    estimated_cost: 3500,
    budget_breakdown: {
      line_items: [
        {
          id: "travel_1",
          day_index: 1,
          kind: "travel",
          label: "Jaipur to Udaipur by Road",
          amount: 1500,
        },
      ],
    },
    score: 0.8,
    created_at: 1700000000000,
  };
}

test("accommodation budget helpers compute lodging totals deterministically", () => {
  const stays = [
    {
      nodeId: "node_jaipur",
      startDay: 0,
      endDay: 0,
      nights: 1,
      accommodationId: "acc_jaipur",
      nightlyCost: 2200,
      totalCost: 2200,
    },
    {
      nodeId: "node_udaipur",
      startDay: 1,
      endDay: 2,
      nights: 2,
      accommodationId: "acc_udaipur",
      nightlyCost: 3000,
      totalCost: 6000,
    },
  ];

  assert.equal(computeLodgingSubtotal(stays), 8200);
  assert.equal(computeNightlyAverage(stays), 2733.33);
});

test("integrateAccommodationPlanIntoItinerary rewrites budget totals and stores stay assignments", () => {
  const itinerary = integrateAccommodationPlanIntoItinerary({
    itinerary: makeItinerary(),
    stays: [
      {
        nodeId: "node_jaipur",
        startDay: 0,
        endDay: 0,
        nights: 1,
        accommodationId: "acc_jaipur",
        nightlyCost: 2200,
        totalCost: 2200,
      },
      {
        nodeId: "node_udaipur",
        startDay: 1,
        endDay: 2,
        nights: 2,
        accommodationId: "acc_udaipur",
        nightlyCost: 3000,
        totalCost: 6000,
      },
    ],
    warnings: [
      "Only over-budget accommodations were available in Udaipur; selected the best deterministic fallback.",
    ],
    requestedBudget: { min: 0, max: 999999, currency: "INR" },
  });

  assert.equal(itinerary.estimated_cost, 9700);
  assert.equal(itinerary.preferences.budget.max, 999999);
  assert.equal(itinerary.budget_breakdown?.lodgingSubtotal, 8200);
  assert.equal(itinerary.budget_breakdown?.travelSubtotal, 1500);
  assert.equal(itinerary.budget_breakdown?.nightlyAverage, 2733.33);
  assert.equal(itinerary.budget_breakdown?.totalTripCost, 9700);
  assert.equal(itinerary.budget_breakdown?.requestedBudget?.currency, "INR");
  assert.equal(itinerary.budget_breakdown?.recommendedBudget?.min, 9700);
  assert.equal(itinerary.stays.length, 2);
  assert.deepEqual(itinerary.warnings, [
    "Only over-budget accommodations were available in Udaipur; selected the best deterministic fallback.",
  ]);
});

test("integrateAccommodationPlanIntoItinerary preserves attraction subtotals and confidence counters", () => {
  const base = makeItinerary();
  base.budget_breakdown = {
    line_items: [
      {
        id: "travel_1",
        day_index: 1,
        kind: "travel",
        label: "Jaipur to Udaipur by Road",
        amount: 1500,
      },
      {
        id: "attraction_1",
        day_index: 2,
        kind: "attraction",
        label: "City Palace admission (estimated)",
        amount: 400,
      },
    ],
    attractionSubtotal: 400,
    verifiedAttractionCostsCount: 1,
    estimatedAttractionCostsCount: 1,
    unknownAttractionCostsCount: 2,
  };

  const itinerary = integrateAccommodationPlanIntoItinerary({
    itinerary: base,
    stays: [
      {
        nodeId: "node_jaipur",
        startDay: 0,
        endDay: 0,
        nights: 1,
        accommodationId: "acc_jaipur",
        nightlyCost: 2200,
        totalCost: 2200,
      },
      {
        nodeId: "node_udaipur",
        startDay: 1,
        endDay: 2,
        nights: 2,
        accommodationId: "acc_udaipur",
        nightlyCost: 3000,
        totalCost: 6000,
      },
    ],
    requestedBudget: { min: 0, max: 999999, currency: "INR" },
  });

  assert.equal(itinerary.budget_breakdown?.attractionSubtotal, 400);
  assert.equal(itinerary.budget_breakdown?.verifiedAttractionCostsCount, 1);
  assert.equal(itinerary.budget_breakdown?.estimatedAttractionCostsCount, 1);
  assert.equal(itinerary.budget_breakdown?.unknownAttractionCostsCount, 2);
  assert.equal(itinerary.estimated_cost, 10100);
});

test("integrateAccommodationPlanIntoItinerary marks lodging state from LiteAPI-backed stays", () => {
  const itinerary = integrateAccommodationPlanIntoItinerary({
    itinerary: makeItinerary(),
    stays: [
      {
        nodeId: "node_jaipur",
        startDay: 0,
        endDay: 0,
        nights: 1,
        accommodationId: null,
        nightlyCost: 2800,
        totalCost: 2800,
        hotelRateStatus: "live",
        hotelRateLastCheckedAt: 1_700_000_000_000,
        hotelSearchSnapshotId: "search_1",
        hotelOfferSnapshotId: "offer_1",
        hotelRateOptions: [
          {
            provider: "liteapi",
            provider_hotel_id: "h_1",
            hotel_name: "Amber Palace",
            room_type_id: "r_1",
            room_name: "Deluxe",
            currency: "INR",
            nightly_amount: 2800,
            total_amount: 2800,
            source_type: "liteapi",
            confidence: "live",
            search_snapshot_id: "search_1",
            offer_snapshot_id: "offer_1",
            fetched_at: 1_700_000_000_000,
          },
        ],
        selectedHotelRateOptionIndex: 0,
      },
      {
        nodeId: "node_udaipur",
        startDay: 1,
        endDay: 2,
        nights: 2,
        accommodationId: null,
        nightlyCost: 3100,
        totalCost: 6200,
        hotelRateStatus: "cached",
        hotelRateLastCheckedAt: 1_700_000_100_000,
        hotelSearchSnapshotId: "search_2",
        hotelOfferSnapshotId: "offer_2",
        hotelRateOptions: [
          {
            provider: "liteapi",
            provider_hotel_id: "h_2",
            hotel_name: "City Suites",
            room_type_id: "r_2",
            room_name: "Premium",
            currency: "INR",
            nightly_amount: 3100,
            total_amount: 6200,
            source_type: "liteapi",
            confidence: "cached",
            search_snapshot_id: "search_2",
            offer_snapshot_id: "offer_2",
            fetched_at: 1_700_000_100_000,
          },
        ],
        selectedHotelRateOptionIndex: 0,
      },
    ],
    requestedBudget: { min: 0, max: 999999, currency: "INR" },
  });

  assert.equal(itinerary.budget_breakdown?.lodgingRateState, "lodging_live");
  assert.equal(itinerary.budget_breakdown?.unknownLodgingStaysCount, 0);
  assert.equal(itinerary.budget_breakdown?.lodgingLastCheckedAt, 1_700_000_100_000);
  const stayLine = itinerary.budget_breakdown?.line_items.find(
    (item) => item.kind === "stay",
  );
  assert.equal(stayLine?.provenance?.source_type, "liteapi");
});

test("integrateAccommodationPlanIntoItinerary normalises unassigned zero-cost stays to unknown", () => {
  const itinerary = integrateAccommodationPlanIntoItinerary({
    itinerary: makeItinerary(),
    stays: [
      {
        nodeId: "node_jaipur",
        startDay: 0,
        endDay: 0,
        nights: 1,
        accommodationId: null,
        nightlyCost: 0,
        totalCost: 0,
      },
    ],
    requestedBudget: { min: 0, max: 999999, currency: "INR" },
  });

  assert.equal(itinerary.stays[0]?.nightlyCost, null);
  assert.equal(itinerary.stays[0]?.totalCost, null);
  assert.equal(itinerary.budget_breakdown?.lodgingSubtotal, 0);
  assert.equal(itinerary.budget_breakdown?.unknownLodgingStaysCount, 1);
});
