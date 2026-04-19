import assert from "node:assert/strict";
import test from "node:test";

import type {
  GenerateItineraryInput,
  GraphEdge,
  GraphNode,
} from "@/types/domain";
import { makeAutoBudget } from "@/lib/itinerary/budget";
import { generateItinerary, type EngineContext } from "@/lib/itinerary/engine";
import { buildTravelMatrix } from "@/lib/itinerary/travelMatrix";

function makeCity(args: {
  id: string;
  name: string;
  recommendedHours?: number;
  dailyCost?: number;
  tags?: string[];
  lat?: number;
  lng?: number;
}): GraphNode {
  return {
    id: args.id,
    type: "city",
    name: args.name,
    region: "test-region",
    country: "test-country",
    tags: args.tags ?? ["heritage"],
    metadata: {
      avg_daily_cost: args.dailyCost ?? 2000,
      recommended_hours: args.recommendedHours ?? 8,
      description: `${args.name} description`,
    },
    location: {
      lat: args.lat ?? 26,
      lng: args.lng ?? 75,
    },
  };
}

function makeRoadEdge(args: {
  from: string;
  to: string;
  hours: number;
  distance?: number;
  bidirectional?: boolean;
}): GraphEdge {
  return {
    id: `edge_${args.from}__${args.to}_${Math.round(args.hours * 10)}`,
    from: args.from,
    to: args.to,
    type: "road",
    distance_km: args.distance ?? args.hours * 60,
    travel_time_hours: args.hours,
    bidirectional: args.bidirectional ?? true,
    regions: ["test-region"],
    metadata: {},
  };
}

function makeContext(nodes: GraphNode[], edges: GraphEdge[]): EngineContext {
  return {
    nodes,
    edges,
    now: () => 1700000000000,
    makeId: (prefix) => `${prefix}_test`,
  };
}

const strictResolver = async ({
  nodes,
  edges,
  modes,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  modes: GenerateItineraryInput["preferences"]["transport_modes"];
}) => buildTravelMatrix(nodes, edges, modes ?? ["road"]);

test("generateItinerary chooses the lower-travel route and preserves exact day count", async () => {
  const start = makeCity({
    id: "node_start",
    name: "Start",
    recommendedHours: 6,
    dailyCost: 1500,
    lat: 26.9,
    lng: 75.7,
  });
  const detour = makeCity({
    id: "node_detour",
    name: "Detour",
    recommendedHours: 20,
    dailyCost: 2300,
    lat: 27.2,
    lng: 75.9,
  });
  const efficient = makeCity({
    id: "node_efficient",
    name: "Efficient",
    recommendedHours: 10,
    dailyCost: 2100,
    lat: 25.5,
    lng: 74.2,
  });
  const end = makeCity({
    id: "node_end",
    name: "End",
    recommendedHours: 12,
    dailyCost: 2400,
    lat: 24.6,
    lng: 73.7,
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 3,
      preferences: {
        travel_style: "adventurous",
        budget: { min: 0, max: 50000 },
        travellers: { adults: 2, children: 0 },
        interests: ["heritage"],
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, detour, efficient, end],
      [
        makeRoadEdge({ from: start.id, to: detour.id, hours: 1, distance: 55 }),
        makeRoadEdge({ from: detour.id, to: end.id, hours: 8, distance: 470 }),
        makeRoadEdge({
          from: start.id,
          to: efficient.id,
          hours: 2,
          distance: 130,
        }),
        makeRoadEdge({
          from: efficient.id,
          to: end.id,
          hours: 2,
          distance: 140,
        }),
      ],
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.itinerary.nodes, [start.id, efficient.id, end.id]);
  assert.equal(result.itinerary.day_plan.length, 3);
});

test("generateItinerary can prioritise covering more cities over lower travel time", async () => {
  const start = makeCity({
    id: "node_start",
    name: "Start",
    recommendedHours: 6,
    lat: 26.9,
    lng: 75.8,
  });
  const ajmer = makeCity({
    id: "node_ajmer",
    name: "Ajmer",
    recommendedHours: 8,
    lat: 26.45,
    lng: 74.64,
  });
  const pushkar = makeCity({
    id: "node_pushkar",
    name: "Pushkar",
    recommendedHours: 8,
    lat: 26.49,
    lng: 74.56,
  });

  const ctx = makeContext(
    [start, ajmer, pushkar],
    [
      makeRoadEdge({ from: start.id, to: ajmer.id, hours: 1, distance: 15 }),
      makeRoadEdge({ from: ajmer.id, to: pushkar.id, hours: 1, distance: 16 }),
      makeRoadEdge({
        from: pushkar.id,
        to: start.id,
        hours: 2.5,
        distance: 150,
      }),
      makeRoadEdge({ from: ajmer.id, to: start.id, hours: 1, distance: 15 }),
    ],
  );

  const withoutCoveragePriority = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      days: 3,
      preferences: {
        travel_style: "adventurous",
        budget: { min: 0, max: 50000 },
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
      },
    },
    ctx,
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(withoutCoveragePriority.ok, true);
  if (!withoutCoveragePriority.ok) return;

  assert.deepEqual(withoutCoveragePriority.itinerary.nodes, [
    start.id,
    ajmer.id,
    start.id,
  ]);

  const withCoveragePriority = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      days: 3,
      preferences: {
        travel_style: "adventurous",
        budget: { min: 0, max: 50000 },
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
        prioritize_city_coverage: true,
      },
    },
    ctx,
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(withCoveragePriority.ok, true);
  if (!withCoveragePriority.ok) return;

  assert.deepEqual(withCoveragePriority.itinerary.nodes, [
    start.id,
    ajmer.id,
    pushkar.id,
    start.id,
  ]);
});

