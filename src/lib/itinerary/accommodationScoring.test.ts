import assert from "node:assert/strict";
import test from "node:test";

import type { Accommodation } from "@/types/domain";
import {
  scoreAccommodation,
  sortScoredAccommodations,
} from "@/lib/itinerary/accommodationScoring";

function makeAccommodation(
  overrides: Partial<Accommodation> = {},
): Accommodation {
  return {
    id: "acc_test",
    regionId: "test-region",
    nodeId: "node_jaipur",
    name: "Test Stay",
    category: "midrange",
    pricePerNight: 2600,
    currency: "INR",
    rating: 4.2,
    reviewCount: 1200,
    amenities: ["wifi", "breakfast", "air_conditioning"],
    location: { lat: 26.9, lng: 75.8 },
    distanceFromCenterKm: 1,
    active: true,
    ...overrides,
  };
}

const context = {
  travelStyle: "balanced" as const,
  accommodationPreference: "midrange" as const,
  nightlyBudget: { min: 1200, max: 3200 },
  interests: ["heritage"],
};

test("scoreAccommodation rewards stronger value, rating, and location fit", () => {
  const better = scoreAccommodation(
    makeAccommodation({
      id: "acc_better",
      category: "heritage",
      rating: 4.6,
      reviewCount: 1800,
      pricePerNight: 2900,
      distanceFromCenterKm: 0.5,
      amenities: ["wifi", "breakfast", "parking", "air_conditioning"],
    }),
    context,
  );
  const worse = scoreAccommodation(
    makeAccommodation({
      id: "acc_worse",
      rating: 3.9,
      reviewCount: 300,
      pricePerNight: 3400,
      distanceFromCenterKm: 5.5,
      amenities: ["wifi"],
    }),
    context,
  );

  assert.ok(better.score > worse.score);
});

test("sortScoredAccommodations uses score, then price, then lexicographic id", () => {
  const sameA = scoreAccommodation(makeAccommodation({ id: "acc_b" }), context);
  const sameB = scoreAccommodation(makeAccommodation({ id: "acc_a" }), context);
  const cheaper = scoreAccommodation(
    makeAccommodation({ id: "acc_c", pricePerNight: 2400 }),
    context,
  );

  const ordered = sortScoredAccommodations([sameA, sameB, cheaper]);

  assert.equal(ordered[0].accommodation.id, "acc_c");
  assert.equal(ordered[1].accommodation.id, "acc_a");
  assert.equal(ordered[2].accommodation.id, "acc_b");
});
