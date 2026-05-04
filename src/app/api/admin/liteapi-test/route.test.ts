import assert from "node:assert/strict";
import test from "node:test";

import { handleLiteApiTestRequest } from "@/app/api/admin/liteapi-test/route";
import type { LiteApiProbeResult } from "@/lib/admin/liteApiProbe";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/liteapi-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeProbeResult(
  overrides: Partial<LiteApiProbeResult> = {},
): LiteApiProbeResult {
  const base: LiteApiProbeResult = {
    ok: true,
    provider_status: {
      enabled_flag: true,
      api_key_present: true,
      available: true,
      timeout_ms: 12_000,
      max_results_default: 20,
    },
    request_summary: {
      region: "admin_test",
      node_id: "admin_city_jaipur",
      city_name: "Jaipur",
      country_code: "IN",
      anchor: null,
      radius_meters: 5_000,
      checkin_date: "2099-06-10",
      checkout_date: "2099-06-12",
      adults: 2,
      children_ages: [],
      rooms_requested: 1,
      rooms_used_for_rates: 1,
      currency: "INR",
      guest_nationality: "IN",
      max_results: 20,
    },
    response_time_ms: 120,
    hotels_count: 3,
    rates_count: 4,
    cheapest_total_amount: 8_500,
    median_total_amount: 9_200,
    currency: "INR",
    provider_call_log_id: "log_latest",
    provider_call_log_ids: ["log_search", "log_rates"],
    provider_calls: [],
    hotel_search_snapshot_id: "search_1",
    hotel_offer_snapshot_id: "offer_1",
    top_hotels: [],
    normalized_json: {
      hotels: [],
      rates_snapshot: null,
    },
  };
  return {
    ...base,
    ...overrides,
    provider_status: {
      ...base.provider_status,
      ...(overrides.provider_status ?? {}),
    },
    request_summary: {
      ...base.request_summary,
      ...(overrides.request_summary ?? {}),
    },
    normalized_json: {
      ...base.normalized_json,
      ...(overrides.normalized_json ?? {}),
    },
  };
}

// Use far-future dates so these tests never rot when the system clock advances
// past today + a few weeks (the route now rejects past check-ins).
const validBody = {
  city_name: "Jaipur",
  checkin_date: "2099-06-10",
  checkout_date: "2099-06-12",
};

const adminAuthResult = {
  ok: true as const,
  user: {
    uid: "uid_admin",
    email: "admin@example.com",
    name: "Admin",
    picture: null,
    role: "admin" as const,
  },
};

test("handleLiteApiTestRequest returns 401 for unauthenticated requests", async () => {
  let probeCalls = 0;
  const response = await handleLiteApiTestRequest(makeRequest(validBody), {
    requireAdminUser: async () => ({ ok: false, reason: "unauthenticated" }),
    runLiteApiProbe: async () => {
      probeCalls += 1;
      return makeProbeResult();
    },
  });

  assert.equal(response.status, 401);
  assert.equal(probeCalls, 0);
});

test("handleLiteApiTestRequest returns 403 for non-admin users", async () => {
  let probeCalls = 0;
  const response = await handleLiteApiTestRequest(makeRequest(validBody), {
    requireAdminUser: async () => ({
      ok: false,
      reason: "forbidden",
      user: {
        uid: "uid_editor",
        email: "editor@example.com",
        name: "Editor",
        picture: null,
      },
    }),
    runLiteApiProbe: async () => {
      probeCalls += 1;
      return makeProbeResult();
    },
  });

  assert.equal(response.status, 403);
  assert.equal(probeCalls, 0);
});

