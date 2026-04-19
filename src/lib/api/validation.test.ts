import assert from "node:assert/strict";
import test from "node:test";

import { generateItinerarySchema } from "@/lib/api/validation";

const baseBody = {
  regions: ["rajasthan"],
  start_node: "node_jaipur",
  end_node: "node_udaipur",
  days: 5,
  preferences: {
    travel_style: "balanced" as const,
    budget: { min: 15000, max: 45000, currency: "INR" },
    travellers: { adults: 2, children: 1 },
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

test("generateItinerarySchema accepts an accommodation preference override", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    preferences: {
      ...baseBody.preferences,
      accommodation_preference: "premium",
    },
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.preferences.accommodation_preference, "premium");
});

test("generateItinerarySchema accepts the legacy accommodationPreference alias", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    preferences: {
      ...baseBody.preferences,
      accommodationPreference: "premium",
    },
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.preferences.accommodation_preference, "premium");
});

test("generateItinerarySchema rejects mismatched accommodation preference aliases", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    preferences: {
      ...baseBody.preferences,
      accommodation_preference: "premium",
      accommodationPreference: "budget",
    },
  });
  assert.equal(result.success, false);
});

test("generateItinerarySchema accepts a minimal request without optional fields", () => {
  const result = generateItinerarySchema.safeParse({
    regions: ["rajasthan"],
    start_node: "node_jaipur",
    days: 3,
    preferences: {
      travel_style: "relaxed",
      budget: { min: 0, max: 10000 },
      travellers: { adults: 1, children: 0 },
    },
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.end_node, undefined);
  assert.equal(result.data.preferences.transport_modes, undefined);
});

test("generateItinerarySchema rejects an empty regions array", () => {
  const result = generateItinerarySchema.safeParse({ ...baseBody, regions: [] });
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects a region slug that's an empty string", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    regions: [""],
  });
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects a missing regions field", () => {
  const { regions: _regions, ...rest } = baseBody;
  void _regions;
  const result = generateItinerarySchema.safeParse(rest);
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects a negative day count", () => {
  const result = generateItinerarySchema.safeParse({ ...baseBody, days: 0 });
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects a trip longer than the 7-day cap", () => {
  const result = generateItinerarySchema.safeParse({ ...baseBody, days: 8 });
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

test("generateItinerarySchema rejects an unknown accommodation preference", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    preferences: {
      ...baseBody.preferences,
      accommodation_preference: "ultra-luxury",
    },
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

test("generateItinerarySchema requires at least one adult traveller", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    preferences: {
      ...baseBody.preferences,
      travellers: { adults: 0, children: 2 },
    },
  });
  assert.equal(result.success, false);
});

test("generateItinerarySchema requires at least one transport mode when provided", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    preferences: {
      ...baseBody.preferences,
      transport_modes: [],
    },
  });
  assert.equal(result.success, false);
});

test("generateItinerarySchema rejects more than 10 regions", () => {
  const tooMany = Array.from({ length: 11 }, (_, i) => `region_${i}`);
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    regions: tooMany,
  });
  assert.equal(result.success, false);
});

test("generateItinerarySchema accepts a valid HH:MM preferred_start_time", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    preferences: { ...baseBody.preferences, preferred_start_time: "07:30" },
  });
  assert.equal(result.success, true);
});

test("generateItinerarySchema rejects a malformed preferred_start_time", () => {
  for (const bad of ["7:30", "25:00", "noon", "07-30", "07:60"]) {
    const result = generateItinerarySchema.safeParse({
      ...baseBody,
      preferences: { ...baseBody.preferences, preferred_start_time: bad },
    });
    assert.equal(result.success, false, `expected ${bad} to be rejected`);
  }
});

test("generateItinerarySchema accepts up to 10 regions", () => {
  const ten = Array.from({ length: 10 }, (_, i) => `region_${i}`);
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    regions: ten,
  });
  assert.equal(result.success, true);
});

test("generateItinerarySchema accepts optional requested city ids", () => {
  const result = generateItinerarySchema.safeParse({
    ...baseBody,
    requested_city_ids: ["node_udaipur", "node_jodhpur"],
  });
  assert.equal(result.success, true);
});
