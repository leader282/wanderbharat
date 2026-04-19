import assert from "node:assert/strict";
import test from "node:test";

import type { Itinerary } from "@/types/domain";
import {
  getDisplayRouteStops,
  getDistinctDestinationCount,
  getRouteEndpoints,
} from "@/lib/itinerary/routeDisplay";

function makeItinerary(
  overrides: Partial<Itinerary> & Pick<Itinerary, "nodes" | "day_plan">,
): Itinerary {
  return {
    id: "it_test",
    user_id: null,
    region: "test-region",
    start_node: "node_start",
    end_node: "node_start",
    days: overrides.day_plan.length,
    preferences: {
      travel_style: "balanced",
      budget: { min: 0, max: 20000, currency: "INR" },
      transport_modes: ["road"],
    },
    stays: [],
    estimated_cost: 12000,
    score: 0.7,
    created_at: 1700000000000,
    ...overrides,
  };
}

test("getDisplayRouteStops reconstructs round trips from the stored node sequence", () => {
  const itinerary = makeItinerary({
    start_node: "node_jaipur",
    end_node: "node_jaipur",
    nodes: ["node_jaipur", "node_ajmer", "node_jaipur"],
    day_plan: [
      {
        day_index: 0,
        base_node_id: "node_ajmer",
        base_node_name: "Ajmer",
        travel: {
          from_node_id: "node_jaipur",
          to_node_id: "node_ajmer",
          transport_mode: "road",
          distance_km: 135,
          travel_time_hours: 2.5,
        },
        activities: [],
        total_activity_hours: 6,
        total_travel_hours: 2.5,
      },
      {
        day_index: 1,
        base_node_id: "node_jaipur",
        base_node_name: "Jaipur",
        travel: {
          from_node_id: "node_ajmer",
          to_node_id: "node_jaipur",
          transport_mode: "road",
          distance_km: 135,
          travel_time_hours: 2.5,
        },
        activities: [],
        total_activity_hours: 0,
        total_travel_hours: 2.5,
      },
    ],
  });

  assert.deepEqual(
    getDisplayRouteStops(itinerary).map((stop) => stop.name),
    ["Jaipur", "Ajmer", "Jaipur"],
  );
  assert.deepEqual(getRouteEndpoints(itinerary), {
    startName: "Jaipur",
    endName: "Jaipur",
  });
  assert.equal(getDistinctDestinationCount(itinerary), 2);
});

test("getDisplayRouteStops falls back to compressed day-plan bases when node names are missing", () => {
  const itinerary = makeItinerary({
    nodes: ["node_unknown"],
    day_plan: [
      {
        day_index: 0,
        base_node_id: "node_jaipur",
        base_node_name: "Jaipur",
        activities: [],
        total_activity_hours: 6,
        total_travel_hours: 0,
      },
      {
        day_index: 1,
        base_node_id: "node_jaipur",
        base_node_name: "Jaipur",
        activities: [],
        total_activity_hours: 5,
        total_travel_hours: 0,
      },
      {
        day_index: 2,
        base_node_id: "node_ajmer",
        base_node_name: "Ajmer",
        travel: {
          from_node_id: "node_jaipur",
          to_node_id: "node_ajmer",
          transport_mode: "road",
          distance_km: 135,
          travel_time_hours: 2.5,
        },
        activities: [],
        total_activity_hours: 4,
        total_travel_hours: 2.5,
      },
    ],
  });

  assert.deepEqual(
    getDisplayRouteStops(itinerary).map((stop) => stop.name),
    ["Jaipur", "Ajmer"],
  );
  assert.deepEqual(getRouteEndpoints(itinerary), {
    startName: "Jaipur",
    endName: "Ajmer",
  });
});
