import assert from "node:assert/strict";
import test from "node:test";

import {
  getTravelTime,
  haversineKm,
  supportsLiveTravelMode,
} from "@/lib/services/distanceService";

// ------------------------- haversineKm --------------------------------------

test("haversineKm returns 0 for identical points", () => {
  assert.equal(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
});

test("haversineKm matches the known Jaipur ↔ Udaipur distance within 1%", () => {
  // Jaipur 26.9124, 75.7873 → Udaipur 24.5854, 73.6916. Real-world
  // great-circle distance ≈ 333 km (the road distance is ~393 km).
  const km = haversineKm(
    { lat: 26.9124, lng: 75.7873 },
    { lat: 24.5854, lng: 73.6916 },
  );
  assert.ok(km > 330 && km < 340, `haversineKm gave ${km}`);
});

test("haversineKm is symmetric", () => {
  const a = { lat: 12.97, lng: 77.59 };
  const b = { lat: 13.08, lng: 80.27 };
  const ab = haversineKm(a, b);
  const ba = haversineKm(b, a);
  assert.equal(ab, ba);
});

test("haversineKm handles antipodal points without numerical blow-up", () => {
  // (0,0) ↔ (0,180) → half the earth's circumference (~20015 km).
  const km = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
  assert.ok(km > 20000 && km < 20040, `got ${km}`);
});

// ------------------------- supportsLiveTravelMode ---------------------------

test("supportsLiveTravelMode returns true for road and train", () => {
  assert.equal(supportsLiveTravelMode("road"), true);
  assert.equal(supportsLiveTravelMode("train"), true);
});

test("supportsLiveTravelMode returns false for flight (no live provider)", () => {
  assert.equal(supportsLiveTravelMode("flight"), false);
});

// ------------------------- getTravelTime ------------------------------------

test("getTravelTime returns null for modes without a live provider", async () => {
  const result = await getTravelTime({
    origin: { lat: 0, lng: 0 },
    destination: { lat: 1, lng: 1 },
    mode: "flight",
    apiKey: "stub",
  });
  assert.equal(result, null);
});

test("getTravelTime requires an API key", async () => {
  const previous = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  try {
    await assert.rejects(
      () =>
        getTravelTime({
          origin: { lat: 0, lng: 0 },
          destination: { lat: 1, lng: 1 },
          mode: "road",
        }),
      /GOOGLE_MAPS_API_KEY is not set/,
    );
  } finally {
    if (previous !== undefined) process.env.GOOGLE_MAPS_API_KEY = previous;
  }
});

test("getTravelTime parses a Routes API response into km and hours", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        routes: [{ distanceMeters: 392800, duration: "24300s" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const result = await getTravelTime({
    origin: { lat: 26.9, lng: 75.8 },
    destination: { lat: 24.6, lng: 73.7 },
    mode: "road",
    apiKey: "stub",
  });

  assert.ok(result);
  assert.equal(result?.distance_km, 392.8);
  assert.equal(result?.travel_time_hours, 6.75);
});

test("getTravelTime returns null when the Routes API has no routes", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ routes: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  const result = await getTravelTime({
    origin: { lat: 0, lng: 0 },
    destination: { lat: 1, lng: 1 },
    mode: "road",
    apiKey: "stub",
  });

  assert.equal(result, null);
});

test("getTravelTime throws on a non-2xx response", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  globalThis.fetch = (async () =>
    new Response("server explosion", { status: 503 })) as typeof fetch;

  await assert.rejects(
    () =>
      getTravelTime({
        origin: { lat: 0, lng: 0 },
        destination: { lat: 1, lng: 1 },
        mode: "road",
        apiKey: "stub",
      }),
    /Routes computeRoutes failed \(503\)/,
  );
});
