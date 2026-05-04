import assert from "node:assert/strict";
import test from "node:test";

import type {
  AttractionAdmissionRule,
  AttractionOpeningHours,
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

function makeAttraction(args: {
  id: string;
  name: string;
  cityId: string;
  recommendedHours?: number;
  openingHours?: AttractionOpeningHours;
  admissionRules?: AttractionAdmissionRule[];
  openingTime?: string;
  closingTime?: string;
}): GraphNode {
  return {
    id: args.id,
    type: "attraction",
    name: args.name,
    region: "test-region",
    country: "test-country",
    tags: ["heritage"],
    parent_node_id: args.cityId,
    metadata: {
      recommended_hours: args.recommendedHours ?? 2,
      description: `${args.name} description`,
      opening_time: args.openingTime,
      closing_time: args.closingTime,
      opening_hours: args.openingHours,
      admission_rules: args.admissionRules,
    },
    location: {
      lat: 26.9,
      lng: 75.8,
    },
  };
}

function makeAdmissionRule(args: {
  id: string;
  attractionNodeId: string;
  amount: number | null;
  audience?: AttractionAdmissionRule["audience"];
  nationality?: AttractionAdmissionRule["nationality"];
  isStudent?: boolean;
  currency?: string;
  sourceType?: AttractionAdmissionRule["source_type"];
  confidence?: AttractionAdmissionRule["confidence"];
  validFrom?: AttractionAdmissionRule["valid_from"];
  validUntil?: AttractionAdmissionRule["valid_until"];
}): AttractionAdmissionRule {
  return {
    id: args.id,
    attraction_node_id: args.attractionNodeId,
    currency: args.currency ?? "INR",
    amount: args.amount,
    audience: args.audience ?? "adult",
    nationality: args.nationality ?? "any",
    is_student: args.isStudent ? true : undefined,
    source_type: args.sourceType ?? "manual",
    confidence:
      args.confidence ?? (args.amount === null ? "unknown" : "verified"),
    valid_from: args.validFrom ?? null,
    valid_until: args.validUntil ?? null,
    data_version: 2,
  };
}

function makeContext(
  nodes: GraphNode[],
  edges: GraphEdge[],
  attractionsByCity?: Map<string, GraphNode[]>,
): EngineContext {
  return {
    nodes,
    edges,
    attractionsByCity,
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

test("generateItinerary does not treat unknown attraction cost as zero", async () => {
  const start = makeCity({ id: "node_start", name: "Start", dailyCost: 1800 });
  const end = makeCity({ id: "node_end", name: "End", dailyCost: 2200 });
  const attraction = makeAttraction({
    id: "attr_unknown_cost",
    name: "Unknown Cost Fort",
    cityId: end.id,
    admissionRules: [
      makeAdmissionRule({
        id: "adm_unknown",
        attractionNodeId: "attr_unknown_cost",
        amount: null,
        confidence: "unknown",
      }),
    ],
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 80000 },
        travellers: { adults: 2, children: 0 },
        trip_start_date: "2026-05-05",
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, attraction],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [attraction]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.itinerary.budget_breakdown?.attractionSubtotal, 0);
  assert.equal(result.itinerary.budget_breakdown?.unknownAttractionCostsCount, 1);
  assert.equal(
    result.itinerary.budget_breakdown?.line_items.some(
      (item) => item.kind === "attraction",
    ),
    false,
  );
  assert.ok(
    (result.itinerary.warnings ?? []).some(
      (warning) =>
        warning.includes("Unknown Cost Fort") && warning.includes("unknown"),
    ),
  );
});

test("generateItinerary treats verified free attraction as zero but not unknown", async () => {
  const start = makeCity({ id: "node_start", name: "Start", dailyCost: 1800 });
  const end = makeCity({ id: "node_end", name: "End", dailyCost: 2200 });
  const freeAttraction = makeAttraction({
    id: "attr_free",
    name: "Free Memorial",
    cityId: end.id,
    admissionRules: [
      makeAdmissionRule({
        id: "adm_free",
        attractionNodeId: "attr_free",
        amount: 0,
        confidence: "verified",
        sourceType: "manual",
      }),
    ],
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 80000 },
        travellers: { adults: 2, children: 0 },
        trip_start_date: "2026-05-05",
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, freeAttraction],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [freeAttraction]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.itinerary.budget_breakdown?.attractionSubtotal, 0);
  assert.equal(result.itinerary.budget_breakdown?.verifiedAttractionCostsCount, 1);
  assert.equal(result.itinerary.budget_breakdown?.unknownAttractionCostsCount, 0);
  // Verified-free should still emit a structured line item so downstream
  // UIs and analytics can distinguish "we know it's free" from "we never
  // modelled this attraction". The amount is 0 but the provenance snapshot
  // is expected to be present.
  const freeLine = result.itinerary.budget_breakdown?.line_items.find(
    (item) => item.kind === "attraction",
  );
  assert.ok(freeLine, "verified-free attractions should emit a 0 line item");
  assert.equal(freeLine.amount, 0);
  assert.equal(freeLine.provenance?.confidence, "verified");
  assert.equal(freeLine.provenance?.source_type, "manual");
  assert.equal(freeLine.provenance?.rule_id, "adm_free");
  assert.equal(freeLine.provenance?.currency, "INR");
});

test("generateItinerary excludes mismatched-currency admission rules and warns", async () => {
  const start = makeCity({ id: "node_start", name: "Start", dailyCost: 1800 });
  const end = makeCity({ id: "node_end", name: "End", dailyCost: 2200 });
  const attraction = makeAttraction({
    id: "attr_currency_mismatch",
    name: "USD Priced Fort",
    cityId: end.id,
    admissionRules: [
      makeAdmissionRule({
        id: "adm_usd",
        attractionNodeId: "attr_currency_mismatch",
        amount: 25,
        currency: "USD",
        confidence: "verified",
        sourceType: "manual",
      }),
    ],
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 80000, currency: "INR" },
        travellers: { adults: 2, children: 0 },
        trip_start_date: "2026-05-05",
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, attraction],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [attraction]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.itinerary.budget_breakdown?.attractionSubtotal, 0);
  assert.equal(result.itinerary.budget_breakdown?.unknownAttractionCostsCount, 1);
  assert.ok(
    (result.itinerary.warnings ?? []).some(
      (warning) =>
        warning.includes("USD Priced Fort") &&
        warning.includes("USD") &&
        warning.includes("INR"),
    ),
    "expected a currency-mismatch warning that names both currencies",
  );
});

