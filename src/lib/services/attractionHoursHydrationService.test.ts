import assert from "node:assert/strict";
import test from "node:test";

import type { GraphNode } from "@/types/domain";
import type { CreateDataQualityIssueInput } from "@/lib/repositories/dataQualityRepository";
import type { CreateProviderCallLogInput } from "@/lib/repositories/providerCallLogRepository";
import { hydrateAttractionOpeningHours } from "@/lib/services/attractionHoursHydrationService";
import type { PlaceOpeningHoursDetails } from "@/lib/services/placesService";

function makeAttraction(args: {
  id: string;
  region?: string;
  google_place_id?: string;
}): GraphNode {
  return {
    id: args.id,
    type: "attraction",
    name: `Attraction ${args.id}`,
    region: args.region ?? "rajasthan",
    country: "india",
    tags: [],
    metadata: {
      google_place_id: args.google_place_id,
    },
    location: { lat: 26.9, lng: 75.8 },
    parent_node_id: "city_jaipur",
  };
}

function makeGoogleDetails(
  value: Partial<PlaceOpeningHoursDetails>,
): PlaceOpeningHoursDetails {
  return {
    google_place_id: "place_default",
    regular_opening_hours_periods: [],
    ...value,
  };
}

test("hydrateAttractionOpeningHours persists cached weekly periods from Google", async () => {
  const attraction = makeAttraction({
    id: "attr_amber",
    google_place_id: "place_amber",
  });
  const upserts: unknown[] = [];
  const issues: CreateDataQualityIssueInput[] = [];
  const providerLogs: CreateProviderCallLogInput[] = [];

  const result = await hydrateAttractionOpeningHours(
    {
      google_place_id: "place_amber",
    },
    {
      nowMs: () => 1_700_000_000_000,
      fetchPlaceOpeningHours: async () =>
        makeGoogleDetails({
          google_place_id: "place_amber",
          business_status: "OPERATIONAL",
          regular_opening_hours_periods: [
            {
              open: { day: 1, hour: 9, minute: 0 },
              close: { day: 1, hour: 17, minute: 0 },
            },
            {
              open: { day: 2, hour: 10, minute: 0 },
              close: { day: 2, hour: 16, minute: 30 },
            },
          ],
        }),
      findAttractionsByPlaceId: async () => [attraction],
      getAttractionById: async () => null,
      upsertOpeningHours: async (records) => {
        upserts.push(records);
      },
      createDataQualityIssue: async (issue) => {
        issues.push(issue);
      },
      createProviderCall: async (entry) => {
        providerLogs.push(entry);
      },
    },
  );

  assert.equal(result.attraction_id, "attr_amber");
  assert.equal(result.confidence, "cached");
  assert.equal(result.weekly_periods_count, 2);
  assert.equal(result.closed_days_count, 5);
  assert.equal(upserts.length, 1);

  const [savedRecord] = upserts[0] as Array<{
    attraction_id: string;
    timezone: string;
    weekly_periods: Array<{ day: string; opens: string; closes: string }>;
    closed_days?: string[];
    source_type: string;
    confidence: string;
    fetched_at: number;
  }>;
  assert.equal(savedRecord.attraction_id, "attr_amber");
  assert.equal(savedRecord.timezone, "Asia/Kolkata");
  assert.deepEqual(savedRecord.weekly_periods, [
    { day: "mon", opens: "09:00", closes: "17:00" },
    { day: "tue", opens: "10:00", closes: "16:30" },
  ]);
  assert.deepEqual(savedRecord.closed_days, ["sun", "wed", "thu", "fri", "sat"]);
  assert.equal(savedRecord.source_type, "google_places");
  assert.equal(savedRecord.confidence, "cached");
  assert.equal(savedRecord.fetched_at, 1_700_000_000_000);

  assert.equal(issues.length, 0);
  assert.equal(providerLogs.length, 1);
  assert.equal(providerLogs[0].provider, "google_places");
  assert.equal(providerLogs[0].status, "success");
  assert.equal(providerLogs[0].result_count, 2);
});

