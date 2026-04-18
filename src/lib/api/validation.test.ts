import assert from "node:assert/strict";
import test from "node:test";

import { generateItinerarySchema } from "@/lib/api/validation";

const baseBody = {
  region: "rajasthan",
  start_node: "node_jaipur",
  end_node: "node_udaipur",
  days: 5,
  preferences: {
    travel_style: "balanced" as const,
    budget: { min: 15000, max: 45000, currency: "INR" },
    interests: ["heritage", "food"],
    transport_modes: ["road" as const],
  },
};

test("generateItinerarySchema accepts a fully populated request", () => {
  const result = generateItinerarySchema.safeParse(baseBody);
  assert.equal(result.success, true);
});

test("generateItinerarySchema accepts city-coverage prioritisation", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    preferences: {
      ...baseBody.preferences,
      prioritize_city_coverage: true,
    },
  });
  assert.equal(result.success, true);
});

test("generateItinerarySchema accepts a minimal request without optional fields", () => {
  const result = generateItinerarySchema.safeParse({
    region: "rajasthan",
    start_node: "node_jaipur",
    days: 3,
    preferences: {
      travel_style: "relaxed",
      budget: { min: 0, max: 10000 },
    },
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.end_node, undefined);
  assert.equal(result.data.preferences.transport_modes, undefined);
});

test("generateItinerarySchema rejects an empty region", () => {
  const result = generateItinerarySchema.safeParse({ ...baseBody, region: "" });
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects a negative day count", () => {
  const result = generateItinerarySchema.safeParse({ ...baseBody, days: 0 });
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects a trip longer than the 30-day cap", () => {
  const result = generateItinerarySchema.safeParse({ ...baseBody, days: 31 });
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects a non-integer day count", () => {
  const result = generateItinerarySchema.safeParse({ ...baseBody, days: 2.5 });
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects an unknown travel style", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    preferences: { ...baseBody.preferences, travel_style: "extreme" },
  });
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects an unknown transport mode", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    preferences: { ...baseBody.preferences, transport_modes: ["teleport"] },
  });
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects negative budget values", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    preferences: { ...baseBody.preferences, budget: { min: -1, max: 1000 } },
  });
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects more than 10 extra regions", () => {
  const tooMany = Array.from({ length: 11 }, (_, i) => `region_${i}`);
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    regions: tooMany,
  });
  assert.equal(result.success, false);
});

test("generateItinerarySchema accepts up to 10 extra regions", () => {
  const ten = Array.from({ length: 10 }, (_, i) => `region_${i}`);
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    regions: ten,
  });
  assert.equal(result.success, true);
});
