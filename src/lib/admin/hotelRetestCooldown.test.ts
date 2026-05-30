import assert from "node:assert/strict";
import test from "node:test";

import { findRecentLiteApiRatesLog } from "@/lib/admin/hotelRetestCooldown";
import type {
  HotelOfferSnapshot,
  ProviderCallLog,
} from "@/lib/providers/hotels/types";

const snapshot: Pick<
  HotelOfferSnapshot,
  "provider" | "region" | "node_id"
> = {
  provider: "liteapi",
  region: "rajasthan",
  node_id: "node_jaipur",
};

function log(overrides: Partial<ProviderCallLog> = {}): ProviderCallLog {
  return {
    id: "log_1",
    provider: "liteapi",
    endpoint: "hotels/rates",
    request_summary: {},
    status: "success",
    duration_ms: 120,
    result_count: 4,
    created_at: 1_700_000_000_000,
    region: "rajasthan",
    node_id: "node_jaipur",
    ...overrides,
  };
}

test("findRecentLiteApiRatesLog matches stored rate endpoints with or without a leading slash", () => {
  assert.equal(
    findRecentLiteApiRatesLog({
      logs: [log({ endpoint: "/hotels/rates" })],
      snapshot,
      nowMs: 1_700_000_010_000,
    })?.id,
    "log_1",
  );

  assert.equal(
    findRecentLiteApiRatesLog({
      logs: [log({ id: "log_2", endpoint: "hotels/rates" })],
      snapshot,
      nowMs: 1_700_000_010_000,
    })?.id,
    "log_2",
  );
});

test("findRecentLiteApiRatesLog ignores stale or different-node provider calls", () => {
  assert.equal(
    findRecentLiteApiRatesLog({
      logs: [
        log({ id: "stale", created_at: 1_699_999_000_000 }),
        log({ id: "different_node", node_id: "node_udaipur" }),
      ],
      snapshot,
      nowMs: 1_700_000_010_000,
    }),
    undefined,
  );
});
