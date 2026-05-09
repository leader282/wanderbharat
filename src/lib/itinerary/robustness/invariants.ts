import { getTravelStyleConfig } from "@/lib/config/travelStyle";
import { maxDailyHoursFor } from "@/lib/config/transportMode";
import {
  defaultEngineTuning,
  mergeEngineTuning,
} from "@/lib/config/engineTuning";
import type { EngineResult } from "@/lib/itinerary/engine";
import { buildTravelMatrix } from "@/lib/itinerary/travelMatrix";
import type {
  ConstraintErrorReason,
  GraphNode,
  TransportMode,
} from "@/types/domain";

import { deriveSeed } from "./rng";
import {
  createDeterministicMakeId,
  deterministicNowFromSeed,
} from "./serialization";
import type { GeneratedScenario, InvariantViolation } from "./types";

const KNOWN_CONSTRAINT_REASONS: readonly ConstraintErrorReason[] = [
  "travel_time_exceeded",
  "total_time_exceeded",
  "budget_too_low",
  "budget_exceeded",
  "no_feasible_route",
  "insufficient_nodes",
  "requested_cities_uncovered",
  "invalid_input",
];

const EPSILON_HOURS = 0.05;
const EPSILON_DISTANCE_KM = 1.0;

export function validateEngineResult(
  scenario: GeneratedScenario,
  result: EngineResult,
  elapsedMs: number,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    addViolation(violations, {
      code: "perf.elapsed_ms.invalid",
      message: "Elapsed time must be a finite non-negative number.",
      severity: "error",
      path: "elapsedMs",
      expected: "finite number >= 0",
      actual: elapsedMs,
    });
  }

  if (scenario.expectation === "must_plan" && !result.ok) {
    addViolation(violations, {
      code: "expectation.must_plan.rejected",
      message:
        "Scenario marked must_plan returned a constraint rejection instead of an itinerary.",
      severity: "error",
      path: "result.ok",
      expected: true,
      actual: false,
    });
  }

  if (result.ok) {
    validateSuccessfulResult(scenario, result, violations);
  } else {
    validateRejectedResult(scenario, result, violations);
  }

  return violations;
}

function validateRejectedResult(
  scenario: GeneratedScenario,
  result: Extract<EngineResult, { ok: false }>,
  violations: InvariantViolation[],
): void {
  if (result.error.error !== "constraint_violation") {
    addViolation(violations, {
      code: "reject.error_tag.invalid",
      message: 'Rejected results must carry error="constraint_violation".',
      severity: "error",
      path: "result.error.error",
      expected: "constraint_violation",
      actual: result.error.error,
    });
  }

  if (!KNOWN_CONSTRAINT_REASONS.includes(result.error.reason)) {
    addViolation(violations, {
      code: "reject.reason.unknown",
      message: "Rejected result reason is not one of the known constraint reasons.",
      severity: "error",
      path: "result.error.reason",
      expected: KNOWN_CONSTRAINT_REASONS,
      actual: result.error.reason,
    });
  }

  if (!result.error.message?.trim()) {
    addViolation(violations, {
      code: "reject.message.empty",
      message: "Rejected result should include a human-readable error message.",
      severity: "error",
      path: "result.error.message",
      expected: "non-empty string",
      actual: result.error.message,
    });
  }

  if (result.error.reason === "requested_cities_uncovered") {
    const requested = scenario.input.requested_city_ids ?? [];
    if (requested.length === 0) {
      addViolation(violations, {
        code: "reject.requested_cities.missing_input",
        message:
          'Reason "requested_cities_uncovered" should only appear when requested_city_ids were supplied.',
        severity: "warning",
        path: "scenario.input.requested_city_ids",
        expected: "at least one requested city",
        actual: requested,
      });
    }
  }

  if (result.error.reason === "invalid_input") {
    addViolation(violations, {
      code: "reject.invalid_input.generated_case",
      message:
        "Generated robustness scenarios should avoid invalid_input failures unless intentionally malformed.",
      severity: "warning",
      path: "result.error.reason",
      expected: "constraint reason other than invalid_input for generated inputs",
      actual: result.error.reason,
    });
  }
}

