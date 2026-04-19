import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBudgetAdjustmentPreview,
  type BudgetAdjustmentImpact,
} from "@/lib/itinerary/budgetAdjustmentPreview";
import type { Itinerary, ItineraryDay } from "@/types/domain";

function makeDay(
  day_index: number,
  base_node_id: string,
  base_node_name: string,
  activityCount: number,
  total_activity_hours: number,
  travel?: ItineraryDay["travel"],
): ItineraryDay {
  return {
    day_index,
    base_node_id,
    base_node_name,
    activities: Array.from({ length: activityCount }, (_, index) => ({
      node_id: `${base_node_id}_activity_${day_index}_${index}`,
      name: `${base_node_name} activity ${index + 1}`,
      type: "attraction",
      duration_hours: Number((total_activity_hours / Math.max(1, activityCount)).toFixed(2)),
      tags: [],
    })),
    total_activity_hours,
    total_travel_hours: travel?.travel_time_hours ?? 0,
    travel,
  };
}

function makeItinerary(overrides: Partial<Itinerary> = {}): Itinerary {
  return {
    id: "it_test",
    user_id: null,
    region: "test-region",
    start_node: "jaipur",
    end_node: "jaipur",
    days: 4,
    preferences: {
      travel_style: "balanced",
      budget: { min: 0, max: 50000, currency: "INR" },
      travellers: { adults: 2, children: 0 },
      transport_modes: ["road"],
    },
    nodes: ["jaipur", "udaipur", "jaipur"],
    day_plan: [
      makeDay(0, "jaipur", "Jaipur", 3, 6),
      makeDay(1, "jaipur", "Jaipur", 2, 4),
      makeDay(
        2,
        "udaipur",
        "Udaipur",
        2,
        5,
        {
          from_node_id: "jaipur",
          to_node_id: "udaipur",
          transport_mode: "road",
          distance_km: 390,
          travel_time_hours: 6,
        },
      ),
      makeDay(3, "udaipur", "Udaipur", 1, 2),
    ],
    stays: [
      {
        nodeId: "jaipur",
        startDay: 0,
        endDay: 1,
        nights: 2,
        accommodationId: "acc_jaipur",
        nightlyCost: 6000,
        totalCost: 12000,
      },
      {
        nodeId: "udaipur",
        startDay: 2,
        endDay: 3,
        nights: 2,
        accommodationId: "acc_udaipur",
        nightlyCost: 5000,
        totalCost: 10000,
      },
    ],
    estimated_cost: 32000,
    budget_breakdown: {
      line_items: [],
      lodgingSubtotal: 22000,
      nightlyAverage: 5500,
      totalTripCost: 32000,
      requestedBudget: { min: 0, max: 50000, currency: "INR" },
      recommendedBudget: { min: 32000, max: 37000, currency: "INR" },
    },
    score: 0.82,
    created_at: 1700000000000,
    ...overrides,
  };
}

function findImpact(
  impacts: BudgetAdjustmentImpact[],
  id: BudgetAdjustmentImpact["id"],
): BudgetAdjustmentImpact {
  const match = impacts.find((impact) => impact.id === id);
  assert.ok(match, `Expected impact ${id} to be present.`);
  return match;
}

test("buildBudgetAdjustmentPreview highlights likely downgrades from a lower budget", () => {
  const current = makeItinerary();
  const proposed = makeItinerary({
    preferences: {
      ...current.preferences,
      budget: { min: 0, max: 30000, currency: "INR" },
    },
    nodes: ["jaipur"],
    day_plan: [
      makeDay(0, "jaipur", "Jaipur", 2, 4),
      makeDay(1, "jaipur", "Jaipur", 2, 4),
      makeDay(2, "jaipur", "Jaipur", 1, 3),
      makeDay(3, "jaipur", "Jaipur", 1, 2),
    ],
    stays: [
      {
        nodeId: "jaipur",
        startDay: 0,
        endDay: 3,
        nights: 4,
        accommodationId: "acc_jaipur_budget",
        nightlyCost: 3500,
        totalCost: 14000,
      },
    ],
    estimated_cost: 24000,
    budget_breakdown: {
      line_items: [],
      lodgingSubtotal: 14000,
      nightlyAverage: 3500,
      totalTripCost: 24000,
      requestedBudget: { min: 0, max: 30000, currency: "INR" },
      recommendedBudget: { min: 24000, max: 28000, currency: "INR" },
    },
  });

  const preview = buildBudgetAdjustmentPreview({
    current,
    proposed,
    requestedBudget: 30000,
  });

  assert.equal(preview.direction, "downgrade");
  assert.match(preview.summary, /lower budget/i);
  assert.match(findImpact(preview.impacts, "stays").detail, /average stay spend/i);
  assert.match(findImpact(preview.impacts, "cities").detail, /Drops Udaipur/);
  assert.match(findImpact(preview.impacts, "days").detail, /More time in Jaipur/);
  assert.match(findImpact(preview.impacts, "activities").detail, /activity time shifts/i);
  assert.match(findImpact(preview.impacts, "travel").detail, /travel changes/i);
});

test("buildBudgetAdjustmentPreview falls back to a route-shape note when nothing changes", () => {
  const current = makeItinerary();
  const preview = buildBudgetAdjustmentPreview({
    current,
    proposed: current,
    requestedBudget: current.preferences.budget.max,
  });

  assert.equal(preview.direction, "same");
  assert.equal(preview.impacts.length, 1);
  assert.equal(preview.impacts[0]?.id, "route");
});
