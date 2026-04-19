import assert from "node:assert/strict";
import test from "node:test";

import type { Itinerary, ItineraryMapData } from "@/types/domain";
import {
  handleDeleteItinerary,
  handleGetItinerary,
  handleUpdateItineraryBudget,
} from "@/app/api/itinerary/[id]/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/itinerary/it_test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeItinerary(overrides: Partial<Itinerary> = {}): Itinerary {
  return {
    id: "it_test",
    user_id: "uid_owner",
    region: "test-region",
    start_node: "node_start",
    end_node: "node_end",
    days: 4,
    preferences: {
      travel_style: "balanced",
      budget: { min: 0, max: 50000 },
      travellers: { adults: 2, children: 0 },
      transport_modes: ["road"],
    },
    nodes: ["node_start", "node_end"],
    day_plan: [
      {
        day_index: 0,
        base_node_id: "node_start",
        base_node_name: "Start",
        activities: [
          {
            node_id: "act_start",
            name: "Start walk",
            type: "attraction",
            duration_hours: 3,
            tags: [],
          },
        ],
        total_activity_hours: 3,
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
          distance_km: 110,
          travel_time_hours: 2,
        },
        activities: [
          {
            node_id: "act_end",
            name: "End walk",
            type: "attraction",
            duration_hours: 2,
            tags: [],
          },
        ],
        total_activity_hours: 2,
        total_travel_hours: 2,
      },
    ],
    stays: [
      {
        nodeId: "node_start",
        startDay: 0,
        endDay: 0,
        nights: 1,
        accommodationId: "acc_start",
        nightlyCost: 3500,
        totalCost: 3500,
      },
      {
        nodeId: "node_end",
        startDay: 1,
        endDay: 1,
        nights: 1,
        accommodationId: "acc_end",
        nightlyCost: 3000,
        totalCost: 3000,
      },
    ],
    estimated_cost: 12000,
    budget_breakdown: {
      line_items: [],
      lodgingSubtotal: 6500,
      nightlyAverage: 3250,
      totalTripCost: 12000,
      requestedBudget: { min: 0, max: 50000, currency: "INR" },
      recommendedBudget: { min: 12000, max: 14000, currency: "INR" },
    },
    score: 0.77,
    created_at: 1700000000000,
    ...overrides,
  };
}

function makeMapData(): ItineraryMapData {
  return {
    markers: [],
    legs: [],
    missing_geometry_count: 0,
  };
}