test("handleLiteApiTestRequest validates input before running the probe", async () => {
  let probeCalls = 0;
  const response = await handleLiteApiTestRequest(
    makeRequest({
      checkin_date: "2099-06-10",
      checkout_date: "2099-06-12",
    }),
    {
      requireAdminUser: async () => adminAuthResult,
      runLiteApiProbe: async () => {
        probeCalls += 1;
        return makeProbeResult();
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(probeCalls, 0);

  const payload = (await response.json()) as {
    error: string;
    issues: Array<{ path: string; message: string }>;
  };
  assert.equal(payload.error, "invalid_input");
  assert.ok(payload.issues.some((issue) => issue.path === "city_name"));
});

test("handleLiteApiTestRequest rejects out-of-range latitude/longitude", async () => {
  let probeCalls = 0;
  const response = await handleLiteApiTestRequest(
    makeRequest({
      ...validBody,
      latitude: 999,
      longitude: 999,
    }),
    {
      requireAdminUser: async () => adminAuthResult,
      runLiteApiProbe: async () => {
        probeCalls += 1;
        return makeProbeResult();
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(probeCalls, 0);

  const payload = (await response.json()) as {
    error: string;
    issues: Array<{ path: string; message: string }>;
  };
  assert.equal(payload.error, "invalid_input");
  assert.ok(payload.issues.some((issue) => issue.path === "latitude"));
  assert.ok(payload.issues.some((issue) => issue.path === "longitude"));
});

test("handleLiteApiTestRequest rejects past check-in dates", async () => {
  let probeCalls = 0;
  const response = await handleLiteApiTestRequest(
    makeRequest({
      ...validBody,
      checkin_date: "2020-01-01",
      checkout_date: "2020-01-03",
    }),
    {
      requireAdminUser: async () => adminAuthResult,
      runLiteApiProbe: async () => {
        probeCalls += 1;
        return makeProbeResult();
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(probeCalls, 0);

  const payload = (await response.json()) as {
    error: string;
    issues: Array<{ path: string; message: string }>;
  };
  assert.equal(payload.error, "invalid_input");
  assert.ok(payload.issues.some((issue) => issue.path === "checkin_date"));
});

test("handleLiteApiTestRequest rejects stays longer than 30 nights", async () => {
  let probeCalls = 0;
  const response = await handleLiteApiTestRequest(
    makeRequest({
      ...validBody,
      checkin_date: "2099-06-10",
      checkout_date: "2099-08-01",
    }),
    {
      requireAdminUser: async () => adminAuthResult,
      runLiteApiProbe: async () => {
        probeCalls += 1;
        return makeProbeResult();
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(probeCalls, 0);

  const payload = (await response.json()) as {
    error: string;
    issues: Array<{ path: string; message: string }>;
  };
  assert.equal(payload.error, "invalid_input");
  assert.ok(
    payload.issues.some(
      (issue) =>
        issue.path === "checkout_date" &&
        issue.message.toLowerCase().includes("stay length"),
    ),
  );
});

test("handleLiteApiTestRequest forwards normalized defaults to runLiteApiProbe", async () => {
  let observedCountryCode: string | undefined;
  let observedRadiusMeters: number | undefined;
  let observedAdults: number | undefined;
  let observedRooms: number | undefined;
  let observedCurrency: string | undefined;
  let observedGuestNationality: string | undefined;

  const response = await handleLiteApiTestRequest(makeRequest(validBody), {
    requireAdminUser: async () => adminAuthResult,
    runLiteApiProbe: async (input) => {
      observedCountryCode = input.country_code;
      observedRadiusMeters = input.radius_meters;
      observedAdults = input.adults;
      observedRooms = input.rooms;
      observedCurrency = input.currency;
      observedGuestNationality = input.guest_nationality;
      return makeProbeResult();
    },
  });

  assert.equal(response.status, 200);
  assert.equal(observedCountryCode, "IN");
  assert.equal(observedRadiusMeters, 5_000);
  assert.equal(observedAdults, 2);
  assert.equal(observedRooms, 1);
  assert.equal(observedCurrency, "INR");
  assert.equal(observedGuestNationality, "IN");
});

test("handleLiteApiTestRequest maps timeout probe failures to 504", async () => {
  const response = await handleLiteApiTestRequest(makeRequest(validBody), {
    requireAdminUser: async () => adminAuthResult,
    runLiteApiProbe: async () =>
      makeProbeResult({
        ok: false,
        error: {
          kind: "timeout",
          code: "provider_timeout",
          message: "Provider timed out.",
        },
      }),
  });

  assert.equal(response.status, 504);
  const payload = (await response.json()) as LiteApiProbeResult;
  assert.equal(payload.ok, false);
  assert.equal(payload.error?.kind, "timeout");
});
