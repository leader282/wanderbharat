import assert from "node:assert/strict";
import test from "node:test";

import { TRAVEL_STYLES, type TravelStyle } from "@/types/domain";
import {
  getTravelStyleConfig,
  travelStyleConfig,
} from "@/lib/config/travelStyle";

test("travelStyleConfig has an entry for every TRAVEL_STYLES value", () => {
  for (const style of TRAVEL_STYLES) {
    assert.ok(travelStyleConfig[style], `missing config for "${style}"`);
  }
});

test("getTravelStyleConfig returns the matching config", () => {
  for (const style of TRAVEL_STYLES) {
    assert.strictEqual(getTravelStyleConfig(style), travelStyleConfig[style]);
  }
});

test("getTravelStyleConfig throws for an unknown style", () => {
  assert.throws(
    () => getTravelStyleConfig("extreme" as TravelStyle),
    /Unknown travel style/,
  );
});

test("travel-style configs respect the relaxed → balanced → adventurous gradient", () => {
  const relaxed = travelStyleConfig.relaxed;
  const balanced = travelStyleConfig.balanced;
  const adventurous = travelStyleConfig.adventurous;

  assert.ok(relaxed.maxTravelHoursPerDay < balanced.maxTravelHoursPerDay);
  assert.ok(balanced.maxTravelHoursPerDay < adventurous.maxTravelHoursPerDay);

  assert.ok(relaxed.destinationDensity < balanced.destinationDensity);
  assert.ok(balanced.destinationDensity < adventurous.destinationDensity);

  assert.ok(relaxed.minHoursPerStop > balanced.minHoursPerStop);
  assert.ok(balanced.minHoursPerStop > adventurous.minHoursPerStop);
});

test("activityFillRatio is in (0, 1] for every style", () => {
  for (const style of TRAVEL_STYLES) {
    const cfg = travelStyleConfig[style];
    assert.ok(
      cfg.activityFillRatio > 0 && cfg.activityFillRatio <= 1,
      `${style} ratio=${cfg.activityFillRatio}`,
    );
  }
});
