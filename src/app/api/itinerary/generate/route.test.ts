import assert from "node:assert/strict";
import test from "node:test";

import type { Itinerary } from "@/types/domain";
import { handleGenerateItinerary } from "@/app/api/itinerary/generate/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/itinerary/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeItinerary(): Itinerary {
  return {
    id: "it_test",
    user_id: null,
    region: "test-region",
    start_node: "node_start",
    end_node: "node_end",
    days: 3,
    preferences: {
      travel_style: "balanced",
      budget: { min: 0, max: 50000 },
      transport_modes: ["road"],
    },
    nodes: ["node_start", "node_end"],
    day_plan: [],
    estimated_cost: 12000,
    score: 0.77,
    created_at: 1700000000000,
  };
}

const validBody = {
  region: "test-region",
  start_node: "node_start",
  end_node: "node_end",
  days: 3,
  preferences: {
    travel_style: "balanced" as const,
    budget: { min: 0, max: 50000 },
    transport_modes: ["road" as const],
  },
};

test("handleGenerateItinerary returns 201 and persists successful plans", async () => {
  let savedId: string | null = null;

  const response = await handleGenerateItinerary(makeRequest(validBody), {
    loadEngineContextForRegion: async () => ({
      nodes: [],
      edges: [],
    }),
    generateItinerary: async () => ({
      ok: true as const,
      itinerary: makeItinerary(),
    }),
    saveItinerary: async (itinerary) => {
      savedId = itinerary.id;
    },
  });

  assert.equal(response.status, 201);
  const payload = (await response.json()) as { itinerary: Itinerary };
  assert.equal(payload.itinerary.id, "it_test");
  assert.equal(savedId, "it_test");
});

test("handleGenerateItinerary returns 422 without persisting failed plans", async () => {
  let saveCalls = 0;

  const response = await handleGenerateItinerary(makeRequest(validBody), {
    loadEngineContextForRegion: async () => ({
      nodes: [],
      edges: [],
    }),
    generateItinerary: async () => ({
      ok: false as const,
      error: {
        error: "constraint_violation" as const,
        reason: "no_feasible_route" as const,
        message: "No feasible route found.",
      },
    }),
    saveItinerary: async () => {
      saveCalls += 1;
    },
  });

  assert.equal(response.status, 422);
  const payload = (await response.json()) as { reason: string };
  assert.equal(payload.reason, "no_feasible_route");
  assert.equal(saveCalls, 0);
});
