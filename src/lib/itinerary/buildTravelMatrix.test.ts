import assert from "node:assert/strict";
import test from "node:test";

import type { GraphEdge, GraphNode } from "@/types/domain";
import { buildTravelMatrix } from "@/lib/itinerary/travelMatrix";

function makeNode(id: string): GraphNode {
  return {
    id,
    type: "city",
    name: id,
    region: "test-region",
    country: "test-country",
    tags: [],
    metadata: {},
    location: { lat: 26, lng: 75 },
  };
}

function makeEdge(args: {
  from: string;
  to: string;
  hours: number;
  type?: GraphEdge["type"];
  bidirectional?: boolean;
}): GraphEdge {
  return {
    id: `edge_${args.type ?? "road"}_${args.from}__${args.to}`,
    from: args.from,
    to: args.to,
    type: args.type ?? "road",
    distance_km: args.hours * 60,
    travel_time_hours: args.hours,
    bidirectional: args.bidirectional ?? true,
    regions: ["test-region"],
    metadata: {},
  };
}

test("buildTravelMatrix resolves bidirectional pairs in both directions", () => {
  const a = makeNode("a");
  const b = makeNode("b");
  const matrix = buildTravelMatrix(
    [a, b],
    [makeEdge({ from: "a", to: "b", hours: 3 })],
    ["road"],
  );

  const ab = matrix.get("a", "b");
  const ba = matrix.get("b", "a");

  assert.ok(ab);
  assert.ok(ba);
  assert.equal(ab?.travel_time_hours, 3);
  assert.equal(ba?.travel_time_hours, 3);
});

test("buildTravelMatrix omits the reverse leg when bidirectional=false", () => {
  const a = makeNode("a");
  const b = makeNode("b");
  const matrix = buildTravelMatrix(
    [a, b],
    [makeEdge({ from: "a", to: "b", hours: 3, bidirectional: false })],
    ["road"],
  );

  assert.ok(matrix.get("a", "b"));
  assert.equal(matrix.get("b", "a"), null);
});

test("buildTravelMatrix returns null for unreachable pairs", () => {
  const a = makeNode("a");
  const b = makeNode("b");
  const matrix = buildTravelMatrix([a, b], [], ["road"]);
  assert.equal(matrix.get("a", "b"), null);
  assert.equal(matrix.get("b", "a"), null);
});

test("buildTravelMatrix preserves all per-mode legs in getAll", () => {
  const a = makeNode("a");
  const b = makeNode("b");
  const matrix = buildTravelMatrix(
    [a, b],
    [
      makeEdge({ from: "a", to: "b", hours: 6, type: "road" }),
      makeEdge({ from: "a", to: "b", hours: 1, type: "flight" }),
    ],
    ["road", "flight"],
  );

  const all = matrix.getAll("a", "b");
  assert.equal(all.length, 2);
  // Lower leg_score should be returned by .get() (flight is faster).
  assert.equal(matrix.get("a", "b")?.transport_mode, "flight");
  assert.equal(matrix.get("a", "b", "road")?.transport_mode, "road");
});

test("buildTravelMatrix exposes the mode list it was built with", () => {
  const matrix = buildTravelMatrix([], [], ["road", "train"]);
  assert.deepEqual([...matrix.modes], ["road", "train"]);
});

test("buildTravelMatrix dedupes nodes that appear twice", () => {
  const a = makeNode("a");
  const matrix = buildTravelMatrix([a, a], [], ["road"]);
  // Self-pair is always skipped, and duplicate node should not crash.
  assert.equal(matrix.get("a", "a"), null);
});