test("generateItinerary does not prune a higher-coverage branch too early", async () => {
  const start = makeCity({
    id: "node_start",
    name: "Start",
    recommendedHours: 6,
    lat: 26.9,
    lng: 75.8,
  });
  const quickLoop = makeCity({
    id: "node_quick",
    name: "Quick",
    recommendedHours: 8,
    lat: 26.7,
    lng: 75.4,
  });
  const wideDetour = makeCity({
    id: "node_wide",
    name: "Wide",
    recommendedHours: 8,
    lat: 25.4,
    lng: 74.2,
  });
  const deepStop = makeCity({
    id: "node_deep",
    name: "Deep",
    recommendedHours: 8,
    lat: 24.9,
    lng: 73.7,
  });

  const ctx = makeContext(
    [start, quickLoop, wideDetour, deepStop],
    [
      makeRoadEdge({
        from: start.id,
        to: quickLoop.id,
        hours: 1,
        distance: 60,
      }),
      makeRoadEdge({
        from: start.id,
        to: wideDetour.id,
        hours: 2,
        distance: 130,
      }),
      makeRoadEdge({
        from: wideDetour.id,
        to: deepStop.id,
        hours: 1.6,
        distance: 95,
      }),
      makeRoadEdge({
        from: deepStop.id,
        to: start.id,
        hours: 1.4,
        distance: 90,
        bidirectional: false,
      }),
    ],
  );

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      days: 3,
      preferences: {
        travel_style: "adventurous",
        budget: { min: 0, max: 50000 },
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
        prioritize_city_coverage: true,
      },
    },
    ctx,
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.itinerary.nodes, [
    start.id,
    wideDetour.id,
    deepStop.id,
    start.id,
  ]);
});

test("generateItinerary includes explicitly requested cities when they are feasible", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });
  const nearby = makeCity({ id: "node_nearby", name: "Nearby" });
  const requested = makeCity({ id: "node_requested", name: "Requested" });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      days: 2,
      requested_city_ids: [requested.id],
      preferences: {
        travel_style: "adventurous",
        budget: { min: 0, max: 50000 },
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, nearby, requested],
      [
        makeRoadEdge({ from: start.id, to: nearby.id, hours: 0.5 }),
        makeRoadEdge({ from: nearby.id, to: start.id, hours: 0.5 }),
        makeRoadEdge({ from: start.id, to: requested.id, hours: 1.5 }),
        makeRoadEdge({ from: requested.id, to: start.id, hours: 1.5 }),
      ],
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.ok(result.itinerary.nodes.includes(requested.id));
});

test("generateItinerary reports how many extra days requested cities would need", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });
  const ajmer = makeCity({ id: "node_ajmer", name: "Ajmer" });
  const pushkar = makeCity({ id: "node_pushkar", name: "Pushkar" });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      days: 2,
      requested_city_ids: [ajmer.id, pushkar.id],
      preferences: {
        travel_style: "adventurous",
        budget: { min: 0, max: 50000 },
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, ajmer, pushkar],
      [
        makeRoadEdge({ from: start.id, to: ajmer.id, hours: 1 }),
        makeRoadEdge({ from: ajmer.id, to: pushkar.id, hours: 1 }),
        makeRoadEdge({ from: pushkar.id, to: start.id, hours: 1 }),
        makeRoadEdge({ from: ajmer.id, to: start.id, hours: 1 }),
      ],
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.error.reason, "requested_cities_uncovered");
  assert.equal(
    (result.error.details as { additional_days_needed: number })
      .additional_days_needed,
    1,
  );
});

