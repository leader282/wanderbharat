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
      trip_start_date: "2026-10-20",
      travellers: {
        adults: 2,
        children: 0,
        children_ages: [],
        rooms: 1,
        guest_nationality: "IN",
      },
      transport_modes: ["road"],
    },
    nodes: ["node_start", "node_end"],
    day_plan: [
      {
        day_index: 0,
        base_node_id: "node_start",
        base_node_name: "Start",
        activities: [],
        total_activity_hours: 4,
        total_travel_hours: 0,
      },
      {
        day_index: 1,
        base_node_id: "node_end",
        base_node_name: "End",
        travel: {
          from_node_id: "node_start",
          to_node_id: "node_end",
          transport_mode: "road",
          distance_km: 120,
          travel_time_hours: 2,
        },
        activities: [],
        total_activity_hours: 3,
        total_travel_hours: 2,
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
          label: "Start to End by Road",
          amount: 1500,
        },
      ],
    },
    score: 0.77,
    created_at: 1700000000000,
  };
}

const validBody = {
  regions: ["test-region"],
  start_node: "node_start",
  end_node: "node_end",
  days: 3,
  preferences: {
    travel_style: "balanced" as const,
    budget: { min: 0, max: 50000 },
    trip_start_date: "2026-10-20",
    travellers: {
      adults: 2,
      children: 0,
      children_ages: [],
      rooms: 1,
      guest_nationality: "IN",
    },
    transport_modes: ["road" as const],
  },
};

