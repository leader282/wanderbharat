import assert from "node:assert/strict";
import test from "node:test";

import { loadEdgesForCities } from "@/lib/itinerary/loadContext";
import type { GraphEdge } from "@/types/domain";

function makeEdge(id: string, regions: string[]): GraphEdge {
  return {
    id,
    from: "city_1",
    to: "city_2",
    type: "road",
    distance_km: 10,
    travel_time_hours: 0.5,
    regions,
    metadata: {},
  };
}

test("loadEdgesForCities fans out multi-region edge queries to avoid Firestore disjunction limits", async () => {
  const calls: Array<{ regions?: string[]; fromIds?: string[] }> = [];

  const edges = await loadEdgesForCities(
    Array.from({ length: 12 }, (_, index) => `city_${index + 1}`),
    ["rajasthan", "kerala", "delhi", "goa"],
    async (query) => {
      assert.ok(query);
      calls.push({ regions: query.regions, fromIds: query.fromIds });
      return [
        makeEdge(`edge_${query.regions?.[0] ?? "all"}`, query.regions ?? []),
      ];
    },
  );

  assert.equal(calls.length, 8);
  assert.deepEqual(
    calls.map((call) => call.regions),
    [
      ["rajasthan"],
      ["kerala"],
      ["delhi"],
      ["goa"],
      ["rajasthan"],
      ["kerala"],
      ["delhi"],
      ["goa"],
    ],
  );
  assert.ok(calls.every((call) => (call.fromIds?.length ?? 0) <= 10));
  assert.equal(edges.length, 4);
});
