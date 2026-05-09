import assert from "node:assert/strict";
import test from "node:test";

import { generateItinerary } from "@/lib/itinerary/engine";
import { validateEngineResult } from "@/lib/itinerary/robustness/invariants";
import {
  OfflineNetworkError,
  installOfflineNetworkGuard,
} from "@/lib/itinerary/robustness/offlineNetworkGuard";
import {
  buildReplayPayload,
  replayPayloadToJson,
  scenarioToEngineContext,
  stableStringify,
  toAttractionsByCityRecord,
} from "@/lib/itinerary/robustness/serialization";
import {
  generateScenario,
  makeOfflineResolver,
  type LoadedScenarioDataset,
} from "@/lib/itinerary/robustness/scenarios";
import type { GeneratedScenario } from "@/lib/itinerary/robustness/types";
import type { GraphEdge, GraphNode } from "@/types/domain";

function makeCity(id: string, name: string, lat: number, lng: number): GraphNode {
  return {
    id,
    type: "city",
    name,
    region: "rajasthan",
    country: "india",
    tags: ["heritage", "culture"],
    metadata: {
      avg_daily_cost: 2200,
      recommended_hours: 8,
      description: `${name} test city`,
    },
    location: { lat, lng },
    source: "manual",
  };
}

function makeAttraction(id: string, cityId: string, name: string): GraphNode {
  return {
    id,
    type: "attraction",
    name,
    region: "rajasthan",
    country: "india",
    tags: ["heritage"],
    parent_node_id: cityId,
    metadata: {
      recommended_hours: 2,
      avg_daily_cost: 300,
      description: `${name} test attraction`,
    },
    location: { lat: 26.91, lng: 75.81 },
    source: "manual",
  };
}

function makeRoadEdge(from: string, to: string, travelHours: number): GraphEdge {
  return {
    id: `edge_${from}_${to}_road`,
    from,
    to,
    type: "road",
    distance_km: Number((travelHours * 55).toFixed(1)),
    travel_time_hours: travelHours,
    bidirectional: true,
    regions: ["rajasthan"],
    metadata: {},
  };
}

function makeSmallDataset(): LoadedScenarioDataset {
  const jaipur = makeCity("mini_jaipur", "Jaipur", 26.91, 75.79);
  const udaipur = makeCity("mini_udaipur", "Udaipur", 24.58, 73.68);
  const palace = makeAttraction("mini_city_palace", udaipur.id, "City Palace");

  return {
    id: "mini-rajasthan",
    nodes: [jaipur, udaipur, palace],
    edges: [makeRoadEdge(jaipur.id, udaipur.id, 6.2)],
    attractionsByCity: {
      [udaipur.id]: [palace],
    },
  };
}

function findMustPlanScenario(
  seed: string,
  datasets: readonly LoadedScenarioDataset[],
): GeneratedScenario {
  for (let caseIndex = 0; caseIndex < 12; caseIndex += 1) {
    const candidate = generateScenario({
      profile: "quick",
      seed,
      caseIndex,
      datasets,
    });
    if (candidate.expectation === "must_plan") {
      return candidate;
    }
  }

  throw new Error("Could not generate a deterministic must_plan scenario for test.");
}

test("same seed/profile/caseIndex produces identical stable JSON", () => {
  const datasets = [makeSmallDataset()];
  const first = generateScenario({
    profile: "quick",
    seed: "checkpoint-c-determinism-seed",
    caseIndex: 4,
    datasets,
  });
  const second = generateScenario({
    profile: "quick",
    seed: "checkpoint-c-determinism-seed",
    caseIndex: 4,
    datasets,
  });

  assert.equal(replayPayloadToJson(first), replayPayloadToJson(second));
});

test("different caseIndex changes scenario id or input", () => {
  const datasets = [makeSmallDataset()];
  const first = generateScenario({
    profile: "quick",
    seed: "checkpoint-c-case-diff-seed",
    caseIndex: 1,
    datasets,
  });
  const second = generateScenario({
    profile: "quick",
    seed: "checkpoint-c-case-diff-seed",
    caseIndex: 2,
    datasets,
  });

  const sameInput = stableStringify(first.input) === stableStringify(second.input);
  assert.equal(first.id !== second.id || !sameInput, true);
});

test("small generated must_plan scenario succeeds with offline resolver and no invariant violations", async () => {
  const datasets = [makeSmallDataset()];
  const scenario = findMustPlanScenario("checkpoint-c-must-plan-seed", datasets);
  const resolver = makeOfflineResolver();

  assert.equal(scenario.expectation, "must_plan");
  const startedAt = Date.now();
  const result = await generateItinerary(
    scenario.input,
    scenarioToEngineContext(scenario),
    { resolveTravelMatrix: resolver },
  );
  const elapsedMs = Date.now() - startedAt;
  const violations = validateEngineResult(scenario, result, elapsedMs);

  assert.deepEqual(
    violations,
    [],
    `expected no invariant violations, got: ${stableStringify(violations)}`,
  );
});

test("serialization round-trip preserves input and context", () => {
  const datasets = [makeSmallDataset()];
  const scenario = generateScenario({
    profile: "quick",
    seed: "checkpoint-c-roundtrip-seed",
    caseIndex: 6,
    datasets,
  });
  const replayPayload = buildReplayPayload(scenario);
  const roundTrip = JSON.parse(
    stableStringify(replayPayload),
  ) as typeof replayPayload;

  // Compare normalized JSON shapes because `undefined` fields are omitted by JSON.
  assert.equal(
    stableStringify(roundTrip.scenario.input),
    stableStringify(scenario.input),
  );
  assert.equal(
    stableStringify(roundTrip.scenario.context.nodes),
    stableStringify(scenario.context.nodes),
  );
  assert.equal(
    stableStringify(roundTrip.scenario.context.edges),
    stableStringify(scenario.context.edges),
  );
  assert.deepEqual(
    roundTrip.scenario.context.attractionsByCity ?? {},
    toAttractionsByCityRecord(scenario.context.attractionsByCity) ?? {},
  );
});

test("offline network guard blocks fetch", async (t) => {
  if (typeof fetch !== "function") {
    t.skip("global fetch is unavailable in this runtime.");
    return;
  }

  const guard = installOfflineNetworkGuard(() => 123456789);
  try {
    await assert.rejects(
      async () => {
        await fetch("https://example.com/guard-check");
      },
      (error: unknown) => error instanceof OfflineNetworkError,
    );
    assert.equal(guard.getAttemptCount(), 1);
    assert.equal(guard.getAttempts()[0]?.atEpochMs, 123456789);
  } finally {
    guard.restore();
  }
});
