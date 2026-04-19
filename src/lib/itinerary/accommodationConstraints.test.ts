import assert from "node:assert/strict";
import test from "node:test";

import type { Accommodation } from "@/types/domain";
import {
  defaultAccommodationRatingThreshold,
  deriveAllowedAccommodationCategories,
  deriveNightlyBudgetRange,
  filterAccommodationsForStay,
} from "@/lib/itinerary/accommodationConstraints";

function makeAccommodation(
  overrides: Partial<Accommodation> = {},
): Accommodation {
  return {
    id: "acc_test",
    regionId: "test-region",
    nodeId: "node_jaipur",
    name: "Test Stay",
    category: "midrange",
    pricePerNight: 2800,
    currency: "INR",
    rating: 4.3,
    reviewCount: 900,
    amenities: ["wifi", "breakfast"],
    location: { lat: 26.9, lng: 75.8 },
    distanceFromCenterKm: 1.2,
    active: true,
    ...overrides,
  };
}

test("filterAccommodationsForStay applies city, activity, category, budget, and rating filters", () => {
  const matches = filterAccommodationsForStay(
    [
      makeAccommodation({ id: "acc_good" }),
      makeAccommodation({ id: "acc_wrong_city", nodeId: "node_udaipur" }),
      makeAccommodation({ id: "acc_inactive", active: false }),
      makeAccommodation({ id: "acc_expensive", pricePerNight: 5200 }),
      makeAccommodation({ id: "acc_low_rating", rating: 3.6 }),
      makeAccommodation({ id: "acc_hostel", category: "hostel" }),
    ],
    {
      nodeId: "node_jaipur",
      activeOnly: true,
      allowedCategories: ["midrange", "heritage"],
      nightlyBudget: { min: 0, max: 4000 },
      minRating: 4,
    },
  );

  assert.deepEqual(matches.map((accommodation) => accommodation.id), [
    "acc_good",
  ]);
});

test("deriveAllowedAccommodationCategories narrows categories by travel style and preference", () => {
  assert.deepEqual(
    deriveAllowedAccommodationCategories({
      travelStyle: "relaxed",
      accommodationPreference: "budget",
    }),
    ["budget", "midrange"],
  );
});

test("deriveNightlyBudgetRange deterministically converts trip budget into a nightly window", () => {
  const nightlyBudget = deriveNightlyBudgetRange({
    budget: { min: 10000, max: 30000, currency: "INR" },
    totalNights: 5,
    travelStyle: "balanced",
    accommodationPreference: "midrange",
  });

  assert.deepEqual(nightlyBudget, {
    min: 900,
    max: 2700,
  });
});

test("defaultAccommodationRatingThreshold only raises the bar when the tier warrants it", () => {
  assert.equal(defaultAccommodationRatingThreshold("auto"), undefined);
  assert.equal(defaultAccommodationRatingThreshold("budget"), 3.2);
  assert.equal(defaultAccommodationRatingThreshold("premium"), 4.2);
});