function validateSuccessfulResult(
  scenario: GeneratedScenario,
  result: Extract<EngineResult, { ok: true }>,
  violations: InvariantViolation[],
): void {
  const itinerary = result.itinerary;
  const nodesById = new Map<string, GraphNode>(
    scenario.context.nodes.map((node) => [node.id, node]),
  );
  const routeNodeSet = new Set(itinerary.nodes);
  const modes = normaliseModes(scenario.input.preferences.transport_modes);
  const tuning = mergeEngineTuning(
    defaultEngineTuning,
    scenario.context.tuningOverride,
  );
  const matrix = buildTravelMatrix(
    scenario.context.nodes,
    scenario.context.edges,
    modes,
    tuning,
  );
  const travelStyleCfg = getTravelStyleConfig(scenario.input.preferences.travel_style);

  const caseSeed = deriveSeed(scenario.seed, scenario.index);
  const expectedNow = scenario.context.nowEpochMs ?? deterministicNowFromSeed(caseSeed);
  const expectedIdSeed = scenario.context.makeIdSeed ?? `${caseSeed}::make-id`;
  const expectedFirstId = createDeterministicMakeId(expectedIdSeed)("it");

  if (itinerary.created_at !== expectedNow) {
    addViolation(violations, {
      code: "determinism.created_at.mismatch",
      message:
        "Itinerary created_at should match the deterministic now() injected into engine context.",
      severity: "error",
      path: "result.itinerary.created_at",
      expected: expectedNow,
      actual: itinerary.created_at,
    });
  }

  if (itinerary.id !== expectedFirstId) {
    addViolation(violations, {
      code: "determinism.id.mismatch",
      message:
        "Itinerary id should match deterministic makeId() output for the scenario seed.",
      severity: "error",
      path: "result.itinerary.id",
      expected: expectedFirstId,
      actual: itinerary.id,
    });
  }

  if (itinerary.days !== scenario.input.days) {
    addViolation(violations, {
      code: "struct.days.mismatch",
      message: "Itinerary day count must match requested input days.",
      severity: "error",
      path: "result.itinerary.days",
      expected: scenario.input.days,
      actual: itinerary.days,
    });
  }

  if (itinerary.day_plan.length !== itinerary.days) {
    addViolation(violations, {
      code: "struct.day_plan.length",
      message: "day_plan length must equal itinerary.days.",
      severity: "error",
      path: "result.itinerary.day_plan",
      expected: itinerary.days,
      actual: itinerary.day_plan.length,
    });
  }

  if (itinerary.region !== scenario.input.regions[0]) {
    addViolation(violations, {
      code: "struct.region.primary",
      message:
        "Itinerary region must stay aligned with the first requested input region.",
      severity: "error",
      path: "result.itinerary.region",
      expected: scenario.input.regions[0],
      actual: itinerary.region,
    });
  }

  if (itinerary.start_node !== scenario.input.start_node) {
    addViolation(violations, {
      code: "route.start_node.mismatch",
      message: "Itinerary start_node should equal input.start_node.",
      severity: "error",
      path: "result.itinerary.start_node",
      expected: scenario.input.start_node,
      actual: itinerary.start_node,
    });
  }

  const expectedEndNode = scenario.input.end_node ?? scenario.input.start_node;
  if (itinerary.end_node !== expectedEndNode) {
    addViolation(violations, {
      code: "route.end_node.mismatch",
      message: "Itinerary end_node should equal requested end node (or start for round-trip).",
      severity: "error",
      path: "result.itinerary.end_node",
      expected: expectedEndNode,
      actual: itinerary.end_node,
    });
  }

  if (itinerary.nodes.length === 0) {
    addViolation(violations, {
      code: "route.nodes.empty",
      message: "Itinerary nodes must not be empty for successful plans.",
      severity: "error",
      path: "result.itinerary.nodes",
      expected: "non-empty node sequence",
      actual: itinerary.nodes,
    });
  } else {
    const first = itinerary.nodes[0];
    const last = itinerary.nodes[itinerary.nodes.length - 1];
    if (first !== itinerary.start_node) {
      addViolation(violations, {
        code: "route.nodes.first",
        message: "First route node must equal itinerary.start_node.",
        severity: "error",
        path: "result.itinerary.nodes[0]",
        expected: itinerary.start_node,
        actual: first,
      });
    }
    if (last !== itinerary.end_node) {
      addViolation(violations, {
        code: "route.nodes.last",
        message: "Last route node must equal itinerary.end_node.",
        severity: "error",
        path: "result.itinerary.nodes[last]",
        expected: itinerary.end_node,
        actual: last,
      });
    }
  }

  for (let i = 1; i < itinerary.nodes.length; i += 1) {
    if (itinerary.nodes[i] === itinerary.nodes[i - 1]) {
      addViolation(violations, {
        code: "route.nodes.adjacent_duplicate",
        message: "Route should not include adjacent duplicate node ids.",
        severity: "warning",
        path: `result.itinerary.nodes[${i}]`,
        expected: "different from previous route node",
        actual: itinerary.nodes[i],
      });
    }
  }

  for (const nodeId of itinerary.nodes) {
    const node = nodesById.get(nodeId);
    if (!node) {
      addViolation(violations, {
        code: "route.node.missing_context",
        message: "Each itinerary route node must exist in scenario context nodes.",
        severity: "error",
        path: "result.itinerary.nodes",
        expected: "node id present in context",
        actual: nodeId,
      });
      continue;
    }

    if (node.type !== "city") {
      addViolation(violations, {
        code: "route.node.non_city",
        message: "Route node sequence should contain city nodes only.",
        severity: "error",
        path: `result.itinerary.nodes:${nodeId}`,
        expected: "city",
        actual: node.type,
      });
    }

    if (!scenario.input.regions.includes(node.region)) {
      addViolation(violations, {
        code: "route.node.outside_regions",
        message: "Route nodes should stay within requested planning regions.",
        severity: "warning",
        path: `result.itinerary.nodes:${nodeId}`,
        expected: scenario.input.regions,
        actual: node.region,
      });
    }

    if (
      !Number.isFinite(node.location.lat) ||
      !Number.isFinite(node.location.lng) ||
      node.location.lat < -90 ||
      node.location.lat > 90 ||
      node.location.lng < -180 ||
      node.location.lng > 180
    ) {
      addViolation(violations, {
        code: "route.node.coordinates.invalid",
        message: "Route node coordinates must be finite and within lat/lng bounds.",
        severity: "error",
        path: `scenario.context.nodes:${nodeId}.location`,
        expected: "{ lat: -90..90, lng: -180..180 }",
        actual: node.location,
      });
    }
  }

  if (!Number.isFinite(itinerary.score) || itinerary.score < 0 || itinerary.score > 1) {
    addViolation(violations, {
      code: "score.range.invalid",
      message: "Itinerary score should be finite and normalized to [0, 1].",
      severity: "error",
      path: "result.itinerary.score",
      expected: "0 <= score <= 1",
      actual: itinerary.score,
    });
  }

  if (!Number.isFinite(itinerary.estimated_cost) || itinerary.estimated_cost < 0) {
    addViolation(violations, {
      code: "cost.estimated.invalid",
      message: "estimated_cost must be finite and non-negative.",
      severity: "error",
      path: "result.itinerary.estimated_cost",
      expected: "finite number >= 0",
      actual: itinerary.estimated_cost,
    });
  }

  validateWarnings(itinerary.warnings, violations);
  validateRequestedCities(scenario, routeNodeSet, violations);
  validateBudgetBreakdown(itinerary, violations);

  for (let dayIndex = 0; dayIndex < itinerary.day_plan.length; dayIndex += 1) {
    const day = itinerary.day_plan[dayIndex];
    if (day.day_index !== dayIndex) {
      addViolation(violations, {
        code: "day.index.sequence",
        message: "day_plan entries must use sequential day_index values from 0..days-1.",
        severity: "error",
        path: `result.itinerary.day_plan[${dayIndex}].day_index`,
        expected: dayIndex,
        actual: day.day_index,
      });
    }

    if (!routeNodeSet.has(day.base_node_id)) {
      addViolation(violations, {
        code: "day.base_node.route_mismatch",
        message: "Each day base node should be present in itinerary.nodes sequence.",
        severity: "error",
        path: `result.itinerary.day_plan[${dayIndex}].base_node_id`,
        expected: "node id present in itinerary.nodes",
        actual: day.base_node_id,
      });
    }

    const baseNode = nodesById.get(day.base_node_id);
    if (!baseNode) {
      addViolation(violations, {
        code: "day.base_node.missing_context",
        message: "Each day base node should exist in scenario context.",
        severity: "error",
        path: `result.itinerary.day_plan[${dayIndex}].base_node_id`,
        expected: "known context node",
        actual: day.base_node_id,
      });
    } else if (baseNode.type !== "city") {
      addViolation(violations, {
        code: "day.base_node.non_city",
        message: "day.base_node_id should always reference a city node.",
        severity: "error",
        path: `result.itinerary.day_plan[${dayIndex}].base_node_id`,
        expected: "city node",
        actual: baseNode.type,
      });
    }

    if (!Number.isFinite(day.total_activity_hours) || day.total_activity_hours < 0) {
      addViolation(violations, {
        code: "timing.total_activity.invalid",
        message: "total_activity_hours must be finite and non-negative.",
        severity: "error",
        path: `result.itinerary.day_plan[${dayIndex}].total_activity_hours`,
        expected: "finite number >= 0",
        actual: day.total_activity_hours,
      });
    }

    if (!Number.isFinite(day.total_travel_hours) || day.total_travel_hours < 0) {
      addViolation(violations, {
        code: "timing.total_travel.invalid",
        message: "total_travel_hours must be finite and non-negative.",
        severity: "error",
        path: `result.itinerary.day_plan[${dayIndex}].total_travel_hours`,
        expected: "finite number >= 0",
        actual: day.total_travel_hours,
      });
    }

    const totalActivityFromEntries = sum(
      day.activities.map((activity) => activity.duration_hours),
    );
    if (
      Math.abs(totalActivityFromEntries - day.total_activity_hours) > EPSILON_HOURS
    ) {
      addViolation(violations, {
        code: "timing.activity_sum.mismatch",
        message:
          "total_activity_hours should equal the sum of individual activity durations.",
        severity: "error",
        path: `result.itinerary.day_plan[${dayIndex}]`,
        expected: totalActivityFromEntries,
        actual: day.total_activity_hours,
      });
    }

    const dayMode = day.travel?.transport_mode ?? modes[0] ?? "road";
    const modeCap = maxDailyHoursFor(dayMode, travelStyleCfg.maxTravelHoursPerDay);
    if (day.total_travel_hours > modeCap + 0.01) {
      addViolation(violations, {
        code: "timing.travel_cap.exceeded",
        message: "Day travel exceeds per-mode daily cap from travel-style config.",
        severity: "error",
        path: `result.itinerary.day_plan[${dayIndex}].total_travel_hours`,
        expected: `<= ${modeCap}`,
        actual: day.total_travel_hours,
      });
    }

    const totalDayHours = day.total_activity_hours + day.total_travel_hours;
    if (totalDayHours > travelStyleCfg.maxTotalHoursPerDay + 0.01) {
      addViolation(violations, {
        code: "timing.total_day_cap.exceeded",
        message: "Day total (activity + travel) exceeds maxTotalHoursPerDay.",
        severity: "error",
        path: `result.itinerary.day_plan[${dayIndex}]`,
        expected: `<= ${travelStyleCfg.maxTotalHoursPerDay}`,
        actual: totalDayHours,
      });
    }

    if (day.travel) {
      if (!modes.includes(day.travel.transport_mode)) {
        addViolation(violations, {
          code: "route.leg.mode.not_allowed",
          message:
            "Travel legs must use one of the requested transport modes for the scenario.",
          severity: "error",
          path: `result.itinerary.day_plan[${dayIndex}].travel.transport_mode`,
          expected: modes,
          actual: day.travel.transport_mode,
        });
      }

      const matrixLeg = matrix.get(
        day.travel.from_node_id,
        day.travel.to_node_id,
        day.travel.transport_mode,
      );
      if (!matrixLeg) {
        addViolation(violations, {
          code: "route.leg.missing_in_matrix",
          message: "Every emitted travel leg should exist in the offline travel matrix.",
          severity: "error",
          path: `result.itinerary.day_plan[${dayIndex}].travel`,
          expected: "matching leg in matrix",
          actual: day.travel,
        });
      } else {
        if (
          Math.abs(day.travel.travel_time_hours - matrixLeg.travel_time_hours) >
          EPSILON_HOURS
        ) {
          addViolation(violations, {
            code: "route.leg.travel_time.mismatch",
            message:
              "Travel leg time should match matrix value within tolerance.",
            severity: "warning",
            path: `result.itinerary.day_plan[${dayIndex}].travel.travel_time_hours`,
            expected: matrixLeg.travel_time_hours,
            actual: day.travel.travel_time_hours,
          });
        }
        if (
          Math.abs(day.travel.distance_km - matrixLeg.distance_km) > EPSILON_DISTANCE_KM
        ) {
          addViolation(violations, {
            code: "route.leg.distance.mismatch",
            message: "Travel leg distance should match matrix value within tolerance.",
            severity: "warning",
            path: `result.itinerary.day_plan[${dayIndex}].travel.distance_km`,
            expected: matrixLeg.distance_km,
            actual: day.travel.distance_km,
          });
        }
      }

      if (
        Math.abs(day.total_travel_hours - day.travel.travel_time_hours) >
        EPSILON_HOURS
      ) {
        addViolation(violations, {
          code: "timing.travel_total.mismatch",
          message:
            "total_travel_hours should equal the travel leg time for that day.",
          severity: "warning",
          path: `result.itinerary.day_plan[${dayIndex}].total_travel_hours`,
          expected: day.travel.travel_time_hours,
          actual: day.total_travel_hours,
        });
      }
    } else if (day.total_travel_hours > EPSILON_HOURS) {
      addViolation(violations, {
        code: "timing.travel_total.without_leg",
        message:
          "Days without a travel leg should not report non-zero total_travel_hours.",
        severity: "warning",
        path: `result.itinerary.day_plan[${dayIndex}].total_travel_hours`,
        expected: 0,
        actual: day.total_travel_hours,
      });
    }

    for (const [activityIndex, activity] of day.activities.entries()) {
      if (!Number.isFinite(activity.duration_hours) || activity.duration_hours <= 0) {
        addViolation(violations, {
          code: "day.activity.duration.invalid",
          message: "Activity durations must be finite and strictly positive.",
          severity: "error",
          path: `result.itinerary.day_plan[${dayIndex}].activities[${activityIndex}].duration_hours`,
          expected: "finite number > 0",
          actual: activity.duration_hours,
        });
      }

      const activityNode = nodesById.get(activity.node_id);
      if (!activityNode) {
        addViolation(violations, {
          code: "day.activity.node.missing_context",
          message: "Activity node must exist in scenario context nodes.",
          severity: "error",
          path: `result.itinerary.day_plan[${dayIndex}].activities[${activityIndex}].node_id`,
          expected: "known context node id",
          actual: activity.node_id,
        });
        continue;
      }

      if (
        activity.node_id !== day.base_node_id &&
        !(activityNode.type === "attraction" && activityNode.parent_node_id === day.base_node_id)
      ) {
        addViolation(violations, {
          code: "day.activity.city_mismatch",
          message:
            "Activity should belong to the day base city or be the city explore filler.",
          severity: "error",
          path: `result.itinerary.day_plan[${dayIndex}].activities[${activityIndex}].node_id`,
          expected: `base node ${day.base_node_id} or attraction with that parent`,
          actual: activity.node_id,
        });
      }

      if (activity.opening_time && !isClock(activity.opening_time)) {
        addViolation(violations, {
          code: "day.activity.opening_time.invalid",
          message: "opening_time must match HH:MM 24-hour format.",
          severity: "error",
          path: `result.itinerary.day_plan[${dayIndex}].activities[${activityIndex}].opening_time`,
          expected: "HH:MM",
          actual: activity.opening_time,
        });
      }
      if (activity.closing_time && !isClock(activity.closing_time)) {
        addViolation(violations, {
          code: "day.activity.closing_time.invalid",
          message: "closing_time must match HH:MM 24-hour format.",
          severity: "error",
          path: `result.itinerary.day_plan[${dayIndex}].activities[${activityIndex}].closing_time`,
          expected: "HH:MM",
          actual: activity.closing_time,
        });
      }

      if (
        activity.opening_time &&
        activity.closing_time &&
        toClockMinutes(activity.opening_time) >= toClockMinutes(activity.closing_time)
      ) {
        addViolation(violations, {
          code: "day.activity.clock_window.invalid",
          message: "opening_time should be earlier than closing_time.",
          severity: "warning",
          path: `result.itinerary.day_plan[${dayIndex}].activities[${activityIndex}]`,
          expected: "opening_time < closing_time",
          actual: {
            opening_time: activity.opening_time,
            closing_time: activity.closing_time,
          },
        });
      }
    }
  }
}

