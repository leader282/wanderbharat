import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultEngineTuning,
  mergeEngineTuning,
} from "@/lib/config/engineTuning";

test("defaultEngineTuning exposes sensible starting values", () => {
  assert.ok(defaultEngineTuning.poolSize.min > 0);
  assert.ok(
    defaultEngineTuning.poolSize.max >= defaultEngineTuning.poolSize.min,
  );
  assert.ok(defaultEngineTuning.maxMatrixPairs > 0);
  assert.ok(defaultEngineTuning.networkConcurrency > 0);
});

test("idealRadiusKm averages across the supplied modes", () => {
  const roadOnly = defaultEngineTuning.idealRadiusKm(["road"]);
  const flightOnly = defaultEngineTuning.idealRadiusKm(["flight"]);
  const mixed = defaultEngineTuning.idealRadiusKm(["road", "flight"]);

  assert.ok(roadOnly < mixed);
  assert.ok(mixed < flightOnly);
});

test("idealRadiusKm returns a sane fallback for an empty mode list", () => {
  const empty = defaultEngineTuning.idealRadiusKm([]);
  assert.ok(empty > 0);
});

test("mergeEngineTuning returns the base when no override is supplied", () => {
  assert.strictEqual(
    mergeEngineTuning(defaultEngineTuning),
    defaultEngineTuning,
  );
});

test("mergeEngineTuning shallow-merges scalar overrides", () => {
  const merged = mergeEngineTuning(defaultEngineTuning, {
    networkConcurrency: 32,
    maxMatrixPairs: 500,
  });
  assert.equal(merged.networkConcurrency, 32);
  assert.equal(merged.maxMatrixPairs, 500);
  assert.equal(
    merged.defaultStopHours,
    defaultEngineTuning.defaultStopHours,
  );
});

test("mergeEngineTuning deep-merges poolSize and legCost partials", () => {
  const merged = mergeEngineTuning(defaultEngineTuning, {
    poolSize: { max: 24 },
    legCost: { hours: 2 },
  });

  assert.equal(merged.poolSize.max, 24);
  assert.equal(merged.poolSize.min, defaultEngineTuning.poolSize.min);
  assert.equal(merged.legCost.hours, 2);
  assert.equal(merged.legCost.cost, defaultEngineTuning.legCost.cost);
});

test("mergeEngineTuning preserves the idealRadiusKm function reference", () => {
  const merged = mergeEngineTuning(defaultEngineTuning, {
    networkConcurrency: 16,
  });
  assert.strictEqual(merged.idealRadiusKm, defaultEngineTuning.idealRadiusKm);
});
