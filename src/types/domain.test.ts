import assert from "node:assert/strict";
import test from "node:test";

import {
  DATA_CONFIDENCE_LEVELS,
  DATA_QUALITY_ENTITY_TYPES,
  DATA_QUALITY_ISSUE_CODES,
  DATA_QUALITY_ISSUE_SEVERITIES,
  DATA_QUALITY_ISSUE_STATUSES,
  DATA_SOURCE_TYPES,
  OPENING_HOURS_CONFIDENCE_LEVELS,
  OPENING_HOURS_WEEKDAYS,
  assertNoMockInProductionData,
  formatDataConfidenceLabel,
  isRealData,
  isStaleData,
} from "@/types/domain";

test("v2 provenance literals are exported in stable order", () => {
  assert.deepEqual([...DATA_SOURCE_TYPES], [
    "manual",
    "google_places",
    "liteapi",
    "official_website",
    "estimated",
    "mock",
    "system",
  ]);

  assert.deepEqual([...DATA_CONFIDENCE_LEVELS], [
    "live",
    "verified",
    "cached",
    "estimated",
    "unknown",
  ]);

  assert.deepEqual([...OPENING_HOURS_CONFIDENCE_LEVELS], [
    "live",
    "verified",
    "cached",
    "estimated",
    "unknown",
  ]);
  assert.deepEqual([...OPENING_HOURS_WEEKDAYS], [
    "sun",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
  ]);
});

test("data quality literals are exported in stable order", () => {
  assert.deepEqual([...DATA_QUALITY_ENTITY_TYPES], [
    "region",
    "city",
    "attraction",
    "hotel",
    "route_edge",
    "itinerary",
    "provider_call",
  ]);

  assert.deepEqual([...DATA_QUALITY_ISSUE_SEVERITIES], [
    "info",
    "warning",
    "critical",
  ]);

  assert.deepEqual([...DATA_QUALITY_ISSUE_STATUSES], [
    "open",
    "ignored",
    "resolved",
  ]);

  assert.deepEqual([...DATA_QUALITY_ISSUE_CODES], [
    "missing_google_place_id",
    "missing_opening_hours",
    "missing_admission_cost",
    "stale_place_data",
    "mock_data_present",
    "duplicate_place",
    "liteapi_error",
    "no_hotel_rates",
    "route_edge_missing",
    "itinerary_warning",
  ]);
});

test("isRealData only passes non-mock sources with real confidence", () => {
  assert.equal(
    isRealData({ source_type: "manual", confidence: "verified" }),
    true,
  );
  assert.equal(
    isRealData({ source_type: "official_website", confidence: "cached" }),
    true,
  );
  assert.equal(isRealData({ source_type: "system", confidence: "live" }), true);

  assert.equal(
    isRealData({ source_type: "google_places", confidence: "estimated" }),
    false,
  );
  assert.equal(isRealData({ source_type: "manual", confidence: "unknown" }), false);
  assert.equal(isRealData({ source_type: "mock", confidence: "verified" }), false);
  assert.equal(isRealData({ source_type: "estimated", confidence: "live" }), false);
});

test("isStaleData evaluates age using verified_at before fetched_at", () => {
  const now = 2_000_000;
  const staleAfter = 60_000;

  assert.equal(
    isStaleData(
      { confidence: "cached", fetched_at: now - 5_000 },
      now,
      staleAfter,
    ),
    false,
  );
  assert.equal(
    isStaleData(
      { confidence: "cached", fetched_at: now - 120_000 },
      now,
      staleAfter,
    ),
    true,
  );
  assert.equal(
    isStaleData(
      {
        confidence: "verified",
        fetched_at: now - 120_000,
        verified_at: now - 10_000,
      },
      now,
      staleAfter,
    ),
    false,
  );
});

test("isStaleData special-cases missing timestamps and live confidence", () => {
  const now = 2_000_000;
  const staleAfter = 60_000;

  assert.equal(isStaleData({ confidence: "live" }, now, staleAfter), false);
  assert.equal(isStaleData({ confidence: "cached" }, now, staleAfter), true);
  assert.equal(isStaleData({ confidence: "unknown" }, now, staleAfter), false);
});

test("assertNoMockInProductionData blocks mock markers only in production", () => {
  assert.doesNotThrow(() =>
    assertNoMockInProductionData(
      { source_type: "mock", confidence: "estimated" },
      { nodeEnv: "development" },
    ),
  );

  assert.throws(
    () =>
      assertNoMockInProductionData(
        { nested: [{ meta: { source_type: "mock" } }] },
        { nodeEnv: "production" },
      ),
    /Mock data is not allowed in production at \$\.nested\[0\]\.meta/,
  );

  assert.throws(
    () =>
      assertNoMockInProductionData({ legacy: { source: "mock" } }, { nodeEnv: "production" }),
    /Mock data is not allowed in production at \$\.legacy/,
  );

  const realPayload = {
    source_type: "manual",
    confidence: "verified",
    nested: { source_type: "google_places", confidence: "cached" },
  };
  assert.doesNotThrow(() =>
    assertNoMockInProductionData(realPayload, { nodeEnv: "production" }),
  );
});

test("formatDataConfidenceLabel returns UI labels", () => {
  assert.equal(formatDataConfidenceLabel("live"), "Live");
  assert.equal(formatDataConfidenceLabel("verified"), "Verified");
  assert.equal(formatDataConfidenceLabel("cached"), "Cached");
  assert.equal(formatDataConfidenceLabel("estimated"), "Estimated");
  assert.equal(formatDataConfidenceLabel("unknown"), "Unknown");
});
