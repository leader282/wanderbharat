import assert from "node:assert/strict";
import test from "node:test";

import {
  normalisePlanFormNumberInput,
  parsePlanFormNumberInput,
} from "@/lib/planFormNumberFields";

test("parsePlanFormNumberInput keeps cleared fields empty while editing", () => {
  assert.equal(parsePlanFormNumberInput("", { min: 0, max: 20 }), "");
});

test("parsePlanFormNumberInput clamps values within the allowed range", () => {
  assert.equal(parsePlanFormNumberInput("0", { min: 0, max: 20 }), 0);
  assert.equal(parsePlanFormNumberInput("25", { min: 0, max: 20 }), 20);
});

test("normalisePlanFormNumberInput restores the adult minimum on blur", () => {
  assert.equal(
    normalisePlanFormNumberInput("", {
      min: 1,
      max: 20,
      fallback: 1,
    }),
    1,
  );
  assert.equal(
    normalisePlanFormNumberInput(0, {
      min: 1,
      max: 20,
      fallback: 1,
    }),
    1,
  );
});