test("generateItinerary does not apply admission rules outside their validity window", async () => {
  const start = makeCity({ id: "node_start", name: "Start", dailyCost: 1800 });
  const end = makeCity({ id: "node_end", name: "End", dailyCost: 2200 });
  const attraction = makeAttraction({
    id: "attr_expired_rule",
    name: "Seasonal Fort",
    cityId: end.id,
    admissionRules: [
      makeAdmissionRule({
        id: "adm_expired",
        attractionNodeId: "attr_expired_rule",
        amount: 300,
        confidence: "verified",
        validFrom: "2026-01-01",
        validUntil: "2026-01-31",
      }),
    ],
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 80000, currency: "INR" },
        travellers: { adults: 2, children: 0 },
        trip_start_date: "2026-05-05",
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, attraction],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [attraction]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.itinerary.budget_breakdown?.attractionSubtotal, 0);
  assert.equal(result.itinerary.budget_breakdown?.unknownAttractionCostsCount, 1);
  assert.equal(
    result.itinerary.budget_breakdown?.line_items.some(
      (item) => item.kind === "attraction",
    ),
    false,
  );
});

test("generateItinerary picks domestic vs foreigner pricing from the attraction's country", async () => {
  const start = makeCity({ id: "node_start", name: "Start", dailyCost: 1800 });
  const end = makeCity({ id: "node_end", name: "End", dailyCost: 2200 });
  const attraction = {
    ...makeAttraction({
      id: "attr_palace",
      name: "Royal Palace",
      cityId: end.id,
      admissionRules: [
        makeAdmissionRule({
          id: "adm_palace_domestic",
          attractionNodeId: "attr_palace",
          amount: 200,
          nationality: "domestic",
          confidence: "verified",
        }),
        makeAdmissionRule({
          id: "adm_palace_foreigner",
          attractionNodeId: "attr_palace",
          amount: 1000,
          nationality: "foreigner",
          confidence: "verified",
        }),
      ],
    }),
    country: "india",
  };

  const indianResult = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 80000, currency: "INR" },
        travellers: { adults: 2, children: 0, guest_nationality: "IN" },
        trip_start_date: "2026-05-05",
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, attraction],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [attraction]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(indianResult.ok, true);
  if (!indianResult.ok) return;
  // 2 adults × INR 200 = 400 (domestic ticket)
  assert.equal(indianResult.itinerary.budget_breakdown?.attractionSubtotal, 400);
  const indianLine =
    indianResult.itinerary.budget_breakdown?.line_items.find(
      (item) => item.kind === "attraction",
    );
  assert.equal(indianLine?.provenance?.rule_id, "adm_palace_domestic");

  const foreignResult = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 80000, currency: "INR" },
        travellers: { adults: 2, children: 0, guest_nationality: "DE" },
        trip_start_date: "2026-05-05",
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, attraction],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [attraction]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(foreignResult.ok, true);
  if (!foreignResult.ok) return;
  // 2 adults × INR 1000 = 2000 (foreigner ticket)
  assert.equal(
    foreignResult.itinerary.budget_breakdown?.attractionSubtotal,
    2000,
  );
  const foreignLine =
    foreignResult.itinerary.budget_breakdown?.line_items.find(
      (item) => item.kind === "attraction",
    );
  assert.equal(foreignLine?.provenance?.rule_id, "adm_palace_foreigner");
});