test("handleGetItinerary returns the itinerary when it exists", async () => {
  const response = await handleGetItinerary("it_test", {
    getItinerary: async () => makeItinerary(),
    deleteItinerary: async () => {},
    getItineraryMapData: async () => makeMapData(),
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    itinerary: Itinerary;
    map: ItineraryMapData;
  };
  assert.equal(payload.itinerary.id, "it_test");
  assert.equal(payload.map.missing_geometry_count, 0);
});

test("handleDeleteItinerary requires an authenticated user", async () => {
  let deleteCalls = 0;

  const response = await handleDeleteItinerary("it_test", {
    getItinerary: async () => makeItinerary(),
    deleteItinerary: async () => {
      deleteCalls += 1;
    },
    getItineraryMapData: async () => makeMapData(),
    resolveCurrentUser: async () => null,
  });

  assert.equal(response.status, 401);
  assert.equal(deleteCalls, 0);
});

test("handleDeleteItinerary rejects users who do not own the itinerary", async () => {
  let deleteCalls = 0;

  const response = await handleDeleteItinerary("it_test", {
    getItinerary: async () => makeItinerary({ user_id: "uid_someone_else" }),
    deleteItinerary: async () => {
      deleteCalls += 1;
    },
    getItineraryMapData: async () => makeMapData(),
    resolveCurrentUser: async () => ({
      uid: "uid_owner",
      email: "owner@example.com",
      name: "Owner",
      picture: null,
    }),
  });

  assert.equal(response.status, 403);
  assert.equal(deleteCalls, 0);
});

test("handleDeleteItinerary returns 404 for unknown itineraries", async () => {
  let deleteCalls = 0;

  const response = await handleDeleteItinerary("it_missing", {
    getItinerary: async () => null,
    deleteItinerary: async () => {
      deleteCalls += 1;
    },
    getItineraryMapData: async () => makeMapData(),
    resolveCurrentUser: async () => ({
      uid: "uid_owner",
      email: "owner@example.com",
      name: "Owner",
      picture: null,
    }),
  });

  assert.equal(response.status, 404);
  assert.equal(deleteCalls, 0);
});

test("handleDeleteItinerary deletes itineraries owned by the current user", async () => {
  let deletedId: string | null = null;

  const response = await handleDeleteItinerary("it_test", {
    getItinerary: async () => makeItinerary(),
    deleteItinerary: async (id) => {
      deletedId = id;
    },
    getItineraryMapData: async () => makeMapData(),
    resolveCurrentUser: async () => ({
      uid: "uid_owner",
      email: "owner@example.com",
      name: "Owner",
      picture: null,
    }),
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as { ok: boolean; id: string };
  assert.equal(payload.ok, true);
  assert.equal(payload.id, "it_test");
  assert.equal(deletedId, "it_test");
});

test("handleUpdateItineraryBudget previews changes without saving", async () => {
  let saveCalls = 0;

  const response = await handleUpdateItineraryBudget(
    "it_test",
    makeRequest({ total_budget: 30000 }),
    {
      getItinerary: async () => makeItinerary(),
      deleteItinerary: async () => {},
      saveItinerary: async () => {
        saveCalls += 1;
      },
      getItineraryMapData: async () => makeMapData(),
      loadEngineContextForPlan: async () => ({ nodes: [], edges: [] }),
      generateItinerary: async (input) => ({
        ok: true as const,
        itinerary: makeItinerary({
          id: "it_regenerated",
          preferences: input.preferences,
          nodes: ["node_start"],
          day_plan: [
            {
              day_index: 0,
              base_node_id: "node_start",
              base_node_name: "Start",
              activities: [
                {
                  node_id: "act_start",
                  name: "Start walk",
                  type: "attraction",
                  duration_hours: 2,
                  tags: [],
                },
              ],
              total_activity_hours: 2,
              total_travel_hours: 0,
            },
            {
              day_index: 1,
              base_node_id: "node_start",
              base_node_name: "Start",
              activities: [
                {
                  node_id: "act_start_two",
                  name: "Local walk",
                  type: "attraction",
                  duration_hours: 1.5,
                  tags: [],
                },
              ],
              total_activity_hours: 1.5,
              total_travel_hours: 0,
            },
          ],
          stays: [],
          estimated_cost: 9000,
          budget_breakdown: {
            line_items: [],
            totalTripCost: 9000,
            requestedBudget: { min: 0, max: 30000, currency: "INR" },
          },
        }),
      }),
      planAccommodations: async () => ({
        stays: [
          {
            nodeId: "node_start",
            startDay: 0,
            endDay: 1,
            nights: 2,
            accommodationId: "acc_budget",
            nightlyCost: 2000,
            totalCost: 4000,
          },
        ],
        warnings: [],
      }),
      resolveUserIdFromRequest: async () => null,
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    preview: { direction: string; impacts: Array<{ id: string }> };
  };
  assert.equal(payload.preview.direction, "downgrade");
  assert.ok(payload.preview.impacts.some((impact) => impact.id === "stays"));
  assert.equal(saveCalls, 0);
});

test("handleUpdateItineraryBudget applies the regenerated itinerary in place", async () => {
  let savedItinerary: Itinerary | null = null;

  const response = await handleUpdateItineraryBudget(
    "it_test",
    makeRequest({ total_budget: 65000, apply: true }),
    {
      getItinerary: async () => makeItinerary({ user_id: "uid_owner" }),
      deleteItinerary: async () => {},
      saveItinerary: async (itinerary) => {
        savedItinerary = itinerary;
      },
      getItineraryMapData: async () => makeMapData(),
      loadEngineContextForPlan: async () => ({ nodes: [], edges: [] }),
      generateItinerary: async (input) => ({
        ok: true as const,
        itinerary: makeItinerary({
          id: "it_generated_elsewhere",
          created_at: 1800000000000,
          preferences: input.preferences,
          estimated_cost: 20000,
        }),
      }),
      planAccommodations: async () => ({
        stays: [
          {
            nodeId: "node_start",
            startDay: 0,
            endDay: 0,
            nights: 1,
            accommodationId: "acc_start_upgraded",
            nightlyCost: 5000,
            totalCost: 5000,
          },
          {
            nodeId: "node_end",
            startDay: 1,
            endDay: 1,
            nights: 1,
            accommodationId: "acc_end_upgraded",
            nightlyCost: 4500,
            totalCost: 4500,
          },
        ],
        warnings: [],
      }),
      precacheItineraryRouteGeometry: async () => [],
      resolveUserIdFromRequest: async () => "uid_owner",
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as { itinerary: Itinerary };
  assert.equal(payload.itinerary.id, "it_test");
  assert.equal(payload.itinerary.created_at, 1700000000000);
  assert.equal(payload.itinerary.preferences.budget.max, 65000);
  assert.ok(savedItinerary);
  const persisted = savedItinerary as Itinerary;
  assert.equal(persisted.id, "it_test");
  assert.equal(persisted.created_at, 1700000000000);
  assert.equal(persisted.preferences.budget.max, 65000);
});

test("handleUpdateItineraryBudget rejects applying account-owned itineraries as another user", async () => {
  let saveCalls = 0;

  const response = await handleUpdateItineraryBudget(
    "it_test",
    makeRequest({ total_budget: 65000, apply: true }),
    {
      getItinerary: async () => makeItinerary({ user_id: "uid_owner" }),
      deleteItinerary: async () => {},
      saveItinerary: async () => {
        saveCalls += 1;
      },
      getItineraryMapData: async () => makeMapData(),
      resolveUserIdFromRequest: async () => "uid_other",
    },
  );

  assert.equal(response.status, 403);
  assert.equal(saveCalls, 0);
});