test("hydrateAttractionOpeningHours preserves explicit attraction timezone metadata", async () => {
  const attraction = makeAttraction({
    id: "attr_timezone",
    google_place_id: "place_timezone",
  });
  attraction.metadata.timezone = "Asia/Dubai";
  const upserts: unknown[] = [];

  await hydrateAttractionOpeningHours(
    {
      google_place_id: "place_timezone",
    },
    {
      nowMs: () => 1_700_000_050_000,
      fetchPlaceOpeningHours: async () =>
        makeGoogleDetails({
          google_place_id: "place_timezone",
          business_status: "OPERATIONAL",
          regular_opening_hours_periods: [
            {
              open: { day: 0, hour: 8, minute: 0 },
              close: { day: 0, hour: 12, minute: 0 },
            },
          ],
        }),
      findAttractionsByPlaceId: async () => [attraction],
      getAttractionById: async () => null,
      upsertOpeningHours: async (records) => {
        upserts.push(records);
      },
      createDataQualityIssue: async () => undefined,
      createProviderCall: async () => undefined,
    },
  );

  const [savedRecord] = upserts[0] as Array<{ timezone: string }>;
  assert.equal(savedRecord.timezone, "Asia/Dubai");
});

test("hydrateAttractionOpeningHours normalises Google always-open periods", async () => {
  const attraction = makeAttraction({
    id: "attr_always_open",
    google_place_id: "place_always_open",
  });
  const upserts: unknown[] = [];
  const issues: CreateDataQualityIssueInput[] = [];

  await hydrateAttractionOpeningHours(
    {
      google_place_id: "place_always_open",
    },
    {
      nowMs: () => 1_700_000_060_000,
      fetchPlaceOpeningHours: async () =>
        makeGoogleDetails({
          google_place_id: "place_always_open",
          business_status: "OPERATIONAL",
          regular_opening_hours_periods: [
            {
              open: { day: 0, hour: 0, minute: 0 },
            },
          ],
        }),
      findAttractionsByPlaceId: async () => [attraction],
      getAttractionById: async () => null,
      upsertOpeningHours: async (records) => {
        upserts.push(records);
      },
      createDataQualityIssue: async (issue) => {
        issues.push(issue);
      },
      createProviderCall: async () => undefined,
    },
  );

  const [savedRecord] = upserts[0] as Array<{
    weekly_periods: Array<{ day: string; opens: string; closes: string }>;
    closed_days?: string[];
  }>;
  assert.equal(savedRecord.weekly_periods.length, 7);
  assert.deepEqual(
    savedRecord.weekly_periods.map((period) => period.day),
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
  );
  assert.ok(
    savedRecord.weekly_periods.every(
      (period) => period.opens === "00:00" && period.closes === "23:59",
    ),
  );
  assert.equal(savedRecord.closed_days, undefined);
  assert.equal(issues.length, 0);
});

test("hydrateAttractionOpeningHours marks all days closed when business is closed", async () => {
  const attraction = makeAttraction({
    id: "attr_closed",
    google_place_id: "place_closed",
  });
  const upserts: unknown[] = [];
  const issues: CreateDataQualityIssueInput[] = [];
  const providerLogs: CreateProviderCallLogInput[] = [];

  await hydrateAttractionOpeningHours(
    {
      google_place_id: "place_closed",
    },
    {
      nowMs: () => 1_700_000_100_000,
      fetchPlaceOpeningHours: async () =>
        makeGoogleDetails({
          google_place_id: "place_closed",
          business_status: "CLOSED_PERMANENTLY",
          regular_opening_hours_periods: [],
        }),
      findAttractionsByPlaceId: async () => [attraction],
      getAttractionById: async () => null,
      upsertOpeningHours: async (records) => {
        upserts.push(records);
      },
      createDataQualityIssue: async (issue) => {
        issues.push(issue);
      },
      createProviderCall: async (entry) => {
        providerLogs.push(entry);
      },
    },
  );

  const [savedRecord] = upserts[0] as Array<{
    weekly_periods: unknown[];
    closed_days?: string[];
    confidence: string;
  }>;
  assert.equal(savedRecord.weekly_periods.length, 0);
  assert.deepEqual(savedRecord.closed_days, [
    "sun",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
  ]);
  assert.equal(savedRecord.confidence, "cached");
  assert.equal(issues.length, 0);
  assert.equal(providerLogs[0].status, "success");
});

