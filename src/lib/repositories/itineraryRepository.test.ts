import assert from "node:assert/strict";
import test from "node:test";

import type { Itinerary } from "@/types/domain";
import {
  normaliseStoredItinerary,
  stripUndefinedDeep,
} from "@/lib/repositories/itineraryRepository";

test("stripUndefinedDeep removes Firestore-invalid undefined fields", () => {
  const itinerary: Itinerary = {
    id: "it_test",
    user_id: null,
    region: "rajasthan",
    start_node: "node_ajmer",
    end_node: "node_ajmer",
    days: 2,
    preferences: {
      travel_style: "balanced",
      budget: { min: 15000, max: 45000, currency: "INR" },
      travellers: { adults: 1, children: 0 },
      interests: ["heritage"],
      transport_modes: ["road"],
    },
    nodes: ["node_ajmer"],
    day_plan: [
      {
        day_index: 0,
        base_node_id: "node_ajmer",
        base_node_name: "Ajmer",
        travel: undefined,
        activities: [
          {
            node_id: "node_ajmer",
            name: "Explore Ajmer",
            type: "city",
            duration_hours: 3,
            tags: ["heritage"],
            description: undefined,
          },
        ],
        total_activity_hours: 3,
        total_travel_hours: 0,
      },
    ],
    stays: [],
    estimated_cost: 16000,
    score: 0.9,
    created_at: 1700000000000,
  };

  const cleaned = stripUndefinedDeep(itinerary);

  assert.equal(cleaned.user_id, null);
  assert.equal("travel" in cleaned.day_plan[0], false);
  assert.equal("description" in cleaned.day_plan[0].activities[0], false);
  assert.deepEqual(cleaned.day_plan[0], {
    day_index: 0,
    base_node_id: "node_ajmer",
    base_node_name: "Ajmer",
    activities: [
      {
        node_id: "node_ajmer",
        name: "Explore Ajmer",
        type: "city",
        duration_hours: 3,
        tags: ["heritage"],
      },
    ],
    total_activity_hours: 3,
    total_travel_hours: 0,
  });
});

test("normaliseStoredItinerary backfills older saved itineraries for the UI", () => {
  const raw = {
    id: "it_old",
    user_id: null,
    region: "rajasthan",
    start_node: "node_ajmer",
    end_node: "node_udaipur",
    days: 2,
    preferences: {
      travel_style: "balanced",
      budget: { max: 42000, currency: "INR" },
      accommodationPreference: "midrange",
    },
    day_plan: [
      {
        day_index: 0,
        base_node_id: "node_ajmer",
        base_node_name: "Ajmer",
        activities: [],
        total_activity_hours: 4,
        total_travel_hours: 0,
      },
      {
        day_index: 1,
        base_node_id: "node_udaipur",
        base_node_name: "Udaipur",
        activities: [],
        total_activity_hours: 4,
        total_travel_hours: 0,
      },
    ],
    estimated_cost: 18000,
    score: 0.75,
    created_at: 1700000000000,
  } as unknown as Itinerary;

  const normalised = normaliseStoredItinerary(raw);

  assert.deepEqual(normalised.nodes, ["node_ajmer", "node_udaipur"]);
  assert.deepEqual(normalised.stays, []);
  assert.equal(normalised.preferences.travellers.adults, 1);
  assert.equal(normalised.preferences.travellers.children, 0);
  assert.equal(normalised.preferences.budget.min, 0);
  assert.equal(normalised.preferences.budget.max, 42000);
  assert.equal(normalised.preferences.accommodation_preference, "midrange");
  assert.equal(normalised.budget_breakdown?.requestedBudget?.max, 42000);
  assert.equal(normalised.budget_breakdown?.totalTripCost, 18000);
  assert.equal(normalised.budget_breakdown?.line_items.length, 0);
});

test("normaliseStoredItinerary dedupes warnings and repairs partial budget metadata", () => {
  const raw = {
    id: "it_partial",
    user_id: "uid_test",
    region: "rajasthan",
    start_node: "node_ajmer",
    end_node: "node_ajmer",
    days: 1,
    preferences: {
      travel_style: "balanced",
      budget: { min: 0, max: 25000, currency: "INR" },
      travellers: { adults: 2, children: 1 },
    },
    nodes: ["node_ajmer"],
    day_plan: [
      {
        day_index: 0,
        base_node_id: "node_ajmer",
        base_node_name: "Ajmer",
        activities: [],
        total_activity_hours: 4,
        total_travel_hours: 0,
      },
    ],
    stays: [],
    estimated_cost: 12000,
    budget_breakdown: {
      line_items: [],
      requestedBudget: { max: 25000, currency: "INR" },
      warnings: ["  Budget detail pending  ", "Budget detail pending"],
    },
    warnings: ["Budget detail pending", "  "],
    score: 0.81,
    created_at: 1700000000000,
  } as unknown as Itinerary;

  const normalised = normaliseStoredItinerary(raw);

  assert.equal(normalised.budget_breakdown?.requestedBudget?.min, 0);
  assert.equal(normalised.budget_breakdown?.requestedBudget?.max, 25000);
  assert.ok(normalised.budget_breakdown?.recommendedBudget);
  assert.deepEqual(normalised.budget_breakdown?.warnings, [
    "Budget detail pending",
  ]);
  assert.deepEqual(normalised.warnings, ["Budget detail pending"]);
});
