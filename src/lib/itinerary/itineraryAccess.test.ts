import assert from "node:assert/strict";
import test from "node:test";

import { canAccessItinerary } from "@/lib/itinerary/itineraryAccess";

test("canAccessItinerary allows guest itineraries without auth", () => {
  assert.equal(
    canAccessItinerary({
      itineraryUserId: null,
      requesterUserId: null,
    }),
    true,
  );
});

test("canAccessItinerary allows owners to read saved itineraries", () => {
  assert.equal(
    canAccessItinerary({
      itineraryUserId: "uid_owner",
      requesterUserId: "uid_owner",
    }),
    true,
  );
});

test("canAccessItinerary blocks non-owners from saved itineraries", () => {
  assert.equal(
    canAccessItinerary({
      itineraryUserId: "uid_owner",
      requesterUserId: "uid_other",
    }),
    false,
  );
});

test("canAccessItinerary blocks unauthenticated access to saved itineraries", () => {
  assert.equal(
    canAccessItinerary({
      itineraryUserId: "uid_owner",
      requesterUserId: null,
    }),
    false,
  );
});

test("canAccessItinerary does not treat blank owner ids as public", () => {
  assert.equal(
    canAccessItinerary({
      itineraryUserId: "",
      requesterUserId: null,
    }),
    false,
  );
  assert.equal(
    canAccessItinerary({
      itineraryUserId: "   ",
      requesterUserId: null,
    }),
    false,
  );
});
