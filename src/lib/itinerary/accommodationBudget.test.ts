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