function validateWarnings(
  warnings: string[] | undefined,
  violations: InvariantViolation[],
): void {
  if (!warnings) return;

  const seen = new Set<string>();
  for (const [index, warning] of warnings.entries()) {
    const normalized = warning.trim();
    if (!normalized) {
      addViolation(violations, {
        code: "warnings.empty_entry",
        message: "Warning entries must not be empty strings.",
        severity: "warning",
        path: `result.itinerary.warnings[${index}]`,
        expected: "non-empty string",
        actual: warning,
      });
      continue;
    }
    if (seen.has(normalized)) {
      addViolation(violations, {
        code: "warnings.duplicate_entry",
        message: "Warning list should not contain duplicate messages.",
        severity: "warning",
        path: `result.itinerary.warnings[${index}]`,
        expected: "unique warning string",
        actual: warning,
      });
      continue;
    }
    seen.add(normalized);
  }
}

function validateRequestedCities(
  scenario: GeneratedScenario,
  routeNodeSet: Set<string>,
  violations: InvariantViolation[],
): void {
  const requested = scenario.input.requested_city_ids ?? [];
  for (const requestedCityId of requested) {
    if (!routeNodeSet.has(requestedCityId)) {
      addViolation(violations, {
        code: "requested_city.missing_in_route",
        message:
          "Successful itineraries should include every requested city id.",
        severity: "error",
        path: "result.itinerary.nodes",
        expected: requestedCityId,
        actual: "missing",
      });
    }
  }
}