test("handleGenerateItinerary returns structured validation issues for invalid input", async () => {
  let generateCalls = 0;

  const response = await handleGenerateItinerary(
    makeRequest({
      ...validBody,
      preferences: {
        ...validBody.preferences,
        transport_modes: [],
      },
    }),
    {
      loadEngineContextForPlan: async () => ({ nodes: [], edges: [] }),
      generateItinerary: async () => {
        generateCalls += 1;
        return {
          ok: true as const,
          itinerary: makeItinerary(),
        };
      },
      planAccommodations: async () => ({ stays: [], warnings: [] }),
      saveItinerary: async () => {},
      resolveUserId: async () => null,
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as {
    error: string;
    issues: Array<{ path: string; message: string }>;
  };
  assert.equal(payload.error, "invalid_input");
  assert.ok(
    payload.issues.some((issue) => issue.path === "preferences.transport_modes"),
  );
  assert.equal(generateCalls, 0);
});

test("handleGenerateItinerary returns 201 and persists successful plans", async () => {
  let savedId: string | null = null;

  const response = await handleGenerateItinerary(makeRequest(validBody), {
    loadEngineContextForPlan: async () => ({
      nodes: [],
      edges: [],
    }),
    generateItinerary: async () => ({
      ok: true as const,
      itinerary: makeItinerary(),
    }),
    planAccommodations: async () => ({ stays: [], warnings: [] }),
    saveItinerary: async (itinerary) => {
      savedId = itinerary.id;
    },
    resolveUserId: async () => null,
  });

  assert.equal(response.status, 201);
  const payload = (await response.json()) as { itinerary: Itinerary };
  assert.equal(payload.itinerary.id, "it_test");
  assert.equal(savedId, "it_test");
});

test("handleGenerateItinerary returns 422 without persisting failed plans", async () => {
  let saveCalls = 0;

  const response = await handleGenerateItinerary(makeRequest(validBody), {
    loadEngineContextForPlan: async () => ({
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
    planAccommodations: async () => ({ stays: [], warnings: [] }),
    saveItinerary: async () => {
      saveCalls += 1;
    },
    resolveUserId: async () => null,
  });

  assert.equal(response.status, 422);
  const payload = (await response.json()) as { reason: string };
  assert.equal(payload.reason, "no_feasible_route");
  assert.equal(saveCalls, 0);
});

test("handleGenerateItinerary attaches the verified user_id to the itinerary input", async () => {
  let observedUserId: string | undefined;
  let savedUserId: string | null | undefined;

  const response = await handleGenerateItinerary(
    makeRequest({ ...validBody, user_id: "client_lied" }),
    {
      loadEngineContextForPlan: async () => ({ nodes: [], edges: [] }),
      generateItinerary: async (input) => {
        observedUserId = input.user_id;
        return {
          ok: true as const,
          itinerary: { ...makeItinerary(), user_id: input.user_id ?? null },
        };
      },
      planAccommodations: async () => ({ stays: [], warnings: [] }),
      saveItinerary: async (itinerary) => {
        savedUserId = itinerary.user_id;
      },
      resolveUserId: async () => "uid_authed",
    },
  );

  assert.equal(response.status, 201);
  // Client-supplied user_id is overridden with the verified one.
  assert.equal(observedUserId, "uid_authed");
  assert.equal(savedUserId, "uid_authed");
});

test("handleGenerateItinerary integrates stay assignments into the persisted itinerary", async () => {
  let savedItinerary: Itinerary | undefined;

  const response = await handleGenerateItinerary(makeRequest(validBody), {
    loadEngineContextForPlan: async () => ({
      nodes: [],
      edges: [],
    }),
    generateItinerary: async () => ({
      ok: true as const,
      itinerary: makeItinerary(),
    }),
    planAccommodations: async () => ({
      stays: [
        {
          nodeId: "node_start",
          startDay: 0,
          endDay: 0,
          nights: 1,
          accommodationId: "acc_start",
          nightlyCost: 2200,
          totalCost: 2200,
        },
        {
          nodeId: "node_end",
          startDay: 1,
          endDay: 1,
          nights: 1,
          accommodationId: null,
          nightlyCost: 0,
          totalCost: 0,
        },
      ],
      warnings: [
        "No active accommodations matched the travel-style filters for End.",
      ],
    }),
    saveItinerary: async (itinerary) => {
      savedItinerary = itinerary;
    },
    resolveUserId: async () => null,
  });

  assert.equal(response.status, 201);
  const payload = (await response.json()) as { itinerary: Itinerary };
  assert.equal(payload.itinerary.stays.length, 2);
  assert.equal(payload.itinerary.estimated_cost, 3700);
  assert.equal(payload.itinerary.budget_breakdown?.lodgingSubtotal, 2200);
  assert.equal(savedItinerary?.stays[0]?.accommodationId, "acc_start");
  assert.deepEqual(savedItinerary?.warnings, [
    "No active accommodations matched the travel-style filters for End.",
  ]);
});

test("handleGenerateItinerary returns 422 when room allocations push the final trip over budget", async () => {
  let saveCalls = 0;

  const response = await handleGenerateItinerary(
    makeRequest({
      ...validBody,
      preferences: {
        ...validBody.preferences,
        budget: { min: 0, max: 4000 },
      },
    }),
    {
      loadEngineContextForPlan: async () => ({
        nodes: [],
        edges: [],
      }),
      generateItinerary: async () => ({
        ok: true as const,
        itinerary: makeItinerary(),
      }),
      planAccommodations: async () => ({
        stays: [
          {
            nodeId: "node_start",
            startDay: 0,
            endDay: 0,
            nights: 1,
            accommodationId: "acc_start",
            nightlyCost: 3200,
            totalCost: 3200,
          },
          {
            nodeId: "node_end",
            startDay: 1,
            endDay: 1,
            nights: 1,
            accommodationId: "acc_end",
            nightlyCost: 2800,
            totalCost: 2800,
          },
        ],
        warnings: [],
      }),
      saveItinerary: async () => {
        saveCalls += 1;
      },
      resolveUserId: async () => null,
    },
  );

  assert.equal(response.status, 422);
  const payload = (await response.json()) as { reason: string };
  assert.equal(payload.reason, "budget_exceeded");
  assert.equal(saveCalls, 0);
});
