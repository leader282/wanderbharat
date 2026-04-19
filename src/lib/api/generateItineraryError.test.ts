import assert from "node:assert/strict";
import test from "node:test";

import { presentGenerateItineraryError } from "@/lib/api/generateItineraryError";

test("presentGenerateItineraryError joins requested-city messages with suggestions", () => {
  const message = presentGenerateItineraryError(
    {
      error: "constraint_violation",
      reason: "requested_cities_uncovered",
      message: "We couldn't cover Pushkar in 4 days.",
      suggestion: "Try a 5-day trip to include every requested city.",
    },
    422,
  );

  assert.equal(
    message,
    "We couldn't cover Pushkar in 4 days. Try a 5-day trip to include every requested city.",
  );
});

test("presentGenerateItineraryError maps validation issue paths to form-friendly copy", () => {
  const message = presentGenerateItineraryError(
    {
      error: "invalid_input",
      issues: [
        {
          path: "preferences.transport_modes",
          message: "Too small: expected array to have >=1 items",
        },
      ],
    },
    400,
  );

  assert.equal(message, "Choose at least one transport mode.");
});

test("presentGenerateItineraryError keeps budget copy aligned with the total-budget UI", () => {
  const message = presentGenerateItineraryError(
    {
      error: "constraint_violation",
      reason: "budget_exceeded",
      details: {
        estimated_cost: 48600,
        budget: {
          max: 30000,
          currency: "INR",
        },
      },
    },
    422,
  );

  assert.match(message, /total trip budget/i);
  assert.match(message, /at least/i);
  assert.match(message, /48,600/);
});