test("generateItinerary includes estimated attraction costs and labels them", async () => {
  const start = makeCity({ id: "node_start", name: "Start", dailyCost: 1800 });
  const end = makeCity({ id: "node_end", name: "End", dailyCost: 2200 });
  const estimatedAttraction = makeAttraction({
    id: "attr_estimated",
    name: "Estimated Museum",
    cityId: end.id,
    admissionRules: [
      makeAdmissionRule({
        id: "adm_estimated",
        attractionNodeId: "attr_estimated",
        amount: 250,
        confidence: "estimated",
        sourceType: "estimated",
      }),
    ],
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 80000 },
        travellers: { adults: 2, children: 0 },
        trip_start_date: "2026-05-05",
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, estimatedAttraction],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [estimatedAttraction]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.itinerary.budget_breakdown?.attractionSubtotal, 500);
  assert.equal(result.itinerary.budget_breakdown?.estimatedAttractionCostsCount, 1);
  const estimatedLine = result.itinerary.budget_breakdown?.line_items.find(
    (item) => item.kind === "attraction",
  );
  assert.ok(estimatedLine);
  assert.equal(estimatedLine.amount, 500);
  assert.match(estimatedLine.label, /estimated/i);
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

test("generateItinerary moves a closed-day attraction to a later open day", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });
  const end = makeCity({ id: "node_end", name: "End", recommendedHours: 6 });
  const museum = makeAttraction({
    id: "attr_museum",
    name: "City Museum",
    cityId: end.id,
    openingHours: {
      id: "attr_museum",
      attraction_id: "attr_museum",
      region: "test-region",
      weekly_periods: [{ day: "tue", opens: "10:00", closes: "18:00" }],
      closed_days: ["mon"],
      source_type: "manual",
      confidence: "verified",
    },
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 40000 },
        trip_start_date: "2026-05-04", // Monday
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, museum],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [museum]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const day0Activities = result.itinerary.day_plan[0]?.activities ?? [];
  const day1Activities = result.itinerary.day_plan[1]?.activities ?? [];
  assert.equal(
    day0Activities.some((activity) => activity.node_id === museum.id),
    false,
  );
  assert.equal(
    day1Activities.some((activity) => activity.node_id === museum.id),
    true,
  );
});

