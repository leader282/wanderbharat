import assert from "node:assert/strict";
import test from "node:test";

import type { Accommodation } from "@/types/domain";
import { selectOptimalRoomAllocation } from "@/lib/itinerary/roomAllocation";

function makeAccommodation(
  overrides: Partial<Accommodation> = {},
): Accommodation {
  return {
    id: "acc_test",
    regionId: "test-region",
    nodeId: "node_test",
    name: "Test Stay",
    category: "midrange",
    pricePerNight: 3200,
    currency: "INR",
    rating: 4.3,
    reviewCount: 900,
    amenities: ["wifi", "breakfast"],
    roomTypes: [
      {
        id: "standard",
        name: "Standard Room",
        pricePerNight: 4000,
        maxAdults: 2,
        maxChildren: 1,
        maxOccupancy: 3,
      },
      {
        id: "family",
        name: "Family Room",
        pricePerNight: 7500,
        maxAdults: 2,
        maxChildren: 2,
        maxOccupancy: 4,
      },
      {
        id: "double",
        name: "Deluxe Double",
        pricePerNight: 4300,
        maxAdults: 2,
        maxChildren: 0,
        maxOccupancy: 2,
      },
    ],
    location: { lat: 26.9, lng: 75.8 },
    distanceFromCenterKm: 1.2,
    active: true,
    ...overrides,
  };
}

test("selectOptimalRoomAllocation chooses the lowest-cost feasible combination", () => {
  const allocation = selectOptimalRoomAllocation({
    accommodation: makeAccommodation(),
    travellers: { adults: 3, children: 2 },
    nights: 2,
  });

  assert.ok(allocation);
  assert.equal(allocation?.totalRooms, 2);
  assert.deepEqual(
    allocation?.rooms.map((room) => ({
      roomTypeId: room.roomTypeId,
      roomCount: room.roomCount,
      nightlyCost: room.nightlyCost,
    })),
    [
      { roomTypeId: "standard", roomCount: 2, nightlyCost: 8000 },
    ],
  );
});

test("selectOptimalRoomAllocation breaks same-cost ties by using fewer rooms", () => {
  const allocation = selectOptimalRoomAllocation({
    accommodation: makeAccommodation({
      roomTypes: [
        {
          id: "twin_pair",
          name: "Twin Pair",
          pricePerNight: 2600,
          maxAdults: 1,
          maxChildren: 1,
          maxOccupancy: 2,
        },
        {
          id: "family_room",
          name: "Family Room",
          pricePerNight: 5200,
          maxAdults: 2,
          maxChildren: 2,
          maxOccupancy: 4,
        },
      ],
    }),
    travellers: { adults: 2, children: 2 },
    nights: 1,
  });

  assert.ok(allocation);
  assert.equal(allocation?.totalRooms, 1);
  assert.equal(allocation?.rooms[0]?.roomTypeId, "family_room");
});

test("selectOptimalRoomAllocation returns null when no room mix can fit the party", () => {
  const allocation = selectOptimalRoomAllocation({
    accommodation: makeAccommodation({
      roomTypes: [
        {
          id: "double_only",
          name: "Double Room",
          pricePerNight: 3200,
          maxAdults: 2,
          maxChildren: 0,
          maxOccupancy: 2,
        },
      ],
    }),
    travellers: { adults: 2, children: 2 },
    nights: 1,
  });

  assert.equal(allocation, null);
});

test("selectOptimalRoomAllocation never assigns children to a room with no adults", () => {
  // Two adults, three children. Standards seat (2A+1C) max; if the planner
  // ever allowed a third "kids only" standard at 4000 it would beat the
  // family room. With the supervision rule the only correct answer is
  // family + standard so every child has a supervising adult.
  const allocation = selectOptimalRoomAllocation({
    accommodation: makeAccommodation(),
    travellers: { adults: 2, children: 3 },
    nights: 1,
  });

  assert.ok(allocation);
  const childrenInUnsupervisedRooms =
    allocation?.rooms.reduce((tally, room) => {
      const allowsAdults = (room.maxAdults ?? Infinity) > 0;
      return allowsAdults ? tally : tally + room.roomCount;
    }, 0) ?? 0;
  assert.equal(childrenInUnsupervisedRooms, 0);
  assert.equal(allocation?.totalRooms, 2);
  assert.deepEqual(
    allocation?.rooms
      .map((room) => ({
        roomTypeId: room.roomTypeId,
        roomCount: room.roomCount,
      }))
      .sort((left, right) => left.roomTypeId.localeCompare(right.roomTypeId)),
    [
      { roomTypeId: "family", roomCount: 1 },
      { roomTypeId: "standard", roomCount: 1 },
    ],
  );
});

test("selectOptimalRoomAllocation returns null when supervision cannot be satisfied", () => {
  // 1 adult + 2 children with a single standard (2A+1C) room type. The
  // adult can take one child in the standard, but the second child has
  // no adult to chaperone — the stay cannot host this party.
  const allocation = selectOptimalRoomAllocation({
    accommodation: makeAccommodation({
      roomTypes: [
        {
          id: "standard_only",
          name: "Standard Room",
          pricePerNight: 4000,
          maxAdults: 2,
          maxChildren: 1,
          maxOccupancy: 3,
        },
      ],
    }),
    travellers: { adults: 1, children: 2 },
    nights: 1,
  });

  assert.equal(allocation, null);
});

test("selectOptimalRoomAllocation falls back to a family suite when standard rooms cannot supervise every child", () => {
  // Same 1A + 2C party, but a family suite is available. The planner must
  // prefer it because that's the only way to keep both children with the
  // single supervising adult.
  const allocation = selectOptimalRoomAllocation({
    accommodation: makeAccommodation({
      roomTypes: [
        {
          id: "standard",
          name: "Standard Room",
          pricePerNight: 4000,
          maxAdults: 2,
          maxChildren: 1,
          maxOccupancy: 3,
        },
        {
          id: "family",
          name: "Family Suite",
          pricePerNight: 6800,
          maxAdults: 2,
          maxChildren: 3,
          maxOccupancy: 5,
        },
      ],
    }),
    travellers: { adults: 1, children: 2 },
    nights: 2,
  });

  assert.ok(allocation);
  assert.equal(allocation?.totalRooms, 1);
  assert.equal(allocation?.rooms[0]?.roomTypeId, "family");
  assert.equal(allocation?.rooms[0]?.totalCost, 13600);
});

test("selectOptimalRoomAllocation ignores child-only options when adults are present", () => {
  // Adults + children should always end up in the same room when a single
  // family room can hold the whole party — even when a strictly cheaper
  // child-only room exists, because that arrangement leaves the children
  // unsupervised.
  const allocation = selectOptimalRoomAllocation({
    accommodation: makeAccommodation({
      roomTypes: [
        {
          id: "family",
          name: "Family Room",
          pricePerNight: 5200,
          maxAdults: 2,
          maxChildren: 2,
          maxOccupancy: 4,
        },
        {
          id: "kid_pod",
          name: "Kid Pod",
          pricePerNight: 800,
          maxAdults: 0,
          maxChildren: 2,
          maxOccupancy: 2,
        },
        {
          id: "couples",
          name: "Couples Room",
          pricePerNight: 3200,
          maxAdults: 2,
          maxChildren: 0,
          maxOccupancy: 2,
        },
      ],
    }),
    travellers: { adults: 2, children: 2 },
    nights: 1,
  });

  assert.ok(allocation);
  assert.equal(allocation?.totalRooms, 1);
  assert.equal(allocation?.rooms[0]?.roomTypeId, "family");
});
