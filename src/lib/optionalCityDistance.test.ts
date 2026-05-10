import assert from "node:assert/strict";
import test from "node:test";

import type { GraphNode } from "@/types/domain";
import {
  DISTANCE_UNAVAILABLE_TEXT,
  formatDistanceKm,
  formatDriveTime,
  getDistanceFitLabel,
  getOptionalCityDistanceInfo,
  sortOptionalCitiesByDriveTime,
} from "@/lib/optionalCityDistance";

function makeCity(args: {
  id: string;
  name: string;
  lat: number;
  lng: number;
}): GraphNode {
  return {
    id: args.id,
    type: "city",
    name: args.name,
    region: "rajasthan",
    country: "india",
    tags: [],
    metadata: {},
    location: {
      lat: args.lat,
      lng: args.lng,
    },
  };
}

test("getOptionalCityDistanceInfo estimates road distance and drive time", () => {
  const jaipur = makeCity({
    id: "node_jaipur",
    name: "Jaipur",
    lat: 26.9124,
    lng: 75.7873,
  });
  const pushkar = makeCity({
    id: "node_pushkar",
    name: "Pushkar",
    lat: 26.4899,
    lng: 74.5511,
  });

  const info = getOptionalCityDistanceInfo(jaipur, pushkar, "rajasthan");
  assert.equal(info.cityId, pushkar.id);
  assert.equal(info.cityName, "Pushkar");
  assert.equal(info.source, "approx_haversine");
  assert.equal(info.isApproximate, true);
  assert.equal(typeof info.distanceKm, "number");
  assert.equal(typeof info.driveTimeMinutes, "number");
  assert.ok((info.distanceKm ?? 0) > 0);
  assert.ok((info.driveTimeMinutes ?? 0) > 0);
  assert.ok(info.fitLabel !== null);
});

test("getOptionalCityDistanceInfo returns unavailable when coordinates are invalid", () => {
  const jaipur = makeCity({
    id: "node_jaipur",
    name: "Jaipur",
    lat: 26.9124,
    lng: 75.7873,
  });
  const badCity = makeCity({
    id: "node_bad",
    name: "Nowhere",
    lat: Number.NaN,
    lng: 73.0,
  });

  const info = getOptionalCityDistanceInfo(jaipur, badCity, "rajasthan");
  assert.equal(info.distanceKm, null);
  assert.equal(info.driveTimeMinutes, null);
  assert.equal(info.fitLabel, null);
  assert.equal(info.source, "unavailable");
});

test("sortOptionalCitiesByDriveTime orders shortest first and unavailable last", () => {
  const jaipur = makeCity({
    id: "node_jaipur",
    name: "Jaipur",
    lat: 26.9124,
    lng: 75.7873,
  });
  const pushkar = makeCity({
    id: "node_pushkar",
    name: "Pushkar",
    lat: 26.4899,
    lng: 74.5511,
  });
  const udaipur = makeCity({
    id: "node_udaipur",
    name: "Udaipur",
    lat: 24.5854,
    lng: 73.7125,
  });
  const badCity = makeCity({
    id: "node_bad",
    name: "Nowhere",
    lat: Number.NaN,
    lng: 73.0,
  });

  const sorted = sortOptionalCitiesByDriveTime([
    getOptionalCityDistanceInfo(jaipur, udaipur),
    getOptionalCityDistanceInfo(jaipur, badCity),
    getOptionalCityDistanceInfo(jaipur, pushkar),
  ]);

  assert.deepEqual(
    sorted.map((item) => item.cityId),
    ["node_pushkar", "node_udaipur", "node_bad"],
  );
});

test("formatters add approximation prefix and handle unavailable values", () => {
  assert.equal(formatDistanceKm(143.2, true), "~143 km");
  assert.equal(formatDistanceKm(143.2, false), "143 km");
  assert.equal(formatDistanceKm(null, true), DISTANCE_UNAVAILABLE_TEXT);

  assert.equal(formatDriveTime(145, true), "~2h 25m");
  assert.equal(formatDriveTime(145, false), "2h 25m");
  assert.equal(formatDriveTime(null, false), DISTANCE_UNAVAILABLE_TEXT);
});

test("getDistanceFitLabel returns the expected ranges", () => {
  assert.equal(getDistanceFitLabel(45), "Nearby");
  assert.equal(getDistanceFitLabel(120), "Easy add-on");
  assert.equal(getDistanceFitLabel(220), "Comfortable");
  assert.equal(getDistanceFitLabel(360), "Long detour");
  assert.equal(getDistanceFitLabel(420), "Better for longer trips");
  assert.equal(getDistanceFitLabel(null), null);
});
