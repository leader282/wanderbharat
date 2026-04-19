import type {
  ConstraintError,
  ConstraintErrorReason,
  GenerateItineraryInput,
  ItineraryDay,
  TransportMode,
} from "@/types/domain";
import type { TravelStyleConfig } from "@/lib/config/travelStyle";
import {
  MAX_TRIP_DAYS,
  normaliseTravellers,
} from "@/lib/itinerary/planningLimits";
import { maxDailyHoursFor } from "@/lib/config/transportMode";

/**
 * Constraint engine. Pure, deterministic, zero I/O. Returns structured
 * errors so the API layer can translate them to HTTP responses.
 */

export function validateInput(
  input: GenerateItineraryInput,
): ConstraintError | null {
  if (
    !Array.isArray(input.regions) ||
    input.regions.length === 0 ||
    input.regions.some((r) => !r?.trim())
  ) {
    return makeError(
      "invalid_input",
      "At least one region is required.",
    );
  }
  if (!input.start_node?.trim()) {
    return makeError("invalid_input", "Starting location is required.");
  }
  if (
    !Number.isFinite(input.days) ||
    input.days < 1 ||
    input.days > MAX_TRIP_DAYS
  ) {
    return makeError(
      "invalid_input",
      `Trip length must be between 1 and ${MAX_TRIP_DAYS} days.`,
    );
  }
  if (
    input.requested_city_ids?.some((cityId) => !cityId?.trim())
  ) {
    return makeError(
      "invalid_input",
      "Requested cities must be valid node ids.",
    );
  }
  if (input.preferences.transport_modes?.length === 0) {
    return makeError(
      "invalid_input",
      "At least one transport mode is required.",
    );
  }
  const { min, max } = input.preferences.budget;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
    return makeError(
      "invalid_input",
      "Budget range must be a valid non-negative min ≤ max.",
    );
  }
  const travellers = normaliseTravellers(input.preferences.travellers);
  if (travellers.adults < 1 || travellers.children < 0) {
    return makeError(
      "invalid_input",
      "At least one adult traveller is required.",
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
        "Drop a stop, pick a faster travel style, or add another day.",
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
    const shortfall = Math.round(budget.min - estimatedCost);
    return makeError(
      "budget_too_low",
      `Estimated trip cost ${Math.round(estimatedCost)} is below the minimum budget target of ${budget.min}.`,
      "Lower the minimum budget or add another destination or day.",
      { estimated_cost: estimatedCost, budget, shortfall },
    );
  }
  if (estimatedCost > budget.max) {
    const excess = Math.round(estimatedCost - budget.max);
    return makeError(
      "budget_exceeded",
      `Estimated trip cost ${Math.round(estimatedCost)} exceeds the maximum budget of ${budget.max}.`,
      "Increase the budget, shorten the trip, or pick cheaper destinations.",
      { estimated_cost: estimatedCost, budget, excess },
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
    "Try a different start city, fewer requested stops, or a longer trip.",
  );
}

export function requestedCitiesUncovered(args: {
  missingCityIds: string[];
  missingCityNames: string[];
  currentDays: number;
  requiredDays?: number;
  maxTripDays?: number;
}): ConstraintError {
  const maxTripDays = args.maxTripDays ?? MAX_TRIP_DAYS;
  const missingNames =
    args.missingCityNames.length > 0 ? args.missingCityNames : args.missingCityIds;
  const label =
    missingNames.length === 1
      ? missingNames[0]
      : `${missingNames.slice(0, -1).join(", ")} and ${
          missingNames[missingNames.length - 1]
        }`;
  const requiredDays = args.requiredDays;
  const additionalDays =
    requiredDays && requiredDays > args.currentDays
      ? requiredDays - args.currentDays
      : undefined;
  const feasibleWithinCap =
    requiredDays !== undefined && requiredDays <= maxTripDays;

  if (feasibleWithinCap && additionalDays !== undefined) {
    return makeError(
      "requested_cities_uncovered",
      `We couldn't cover ${label} in ${args.currentDays} days. Add ${additionalDays} ${additionalDays === 1 ? "day" : "days"} to make room.`,
      `Try a ${requiredDays}-day trip to include every requested city.`,
      {
        missing_city_ids: args.missingCityIds,
        missing_city_names: missingNames,
        current_days: args.currentDays,
        required_days: requiredDays,
        additional_days_needed: additionalDays,
        max_trip_days: maxTripDays,
        feasible_within_cap: true,
      },
    );
  }

  return makeError(
    "requested_cities_uncovered",
    `We couldn't cover ${label} within the ${maxTripDays}-day trip cap.`,
    requiredDays
      ? `You would need at least ${requiredDays} days to include every requested city.`
      : `Try fewer requested cities or a different starting point.`,
    {
      missing_city_ids: args.missingCityIds,
      missing_city_names: missingNames,
      current_days: args.currentDays,
      required_days: requiredDays,
      additional_days_needed: additionalDays,
      max_trip_days: maxTripDays,
      feasible_within_cap: false,
    },
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
