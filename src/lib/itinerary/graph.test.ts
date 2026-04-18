import assert from "node:assert/strict";
import test from "node:test";

import type { GraphEdge, GraphNode } from "@/types/domain";
import { TravelGraph, distanceBetween } from "@/lib/itinerary/graph";

function makeNode(id: string, lat = 26, lng = 75): GraphNode {
  return {
    id,
    type: "city",
    name: id,
    region: "test-region",
    country: "test-country",
    tags: [],
    metadata: { recommended_hours: 8 },
    location: { lat, lng },
  };
}

function makeEdge(
  args: Partial<GraphEdge> & { from: string; to: string },
): GraphEdge {
  return {
    id: `edge_${args.from}__${args.to}`,
    type: "road",
    distance_km: 100,
    travel_time_hours: 2,
    bidirectional: true,
    regions: ["test-region"],
    metadata: {},
    ...args,
  };
}

test("TravelGraph indexes nodes by id", () => {
  const a = makeNode("a");
  const b = makeNode("b");
  const graph = new TravelGraph([a, b], []);

  assert.equal(graph.getNode("a"), a);
  assert.equal(graph.getNode("missing"), undefined);
  assert.equal(graph.allNodes().length, 2);
});

test("TravelGraph.requireNode throws for unknown ids", () => {
  const graph = new TravelGraph([], []);
  assert.throws(() => graph.requireNode("missing"), /Node not found/);
});

test("TravelGraph stores bidirectional edges in both directions", () => {
  const a = makeNode("a");
  const b = makeNode("b");
  const edge = makeEdge({ from: "a", to: "b", bidirectional: true });
  const graph = new TravelGraph([a, b], [edge]);

  assert.equal(graph.neighbors("a").length, 1);
  assert.equal(graph.neighbors("b").length, 1);
  assert.equal(graph.getEdge("a", "b")?.id, edge.id);
  assert.equal(graph.getEdge("b", "a")?.id, edge.id);
});

test("TravelGraph respects bidirectional=false", () => {
  const a = makeNode("a");
  const b = makeNode("b");
  const edge = makeEdge({ from: "a", to: "b", bidirectional: false });
  const graph = new TravelGraph([a, b], [edge]);

  assert.ok(graph.getEdge("a", "b"));
  assert.equal(graph.getEdge("b", "a"), undefined);
});

test("TravelGraph silently drops edges referencing unknown nodes", () => {
  const a = makeNode("a");
  const orphan = makeEdge({ from: "a", to: "ghost" });
  const graph = new TravelGraph([a], [orphan]);

  assert.equal(graph.neighbors("a").length, 0);
  assert.equal(graph.getEdge("a", "ghost"), undefined);
});

test("TravelGraph.getEdge picks the fastest mode-matching edge", () => {
  const a = makeNode("a");
  const b = makeNode("b");
  const slow = makeEdge({
    from: "a",
    to: "b",
    id: "edge_slow",
    travel_time_hours: 6,
  });
  const fast = makeEdge({
    from: "a",
    to: "b",
    id: "edge_fast",
    travel_time_hours: 2,
  });
  const flight = makeEdge({
    from: "a",
    to: "b",
    id: "edge_flight",
    type: "flight",
    travel_time_hours: 1,
  });
  const graph = new TravelGraph([a, b], [slow, fast, flight]);

  assert.equal(graph.getEdge("a", "b")?.id, "edge_flight");
  assert.equal(graph.getEdge("a", "b", ["road"])?.id, "edge_fast");
  assert.equal(graph.getEdge("a", "b", ["flight"])?.id, "edge_flight");
});

test("TravelGraph.estimateTravel uses an existing edge when present", () => {
  const a = makeNode("a");
  const b = makeNode("b");
  const edge = makeEdge({
    from: "a",
    to: "b",
    distance_km: 250,
    travel_time_hours: 4.5,
  });
  const graph = new TravelGraph([a, b], [edge]);

  const result = graph.estimateTravel("a", "b");
  assert.equal(result.distance_km, 250);
  assert.equal(result.travel_time_hours, 4.5);
  assert.equal(result.mode, "road");
});

test("TravelGraph.estimateTravel falls back to haversine + average speed when no edge exists", () => {
  const a = makeNode("a", 0, 0);
  const b = makeNode("b", 0, 1); // ~111 km along the equator
  const graph = new TravelGraph([a, b], []);

  const result = graph.estimateTravel("a", "b", ["road"]);
  assert.equal(result.mode, "road");
  assert.ok(result.distance_km > 100 && result.distance_km < 120);
  assert.ok(result.travel_time_hours > 0);
});

test("distanceBetween returns 0 for identical points", () => {
  assert.equal(distanceBetween({ lat: 26, lng: 75 }, { lat: 26, lng: 75 }), 0);
});

test("distanceBetween is symmetric", () => {
  const a = { lat: 26.91, lng: 75.79 };
  const b = { lat: 24.58, lng: 73.69 };
  assert.equal(distanceBetween(a, b), distanceBetween(b, a));
});