function validateBudgetBreakdown(
  itinerary: Extract<EngineResult, { ok: true }>["itinerary"],
  violations: InvariantViolation[],
): void {
  const breakdown = itinerary.budget_breakdown;
  if (!breakdown) return;

  let lineItemsTotal = 0;
  for (const [index, lineItem] of breakdown.line_items.entries()) {
    if (!Number.isFinite(lineItem.amount) || lineItem.amount < 0) {
      addViolation(violations, {
        code: "cost.line_item.amount.invalid",
        message: "Budget line-item amounts must be finite and non-negative.",
        severity: "error",
        path: `result.itinerary.budget_breakdown.line_items[${index}].amount`,
        expected: "finite number >= 0",
        actual: lineItem.amount,
      });
    } else {
      lineItemsTotal += lineItem.amount;
    }

    if (!Number.isInteger(lineItem.day_index) || lineItem.day_index < 0) {
      addViolation(violations, {
        code: "cost.line_item.day_index.invalid",
        message: "Budget line-item day_index should be a non-negative integer.",
        severity: "warning",
        path: `result.itinerary.budget_breakdown.line_items[${index}].day_index`,
        expected: "integer >= 0",
        actual: lineItem.day_index,
      });
    }
  }

  const tolerance = Math.max(15, itinerary.days * 8);
  if (Math.abs(lineItemsTotal - itinerary.estimated_cost) > tolerance) {
    addViolation(violations, {
      code: "cost.total.mismatch",
      message:
        "Budget line-item sum should stay close to itinerary.estimated_cost.",
      severity: "warning",
      path: "result.itinerary.budget_breakdown.line_items",
      expected: itinerary.estimated_cost,
      actual: lineItemsTotal,
    });
  }

  validateOptionalCount(
    breakdown.verifiedAttractionCostsCount,
    "verifiedAttractionCostsCount",
    violations,
  );
  validateOptionalCount(
    breakdown.estimatedAttractionCostsCount,
    "estimatedAttractionCostsCount",
    violations,
  );
  validateOptionalCount(
    breakdown.unknownAttractionCostsCount,
    "unknownAttractionCostsCount",
    violations,
  );
}

function validateOptionalCount(
  value: number | undefined,
  pathSuffix: string,
  violations: InvariantViolation[],
): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    addViolation(violations, {
      code: "cost.count.invalid",
      message: "Budget count metrics should be non-negative integers.",
      severity: "warning",
      path: `result.itinerary.budget_breakdown.${pathSuffix}`,
      expected: "integer >= 0",
      actual: value,
    });
  }
}

function normaliseModes(modes: TransportMode[] | undefined): TransportMode[] {
  if (!modes || modes.length === 0) return ["road"];
  const out: TransportMode[] = [];
  const seen = new Set<TransportMode>();
  for (const mode of modes) {
    if (mode !== "road" && mode !== "train" && mode !== "flight") continue;
    if (seen.has(mode)) continue;
    seen.add(mode);
    out.push(mode);
  }
  return out.length > 0 ? out : ["road"];
}

function isClock(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function toClockMinutes(clock: string): number {
  const [hour, minute] = clock.split(":").map((part) => Number(part));
  return hour * 60 + minute;
}

function addViolation(
  violations: InvariantViolation[],
  violation: InvariantViolation,
): void {
  violations.push(violation);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
