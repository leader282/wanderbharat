import assert from "node:assert/strict";
import test from "node:test";

import type { Itinerary } from "@/types/domain";
import { stripUndefinedDeep } from "@/lib/repositories/itineraryRepository";

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
