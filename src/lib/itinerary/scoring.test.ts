import assert from "node:assert/strict";
import test from "node:test";

import type { GraphNode, ItineraryPreferences } from "@/types/domain";
import {
  computeTagOverlap,
  scoreCandidateNode,
  scoreItinerary,
} from "@/lib/itinerary/scoring";

function makeNode(args: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    type: "city",
    name: args.name ?? args.id,
    region: "test-region",
    country: "test-country",
    tags: ["heritage"],
    metadata: { recommended_hours: 8 },
    location: { lat: 26, lng: 75 },
    ...args,
  };
}

const balancedPrefs: ItineraryPreferences = {
  travel_style: "balanced",
  budget: { min: 0, max: 50000 },
  interests: ["heritage", "food"],
  transport_modes: ["road"],
};

// ------------------------- computeTagOverlap --------------------------------

test("computeTagOverlap returns 1 when every interest is matched", () => {
  assert.equal(
    computeTagOverlap(["heritage", "food"], ["heritage", "food"]),
    1,
  );
});

test("computeTagOverlap returns 0.5 when interests are empty (neutral prior)", () => {
  assert.equal(computeTagOverlap(["heritage"], []), 0.5);
});

test("computeTagOverlap is case-insensitive", () => {
  assert.equal(computeTagOverlap(["Heritage"], ["heritage"]), 1);
});

test("computeTagOverlap returns the correct partial match ratio", () => {
  assert.equal(
    computeTagOverlap(["heritage"], ["heritage", "food"]),
    0.5,
  );
});

test("computeTagOverlap returns 0 when nothing matches", () => {
  assert.equal(computeTagOverlap(["beach"], ["heritage", "food"]), 0);
});

// ------------------------- scoreCandidateNode -------------------------------

test("scoreCandidateNode rewards close, on-tag, well-documented nodes", () => {
  const start = makeNode({ id: "node_start", location: { lat: 26.9, lng: 75.7 } });
  const close = makeNode({
    id: "node_close",
    location: { lat: 27.0, lng: 75.8 },
    tags: ["heritage", "food"],
    metadata: { recommended_hours: 18 },
  });
  const far = makeNode({
    id: "node_far",
    location: { lat: 12.9, lng: 80.1 },
    tags: ["beach"],
    metadata: { recommended_hours: 4 },
  });

  const scoreClose = scoreCandidateNode(close, start, balancedPrefs);
  const scoreFar = scoreCandidateNode(far, start, balancedPrefs);

  assert.ok(
    scoreClose.score > scoreFar.score,
    `close (${scoreClose.score}) should outrank far (${scoreFar.score})`,
  );
  assert.ok(scoreClose.factors.tagMatch >= 1);
  assert.ok(scoreClose.factors.popularity > scoreFar.factors.popularity);
});

test("scoreCandidateNode normalises every factor into [0, 1]", () => {
  const start = makeNode({ id: "s" });
  const candidate = makeNode({ id: "c", metadata: { recommended_hours: 100 } });

  const scored = scoreCandidateNode(candidate, start, balancedPrefs);

  for (const value of [
    scored.score,
    scored.factors.proximity,
    scored.factors.tagMatch,
    scored.factors.popularity,
  ]) {
    assert.ok(value >= 0 && value <= 1, `${value} not in [0, 1]`);
  }
});

test("scoreCandidateNode honours an explicit ideal radius override", () => {
  const start = makeNode({ id: "s", location: { lat: 0, lng: 0 } });
  const candidate = makeNode({
    id: "c",
    location: { lat: 0, lng: 5 }, // ~555 km
  });

  const tight = scoreCandidateNode(candidate, start, balancedPrefs, 200);
  const wide = scoreCandidateNode(candidate, start, balancedPrefs, 5000);

  assert.notEqual(tight.factors.proximity, wide.factors.proximity);
});

// ------------------------- scoreItinerary -----------------------------------

test("scoreItinerary returns a value in [0, 1]", () => {
  const score = scoreItinerary({
    destinationScores: [0.6, 0.7],
    budgetUtilisation: 0.85,
    totalTravelHours: 10,
    daysAvailable: 4,
    maxTravelHoursPerDay: 6,
  });
  assert.ok(score >= 0 && score <= 1);
});

test("scoreItinerary rewards trips with high destination scores and ideal budget use", () => {
  const great = scoreItinerary({
    destinationScores: [0.9, 0.95, 0.92],
    budgetUtilisation: 0.85,
    totalTravelHours: 8,
    daysAvailable: 4,
    maxTravelHoursPerDay: 6,
  });
  const mediocre = scoreItinerary({
    destinationScores: [0.4, 0.45],
    budgetUtilisation: 0.2,
    totalTravelHours: 8,
    daysAvailable: 4,
    maxTravelHoursPerDay: 6,
  });
  assert.ok(great > mediocre);
});

test("scoreItinerary penalises itineraries that burn most of the trip on the road", () => {
  const reasonable = scoreItinerary({
    destinationScores: [0.7],
    budgetUtilisation: 0.85,
    totalTravelHours: 6,
    daysAvailable: 4,
    maxTravelHoursPerDay: 6,
  });
  const exhausting = scoreItinerary({
    destinationScores: [0.7],
    budgetUtilisation: 0.85,
    totalTravelHours: 23,
    daysAvailable: 4,
    maxTravelHoursPerDay: 6,
  });
  assert.ok(reasonable > exhausting);
});

test("scoreItinerary handles an empty destination list gracefully", () => {
  const score = scoreItinerary({
    destinationScores: [],
    budgetUtilisation: 0.5,
    totalTravelHours: 0,
    daysAvailable: 1,
    maxTravelHoursPerDay: 6,
  });
  assert.ok(Number.isFinite(score));
  assert.ok(score >= 0 && score <= 1);
});
