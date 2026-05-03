import assert from "node:assert/strict";
import test from "node:test";

import { fetchPlaceOpeningHoursById } from "@/lib/services/placesService";

test("fetchPlaceOpeningHoursById uses a narrow opening-hours field mask", async (t) => {
  const realFetch = globalThis.fetch;
  const fieldMasks: string[] = [];
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers(init?.headers);
    fieldMasks.push(headers.get("X-Goog-FieldMask") ?? "");
    return new Response(
      JSON.stringify({
        id: "place_hours",
        businessStatus: "OPERATIONAL",
        regularOpeningHours: {
          periods: [
            {
              open: { day: 1, hour: 9, minute: 0 },
              close: { day: 1, hour: 17, minute: 0 },
            },
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await fetchPlaceOpeningHoursById({
    googlePlaceId: "place_hours",
    apiKey: "stub-key",
  });

  assert.equal(result.google_place_id, "place_hours");
  assert.deepEqual(fieldMasks, [
    "id,businessStatus,regularOpeningHours.periods",
  ]);
  assert.ok(!fieldMasks[0].includes("photos"));
  assert.ok(!fieldMasks[0].includes("reviews"));
  assert.ok(!fieldMasks[0].includes("weekdayDescriptions"));
  assert.ok(!fieldMasks[0].includes("utcOffsetMinutes"));
});

test("fetchPlaceOpeningHoursById refuses browser execution", async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  t.after(() => {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  await assert.rejects(
    () =>
      fetchPlaceOpeningHoursById({
        googlePlaceId: "place_hours",
        apiKey: "stub-key",
      }),
    /server-only/,
  );
});
