import assert from "node:assert/strict";
import test from "node:test";

import type { GenerateItineraryInput, ItineraryDay } from "@/types/domain";
import {
  insufficientNodes,
  noFeasibleRoute,
  validateBudget,
  validateDayPlan,
  validateInput,
} from "@/lib/itinerary/constraints";
import { getTravelStyleConfig } from "@/lib/config/travelStyle";

const balanced = getTravelStyleConfig("balanced");

function makeInput(
  overrides: Partial<GenerateItineraryInput> = {},
): GenerateItineraryInput {
  return {
    region: "rajasthan",
    start_node: "node_jaipur",
    days: 3,
    preferences: {
      travel_style: "balanced",
      budget: { min: 1000, max: 50000 },
    },
    ...overrides,
  };
}

function makeDay(overrides: Partial<ItineraryDay> = {}): ItineraryDay {
  return {
    day_index: 0,
    base_node_id: "node_jaipur",
    base_node_name: "Jaipur",
    activities: [],
    total_activity_hours: 4,
    total_travel_hours: 2,
    ...overrides,
  };
}

// ------------------------- validateInput ------------------------------------

test("validateInput accepts a well-formed request", () => {
  assert.equal(validateInput(makeInput()), null);
});

test("validateInput rejects a blank region", () => {
  const err = validateInput(makeInput({ region: "   " }));
  assert.ok(err);
  assert.equal(err?.reason, "invalid_input");
  assert.match(err!.message, /region/i);
});

test("validateInput rejects a missing start node", () => {
  const err = validateInput(makeInput({ start_node: "" }));
  assert.ok(err);
  assert.equal(err?.reason, "invalid_input");
  assert.match(err!.message, /start/i);
});

test("validateInput rejects an out-of-range day count", () => {
  for (const days of [0, -3, 31, Number.NaN, Number.POSITIVE_INFINITY]) {
    const err = validateInput(makeInput({ days }));
    assert.ok(err, `expected error for days=${days}`);
    assert.equal(err?.reason, "invalid_input");
  }
});

test("validateInput rejects a budget where max < min", () => {
  const err = validateInput(
    makeInput({
      preferences: {
        travel_style: "balanced",
        budget: { min: 5000, max: 1000 },
      },
    }),
  );
  assert.ok(err);
  assert.equal(err?.reason, "invalid_input");
  assert.match(err!.message, /budget/i);
});

test("validateInput rejects a negative budget min", () => {
  const err = validateInput(
    makeInput({
      preferences: {
        travel_style: "balanced",
        budget: { min: -100, max: 1000 },
      },
    }),
  );
  assert.ok(err);
  assert.equal(err?.reason, "invalid_input");
});

// ------------------------- validateDayPlan ----------------------------------

test("validateDayPlan accepts a plan within all caps", () => {
  const days = [
    makeDay({ day_index: 0, total_activity_hours: 4, total_travel_hours: 2 }),
    makeDay({ day_index: 1, total_activity_hours: 5, total_travel_hours: 3 }),
  ];
  assert.equal(validateDayPlan(days, balanced), null);
});

test("validateDayPlan flags days that exceed the road travel cap", () => {
  const days = [
    makeDay({
      day_index: 0,
      total_activity_hours: 1,
      total_travel_hours: balanced.maxTravelHoursPerDay + 2,
      travel: {
        from_node_id: "a",
        to_node_id: "b",
        transport_mode: "road",
        distance_km: 500,
        travel_time_hours: balanced.maxTravelHoursPerDay + 2,
      },
    }),
  ];
  const err = validateDayPlan(days, balanced, ["road"]);
  assert.ok(err);
  assert.equal(err?.reason, "travel_time_exceeded");
  assert.equal(
    (err!.details as { day_index: number }).day_index,
    0,
  );
  assert.equal(
    (err!.details as { mode: string }).mode,
    "road",
  );
});

test("validateDayPlan uses the per-mode cap when a flight day pushes over the road limit", () => {
  // For "balanced" maxTravelHoursPerDay = 6; flight factor is 0.8 → cap 4.8h.
  // 5h of flight should violate the flight cap even though the road cap permits 6h.
  const days = [
    makeDay({
      day_index: 0,
      total_activity_hours: 1,
      total_travel_hours: 5,
      travel: {
        from_node_id: "a",
        to_node_id: "b",
        transport_mode: "flight",
        distance_km: 1500,
        travel_time_hours: 5,
      },
    }),
  ];
  const err = validateDayPlan(days, balanced, ["flight"]);
  assert.ok(err);
  assert.equal(err?.reason, "travel_time_exceeded");
  assert.equal((err!.details as { mode: string }).mode, "flight");
});

test("validateDayPlan flags days that exceed the total time cap even with no travel", () => {
  const days = [
    makeDay({
      day_index: 0,
      total_activity_hours: balanced.maxTotalHoursPerDay + 1,
      total_travel_hours: 0,
    }),
  ];
  const err = validateDayPlan(days, balanced);
  assert.ok(err);
  assert.equal(err?.reason, "total_time_exceeded");
});

// ------------------------- validateBudget -----------------------------------

test("validateBudget accepts a cost inside the budget window", () => {
  assert.equal(validateBudget(20000, { min: 10000, max: 30000 }), null);
});

test("validateBudget reports under-spend", () => {
  const err = validateBudget(5000, { min: 10000, max: 30000 });
  assert.ok(err);
  assert.equal(err?.reason, "budget_too_low");
  assert.match(err!.message, /below.*minimum/i);
});

test("validateBudget reports over-spend", () => {
  const err = validateBudget(40000, { min: 10000, max: 30000 });
  assert.ok(err);
  assert.equal(err?.reason, "budget_exceeded");
  assert.match(err!.message, /exceeds.*maximum/i);
});

// ------------------------- factories ---------------------------------------

test("insufficientNodes returns a structured error with counts", () => {
  const err = insufficientNodes(2, 5);
  assert.equal(err.error, "constraint_violation");
  assert.equal(err.reason, "insufficient_nodes");
  assert.deepEqual(err.details, { found: 2, required: 5 });
});

test("noFeasibleRoute returns a structured error with a suggestion", () => {
  const err = noFeasibleRoute();
  assert.equal(err.reason, "no_feasible_route");
  assert.ok(err.suggestion);
});