test("generateItinerary keeps unknown-hour attractions schedulable and adds a warning", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });
  const end = makeCity({ id: "node_end", name: "End", recommendedHours: 6 });
  const unknownHoursAttraction = makeAttraction({
    id: "attr_unknown",
    name: "Unknown Hours Fort",
    cityId: end.id,
    openingHours: {
      id: "attr_unknown",
      attraction_id: "attr_unknown",
      region: "test-region",
      weekly_periods: [],
      source_type: "manual",
      confidence: "unknown",
    },
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 40000 },
        trip_start_date: "2026-05-04",
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, unknownHoursAttraction],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [unknownHoursAttraction]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const scheduledUnknownAttraction = result.itinerary.day_plan.some((day) =>
    day.activities.some((activity) => activity.node_id === unknownHoursAttraction.id),
  );
  assert.equal(scheduledUnknownAttraction, true);
  assert.ok(
    (result.itinerary.warnings ?? []).some((warning) =>
      warning.includes("Unknown Hours Fort"),
    ),
  );

  const scheduledActivity = result.itinerary.day_plan
    .flatMap((day) => day.activities)
    .find((activity) => activity.node_id === unknownHoursAttraction.id);
  assert.ok(scheduledActivity, "expected the unknown attraction to be scheduled");
  assert.equal(
    scheduledActivity.opening_time,
    undefined,
    "unknown-state activities must not surface heuristic opening times",
  );
  assert.equal(scheduledActivity.closing_time, undefined);
  assert.equal(scheduledActivity.opening_periods, undefined);
});

test("generateItinerary warns when an attraction relies on legacy estimated hours", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });
  const end = makeCity({ id: "node_end", name: "End", recommendedHours: 6 });
  // No `openingHours` doc, only legacy metadata. The resolver treats this as
  // state="known" with confidence="estimated" so the attraction still flows
  // through, but we expect a heads-up warning so users know it isn't verified.
  const heuristicAttraction = makeAttraction({
    id: "attr_heuristic",
    name: "Heuristic Haveli",
    cityId: end.id,
    openingTime: "10:00",
    closingTime: "18:00",
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 40000 },
        trip_start_date: "2026-05-05",
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, heuristicAttraction],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [heuristicAttraction]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const scheduled = result.itinerary.day_plan
    .flatMap((day) => day.activities)
    .find((activity) => activity.node_id === heuristicAttraction.id);
  assert.ok(scheduled, "expected the heuristic attraction to be scheduled");
  assert.equal(scheduled.opening_hours_state, "known");
  assert.equal(scheduled.opening_hours_confidence, "estimated");
  assert.ok(
    (result.itinerary.warnings ?? []).some(
      (warning) =>
        warning.includes("Heuristic Haveli") && warning.includes("estimated"),
    ),
    "expected a warning that flags the estimated opening hours",
  );
});

test("generateItinerary applies a same-date exception closure over weekly hours", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });
  const end = makeCity({ id: "node_end", name: "End", recommendedHours: 6 });
  const fort = makeAttraction({
    id: "attr_fort",
    name: "Public Holiday Fort",
    cityId: end.id,
    openingHours: {
      id: "attr_fort",
      attraction_id: "attr_fort",
      region: "test-region",
      weekly_periods: [
        { day: "mon", opens: "10:00", closes: "18:00" },
        { day: "tue", opens: "10:00", closes: "18:00" },
      ],
      // 2026-05-04 happens to be Monday — without the exception the fort
      // would be open. The exception forces the engine to push it to Tuesday.
      exceptions: [{ date: "2026-05-04", closed: true }],
      source_type: "manual",
      confidence: "verified",
    },
  });

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 40000 },
        trip_start_date: "2026-05-04",
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, fort],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [fort]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const day0Activities = result.itinerary.day_plan[0]?.activities ?? [];
  const day1Activities = result.itinerary.day_plan[1]?.activities ?? [];
  assert.equal(
    day0Activities.some((activity) => activity.node_id === fort.id),
    false,
    "exception closure should keep the fort off the start-day plan",
  );
  assert.equal(
    day1Activities.some((activity) => activity.node_id === fort.id),
    true,
  );
  assert.ok(
    (result.itinerary.warnings ?? []).some(
      (warning) =>
        warning.includes("Day 1") && warning.includes("Public Holiday Fort"),
    ),
    "expected a heads-up that the fort is closed on the exception day",
  );
});