test("generateItinerary reports when requested cities are impossible inside the 7-day cap", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });
  const ajmer = makeCity({ id: "node_ajmer", name: "Ajmer", recommendedHours: 30 });
  const pushkar = makeCity({
    id: "node_pushkar",
    name: "Pushkar",
    recommendedHours: 30,
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      days: 5,
      requested_city_ids: [ajmer.id, pushkar.id],
      preferences: {
        travel_style: "relaxed",
        budget: { min: 0, max: 50000 },
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, ajmer, pushkar],
      [
        makeRoadEdge({ from: start.id, to: ajmer.id, hours: 1 }),
        makeRoadEdge({ from: ajmer.id, to: pushkar.id, hours: 1 }),
        makeRoadEdge({ from: pushkar.id, to: start.id, hours: 1 }),
        makeRoadEdge({ from: ajmer.id, to: start.id, hours: 1 }),
      ],
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.error.reason, "requested_cities_uncovered");
  assert.equal(
    (result.error.details as { feasible_within_cap: boolean })
      .feasible_within_cap,
    false,
  );
});

test("generateItinerary rejects an unknown end node", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: "node_missing",
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 20000 },
        travellers: { adults: 1, children: 0 },
      },
    },
    makeContext([start], []),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.error.reason, "invalid_input");
  assert.match(result.error.message, /End node "node_missing" not found/);
});

test("generateItinerary rejects itineraries below the requested budget floor", async () => {
  const start = makeCity({
    id: "node_start",
    name: "Start",
    dailyCost: 800,
  });
  const end = makeCity({
    id: "node_end",
    name: "End",
    dailyCost: 1000,
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "adventurous",
        budget: { min: 10000, max: 20000 },
        travellers: { adults: 2, children: 1 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.error.reason, "budget_too_low");
});

test("generateItinerary defers max-budget validation until stay allocations are applied", async () => {
  const start = makeCity({
    id: "node_start",
    name: "Start",
    dailyCost: 3200,
  });
  const end = makeCity({
    id: "node_end",
    name: "End",
    dailyCost: 3600,
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 8000 },
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.ok(result.itinerary.estimated_cost > 8000);
});

test("generateItinerary derives a recommended budget and breakdown from the selected route", async () => {
  const start = makeCity({
    id: "node_start",
    name: "Start",
    dailyCost: 1800,
  });
  const end = makeCity({
    id: "node_end",
    name: "End",
    dailyCost: 2200,
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: makeAutoBudget("INR"),
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.itinerary.preferences.budget.max, makeAutoBudget("INR").max);
  assert.equal(result.itinerary.preferences.budget.currency, "INR");
  assert.ok(result.itinerary.budget_breakdown);
  assert.equal(
    result.itinerary.budget_breakdown?.requestedBudget?.max,
    makeAutoBudget("INR").max,
  );
  assert.equal(
    result.itinerary.budget_breakdown?.recommendedBudget?.min,
    result.itinerary.estimated_cost,
  );
  assert.ok(
    (result.itinerary.budget_breakdown?.recommendedBudget?.max ?? 0) >
      (result.itinerary.budget_breakdown?.recommendedBudget?.min ?? 0),
  );
  assert.ok((result.itinerary.budget_breakdown?.line_items.length ?? 0) >= 2);
  assert.ok(
    result.itinerary.budget_breakdown?.line_items.some(
      (item) => item.kind === "stay",
    ),
  );
  assert.ok(
    result.itinerary.budget_breakdown?.line_items.some(
      (item) => item.kind === "travel",
    ),
  );
});

test("generateItinerary treats an infeasible final leg as no feasible route", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });
  const middle = makeCity({ id: "node_middle", name: "Middle" });
  const end = makeCity({ id: "node_end", name: "End" });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "adventurous",
        budget: { min: 0, max: 40000 },
        travellers: { adults: 1, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, middle, end],
      [
        makeRoadEdge({ from: start.id, to: middle.id, hours: 2 }),
        makeRoadEdge({
          from: middle.id,
          to: end.id,
          hours: 9,
          bidirectional: false,
        }),
      ],
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.error.reason, "no_feasible_route");
});

test("generateItinerary enforces minHoursPerStop through exact day allocation", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });
  const stop = makeCity({ id: "node_stop", name: "Stop", recommendedHours: 6 });
  const end = makeCity({ id: "node_end", name: "End", recommendedHours: 6 });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "relaxed",
        budget: { min: 0, max: 40000 },
        travellers: { adults: 1, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, stop, end],
      [
        makeRoadEdge({ from: start.id, to: stop.id, hours: 2 }),
        makeRoadEdge({ from: stop.id, to: end.id, hours: 2 }),
      ],
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.error.reason, "no_feasible_route");
});
