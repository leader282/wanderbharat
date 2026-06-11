import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRegionAllowlist,
  getDisallowedPublicRegions,
  getPublicAllowedRegionSlugs,
} from "@/lib/repositories/regionRepository";
import type { RegionSummary } from "@/types/domain";

const regions: RegionSummary[] = [
  { region: "rajasthan", country: "india", count: 5 },
  { region: "kerala", country: "india", count: 4 },
];

test("public region allowlist helpers normalise configured slugs", () => {
  const env = { WB_ALLOWED_REGIONS: " Rajasthan,kerala ,, " };

  assert.deepEqual(Array.from(getPublicAllowedRegionSlugs(env) ?? []).sort(), [
    "kerala",
    "rajasthan",
  ]);
  assert.deepEqual(applyRegionAllowlist(regions, env), regions);
  assert.deepEqual(getDisallowedPublicRegions(["rajasthan", "delhi"], env), [
    "delhi",
  ]);
});

test("public region allowlist helpers allow every region when unset", () => {
  const env = { WB_ALLOWED_REGIONS: " " };

  assert.equal(getPublicAllowedRegionSlugs(env), null);
  assert.deepEqual(applyRegionAllowlist(regions, env), regions);
  assert.deepEqual(getDisallowedPublicRegions(["hidden"], env), []);
});
