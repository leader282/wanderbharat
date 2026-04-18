import type {
  ConstraintError,
  ConstraintErrorReason,
  GenerateItineraryInput,
  ItineraryDay,
  TransportMode,
} from "@/types/domain";
import type { TravelStyleConfig } from "@/lib/config/travelStyle";
import { maxDailyHoursFor } from "@/lib/config/transportMode";

/**
 * Constraint engine. Pure, deterministic, zero I/O. Returns structured
 * errors so the API layer can translate them to HTTP responses.
 */

export function validateInput(
  input: GenerateItineraryInput,
): ConstraintError | null {
  if (!input.region?.trim()) {
    return makeError("invalid_input", "Region is required.");
  }
  if (!input.start_node?.trim()) {
    return makeError("invalid_input", "Starting location is required.");
  }
  if (!Number.isFinite(input.days) || input.days < 1 || input.days > 30) {
    return makeError(
      "invalid_input",
      "Trip length must be between 1 and 30 days.",
    );
  }
  const { min, max } = input.preferences.budget;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
    return makeError(
      "invalid_input",
      "Budget range must be a valid non-negative min ≤ max.",
    );
  }
  return null;
}

/**
 * Validates the per-day plan emitted by the engine. The engine already
 * tries hard to respect these limits, but we double-check so constraint
 * violations never silently ship to users.
 */
export function validateDayPlan(
  days: ItineraryDay[],
  cfg: TravelStyleConfig,
  /**
   * Allowed transport modes; used to pick a mode-aware daily cap when a
   * day carries a flight/train rather than a road leg.
   */
  allowedModes: TransportMode[] = ["road"],
): ConstraintError | null {
  for (const d of days) {
    const mode: TransportMode = d.travel?.transport_mode ?? allowedModes[0] ?? "road";
    const dailyCap = maxDailyHoursFor(mode, cfg.maxTravelHoursPerDay);

    if (d.total_travel_hours > dailyCap + 0.01) {
      return makeError(
        "travel_time_exceeded",
        `Day ${d.day_index + 1} has ${d.total_travel_hours.toFixed(1)}h of ${mode} travel (limit ${dailyCap.toFixed(1)}h for ${mode}).`,
        "Reduce the number of destinations or increase trip length.",
        {
          day_index: d.day_index,
          total_travel_hours: d.total_travel_hours,
          mode,
          limit_hours: dailyCap,
        },
      );
    }
    const total = d.total_activity_hours + d.total_travel_hours;
    if (total > cfg.maxTotalHoursPerDay + 0.01) {
      return makeError(
        "total_time_exceeded",
        `Day ${d.day_index + 1} is ${total.toFixed(1)}h long (limit ${cfg.maxTotalHoursPerDay}h).`,
        "Drop a destination or pick a more relaxed travel style.",
        { day_index: d.day_index, total_hours: total },
      );
    }
  }
  return null;
}

export function validateBudget(
  estimatedCost: number,
  budget: { min: number; max: number },
): ConstraintError | null {
  if (estimatedCost < budget.min) {
    return makeError(
      "budget_too_low",
      `Estimated trip cost ${Math.round(estimatedCost)} is below the minimum budget target of ${budget.min}.`,
      "Lower the minimum budget or add another destination or day.",
      { estimated_cost: estimatedCost, budget },
    );
  }
  if (estimatedCost > budget.max) {
    return makeError(
      "budget_exceeded",
      `Estimated trip cost ${Math.round(estimatedCost)} exceeds the maximum budget of ${budget.max}.`,
      "Increase the budget, shorten the trip, or pick cheaper destinations.",
      { estimated_cost: estimatedCost, budget },
    );
  }
  return null;
}

export function insufficientNodes(found: number, required: number): ConstraintError {
  return makeError(
    "insufficient_nodes",
    `Not enough destinations available in this region (${found} usable, need at least ${required}).`,
    "Seed more cities/attractions for this region, or pick a broader region.",
    { found, required },
  );
}

export function noFeasibleRoute(): ConstraintError {
  return makeError(
    "no_feasible_route",
    "No feasible route found under the current travel-style constraints.",
    "Increase trip length, relax the travel style, or pick a closer start city.",
  );
}

function makeError(
  reason: ConstraintErrorReason,
  message: string,
  suggestion?: string,
  details?: Record<string, unknown>,
): ConstraintError {
  return { error: "constraint_violation", reason, message, suggestion, details };
}
