import assert from "node:assert/strict";
import test from "node:test";

import { TRANSPORT_MODES } from "@/types/domain";
import {
  allTransportModes,
  averageSpeedKmH,
  defaultPerKmCost,
  fatigueFactor,
  getTransportModeConfig,
  idealRadiusKm,
  maxDailyHoursFor,
  supportsLiveTravelMode,
  transportModeConfig,
} from "@/lib/config/transportMode";

test("transportModeConfig has an entry for every TRANSPORT_MODES value", () => {
  for (const mode of TRANSPORT_MODES) {
    assert.ok(transportModeConfig[mode], `missing config for "${mode}"`);
  }
});

test("getTransportModeConfig returns a populated config for a known mode", () => {
  const cfg = getTransportModeConfig("road");
  assert.equal(cfg.avg_speed_kmh, 55);
  assert.equal(cfg.google_mode, "DRIVE");
  assert.equal(cfg.supports_live_routing, true);
});

test("supportsLiveTravelMode reflects the mode-config flag", () => {
  assert.equal(supportsLiveTravelMode("road"), true);
  assert.equal(supportsLiveTravelMode("flight"), false);
});

test("averageSpeedKmH is positive for every mode", () => {
  for (const mode of TRANSPORT_MODES) {
    assert.ok(averageSpeedKmH(mode) > 0);
  }
});

test("defaultPerKmCost is non-negative for every mode", () => {
  for (const mode of TRANSPORT_MODES) {
    assert.ok(defaultPerKmCost(mode) >= 0);
  }
});

test("fatigueFactor is between 0 and 1 inclusive for every mode", () => {
  for (const mode of TRANSPORT_MODES) {
    const f = fatigueFactor(mode);
    assert.ok(f >= 0 && f <= 1, `${mode} fatigue=${f}`);
  }
});

test("idealRadiusKm grows from road → train → flight", () => {
  assert.ok(idealRadiusKm("road") < idealRadiusKm("train"));
  assert.ok(idealRadiusKm("train") < idealRadiusKm("flight"));
});

test("maxDailyHoursFor scales the base by the per-mode factor", () => {
  // road factor = 1.0
  assert.equal(maxDailyHoursFor("road", 6), 6);
  // train factor = 1.4
  assert.equal(maxDailyHoursFor("train", 6), 6 * 1.4);
  // flight factor = 0.8
  assert.equal(maxDailyHoursFor("flight", 6), 6 * 0.8);
});

test("allTransportModes returns the canonical list", () => {
  assert.deepEqual([...allTransportModes()], [...TRANSPORT_MODES]);
});