test("generateItinerary fills a fully-closed day with explore filler and warns", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });
  const end = makeCity({ id: "node_end", name: "End", recommendedHours: 6 });
  const monClosed = (id: string, name: string) =>
    makeAttraction({
      id,
      name,
      cityId: end.id,
      openingHours: {
        id,
        attraction_id: id,
        region: "test-region",
        weekly_periods: [{ day: "tue", opens: "10:00", closes: "18:00" }],
        closed_days: ["mon"],
        source_type: "manual",
        confidence: "verified",
      },
    });
  const museum = monClosed("attr_museum", "Mon-closed Museum");
  const palace = monClosed("attr_palace", "Mon-closed Palace");

  const result = await generateItinerary(
    {
      regions: ["test-region"],
      start_node: start.id,
      end_node: end.id,
      days: 2,
      preferences: {
        travel_style: "balanced",
        budget: { min: 0, max: 40000 },
        trip_start_date: "2026-05-04", // Monday → both attractions closed
        travellers: { adults: 2, children: 0 },
        transport_modes: ["road"],
      },
    },
    makeContext(
      [start, end, museum, palace],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [museum, palace]]]),
    ),
    { resolveTravelMatrix: strictResolver },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const day0Activities = result.itinerary.day_plan[0]?.activities ?? [];
  for (const activity of day0Activities) {
    assert.notEqual(
      activity.node_id,
      museum.id,
      "closed attraction must not leak into the day plan",
    );
    assert.notEqual(activity.node_id, palace.id);
  }
  assert.ok(
    day0Activities.length > 0,
    "expected an explore filler when all attractions are closed",
  );
  assert.ok(
    day0Activities.every((activity) => activity.node_id === end.id),
    "filler activities should reference the city base node",
  );
  assert.ok(
    (result.itinerary.warnings ?? []).some(
      (warning) =>
        warning.includes("Day 1") &&
        warning.includes("2 attractions closed") &&
        warning.includes("Mon-closed Museum"),
    ),
    "expected a heads-up that two attractions are closed on Day 1",
  );
});

test("generateItinerary returns deterministic plans on repeated runs", async () => {
  const start = makeCity({ id: "node_start", name: "Start" });
  const end = makeCity({ id: "node_end", name: "End", recommendedHours: 6 });
  const museum = makeAttraction({
    id: "attr_museum",
    name: "Determinism Museum",
    cityId: end.id,
    openingHours: {
      id: "attr_museum",
      attraction_id: "attr_museum",
      region: "test-region",
      weekly_periods: [
        { day: "mon", opens: "09:00", closes: "17:00" },
        { day: "tue", opens: "09:00", closes: "17:00" },
      ],
      closed_days: ["wed"],
      source_type: "manual",
      confidence: "verified",
    },
  });
  const garden = makeAttraction({
    id: "attr_garden",
    name: "Determinism Garden",
    cityId: end.id,
    openingHours: {
      id: "attr_garden",
      attraction_id: "attr_garden",
      region: "test-region",
      weekly_periods: [
        { day: "mon", opens: "08:00", closes: "20:00" },
        { day: "tue", opens: "08:00", closes: "20:00" },
        { day: "wed", opens: "08:00", closes: "20:00" },
      ],
      source_type: "manual",
      confidence: "verified",
    },
  });

  const buildInput = (): GenerateItineraryInput => ({
    regions: ["test-region"],
    start_node: start.id,
    end_node: end.id,
    days: 2,
    preferences: {
      travel_style: "balanced",
      budget: { min: 0, max: 40000 },
      trip_start_date: "2026-05-04",
      travellers: { adults: 2, children: 0 },
      transport_modes: ["road"],
    },
  });
  const buildContext = () =>
    makeContext(
      [start, end, museum, garden],
      [makeRoadEdge({ from: start.id, to: end.id, hours: 2, distance: 110 })],
      new Map([[end.id, [museum, garden]]]),
    );

  const first = await generateItinerary(buildInput(), buildContext(), {
    resolveTravelMatrix: strictResolver,
  });
  const second = await generateItinerary(buildInput(), buildContext(), {
    resolveTravelMatrix: strictResolver,
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepStrictEqual(first.itinerary.day_plan, second.itinerary.day_plan);
  assert.deepStrictEqual(
    first.itinerary.warnings ?? [],
    second.itinerary.warnings ?? [],
  );
  assert.deepStrictEqual(first.itinerary.nodes, second.itinerary.nodes);
});
