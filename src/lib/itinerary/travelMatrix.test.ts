import assert from "node:assert/strict";
import test from "node:test";

import type { GraphNode } from "@/types/domain";
import { resolveTravelMatrix } from "@/lib/itinerary/travelMatrix";

function makeCity(id: string, name: string): GraphNode {
  return {
    id,
    type: "city",
    name,
    region: "test-region",
    country: "test-country",
    tags: ["heritage"],
    metadata: {
      avg_daily_cost: 2000,
      recommended_hours: 8,
    },
    location: { lat: 26, lng: 75 },
  };
}

test("resolveTravelMatrix fetches and caches missing legs", async () => {
  const jaipur = makeCity("node_jaipur", "Jaipur");
  const udaipur = makeCity("node_udaipur", "Udaipur");
  const persisted: Array<{ id: string; type: string }> = [];

  const matrix = await resolveTravelMatrix(
    {
      nodes: [jaipur, udaipur],
      edges: [],
      regions: ["test-region"],
      modes: ["road"],
      now: () => 123456,
    },
    {
      fetchTravelMatrix: async () => [],
      fetchTravelTime: async () => ({
        distance_km: 392.8,
        travel_time_hours: 6.75,
      }),
      persistEdges: async (edges) => {
        persisted.push(...edges.map((edge) => ({ id: edge.id, type: edge.type })));
      },
    },
  );

  const forward = matrix.get(jaipur.id, udaipur.id);
  const reverse = matrix.get(udaipur.id, jaipur.id);

  assert.ok(forward);
  assert.ok(reverse);
  assert.equal(forward?.transport_mode, "road");
  assert.equal(forward?.travel_time_hours, 6.75);
  assert.deepEqual(persisted, [
    {
      id: "edge_resolved_road_node_jaipur__node_udaipur",
      type: "road",
    },
  ]);
});

test("resolveTravelMatrix leaves unresolved pairs infeasible when lookup returns null", async () => {
  const ajmer = makeCity("node_ajmer", "Ajmer");
  const pushkar = makeCity("node_pushkar", "Pushkar");
  let persistedCount = 0;

  const matrix = await resolveTravelMatrix(
    {
      nodes: [ajmer, pushkar],
      edges: [],
      regions: ["test-region"],
      modes: ["road"],
    },
    {
      fetchTravelMatrix: async () => [],
      fetchTravelTime: async () => null,
      persistEdges: async (edges) => {
        persistedCount += edges.length;
      },
    },
  );

  assert.equal(matrix.get(ajmer.id, pushkar.id), null);
  assert.equal(matrix.get(pushkar.id, ajmer.id), null);
  assert.equal(persistedCount, 0);
});

test("resolveTravelMatrix fetches a unique-node matrix instead of pair-squared inputs", async () => {
  const nodes = [
    makeCity("node_a", "A"),
    makeCity("node_b", "B"),
    makeCity("node_c", "C"),
    makeCity("node_d", "D"),
  ];
  let observedOriginCount = 0;
  let observedDestinationCount = 0;

  const matrix = await resolveTravelMatrix(
    {
      nodes,
      edges: [],
      regions: ["test-region"],
      modes: ["road"],
      now: () => 123456,
    },
    {
      fetchTravelMatrix: async ({ origins, destinations }) => {
        observedOriginCount = origins.length;
        observedDestinationCount = destinations.length;
        return origins.flatMap((_origin, origin_index) =>
          destinations.map((_destination, destination_index) => ({
            origin_index,
            destination_index,
            leg:
              origin_index === destination_index
                ? null
                : {
                    distance_km: 100 + origin_index + destination_index,
                    travel_time_hours: 2 + origin_index + destination_index / 10,
                  },
          })),
        );
      },
      persistEdges: async () => {},
    },
  );

  assert.equal(observedOriginCount, nodes.length);
  assert.equal(observedDestinationCount, nodes.length);
  assert.equal(matrix.get("node_a", "node_b")?.travel_time_hours, 2.1);
  assert.equal(matrix.get("node_d", "node_c")?.travel_time_hours, 4.3);
});
