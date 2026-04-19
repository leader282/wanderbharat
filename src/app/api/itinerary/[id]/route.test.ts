import assert from "node:assert/strict";
import test from "node:test";

import type { Itinerary } from "@/types/domain";
import {
  handleDeleteItinerary,
  handleGetItinerary,
} from "@/app/api/itinerary/[id]/route";

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
      transport_modes: ["road"],
    },
    nodes: ["node_start", "node_end"],
    day_plan: [],
    stays: [],
    estimated_cost: 12000,
    score: 0.77,
    created_at: 1700000000000,
    ...overrides,
  };
}

test("handleGetItinerary returns the itinerary when it exists", async () => {
  const response = await handleGetItinerary("it_test", {
    getItinerary: async () => makeItinerary(),
    deleteItinerary: async () => {},
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as { itinerary: Itinerary };
  assert.equal(payload.itinerary.id, "it_test");
});

test("handleDeleteItinerary requires an authenticated user", async () => {
  let deleteCalls = 0;

  const response = await handleDeleteItinerary("it_test", {
    getItinerary: async () => makeItinerary(),
    deleteItinerary: async () => {
      deleteCalls += 1;
    },
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