test("hydrateAttractionOpeningHours opens a data-quality issue for missing hours payload", async () => {
  const attraction = makeAttraction({
    id: "attr_unknown_hours",
    google_place_id: "place_unknown_hours",
  });
  const upserts: unknown[] = [];
  const issues: CreateDataQualityIssueInput[] = [];
  const providerLogs: CreateProviderCallLogInput[] = [];

  await hydrateAttractionOpeningHours(
    {
      google_place_id: "place_unknown_hours",
    },
    {
      nowMs: () => 1_700_000_200_000,
      fetchPlaceOpeningHours: async () =>
        makeGoogleDetails({
          google_place_id: "place_unknown_hours",
          business_status: "OPERATIONAL",
          regular_opening_hours_periods: [],
        }),
      findAttractionsByPlaceId: async () => [attraction],
      getAttractionById: async () => null,
      upsertOpeningHours: async (records) => {
        upserts.push(records);
      },
      createDataQualityIssue: async (issue) => {
        issues.push(issue);
      },
      createProviderCall: async (entry) => {
        providerLogs.push(entry);
      },
    },
  );

  const [savedRecord] = upserts[0] as Array<{
    confidence: string;
    weekly_periods: unknown[];
    closed_days?: unknown[];
  }>;
  assert.equal(savedRecord.confidence, "unknown");
  assert.equal(savedRecord.weekly_periods.length, 0);
  assert.equal(savedRecord.closed_days, undefined);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "missing_opening_hours");
  assert.equal(issues[0].severity, "warning");
  assert.equal(providerLogs[0].status, "empty");
});

test("hydrateAttractionOpeningHours creates missing-google-place issue when no place id is available", async () => {
  const issues: CreateDataQualityIssueInput[] = [];
  const attraction = makeAttraction({
    id: "attr_missing_place",
  });

  await assert.rejects(
    () =>
      hydrateAttractionOpeningHours(
        {
          attraction_id: "attr_missing_place",
        },
        {
          nowMs: () => 1_700_000_300_000,
          fetchPlaceOpeningHours: async () => {
            throw new Error("should not be called");
          },
          findAttractionsByPlaceId: async () => {
            throw new Error("should not be called");
          },
          getAttractionById: async () => attraction,
          upsertOpeningHours: async () => {
            throw new Error("should not be called");
          },
          createDataQualityIssue: async (issue) => {
            issues.push(issue);
          },
          createProviderCall: async () => {
            throw new Error("should not be called");
          },
        },
      ),
    /google_place_id is required/,
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "missing_google_place_id");
  assert.equal(issues[0].severity, "warning");
  assert.equal(issues[0].entity_id, "attr_missing_place");
});

test("hydrateAttractionOpeningHours records API errors as critical data-quality issues", async () => {
  const attraction = makeAttraction({
    id: "attr_api_error",
    google_place_id: "place_api_error",
  });
  const issues: CreateDataQualityIssueInput[] = [];
  const providerLogs: CreateProviderCallLogInput[] = [];
  const upserts: unknown[] = [];

  await assert.rejects(
    () =>
      hydrateAttractionOpeningHours(
        {
          google_place_id: "place_api_error",
        },
        {
          nowMs: () => 1_700_000_400_000,
          fetchPlaceOpeningHours: async () => {
            throw new Error("provider timeout");
          },
          findAttractionsByPlaceId: async () => [attraction],
          getAttractionById: async () => null,
          upsertOpeningHours: async (records) => {
            upserts.push(records);
          },
          createDataQualityIssue: async (issue) => {
            issues.push(issue);
          },
          createProviderCall: async (entry) => {
            providerLogs.push(entry);
          },
        },
      ),
    /provider timeout/,
  );

  assert.equal(upserts.length, 0);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "missing_opening_hours");
  assert.equal(issues[0].severity, "critical");
  assert.equal(providerLogs.length, 1);
  assert.equal(providerLogs[0].status, "error");
  assert.equal(providerLogs[0].error_code, "google_places_error");
});
