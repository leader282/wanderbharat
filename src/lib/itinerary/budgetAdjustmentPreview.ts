import { makeMoneyFormatter } from "@/lib/itinerary/presentation";
import {
  getDistinctDestinationCount,
  getDisplayRouteStops,
} from "@/lib/itinerary/routeDisplay";
import type { Itinerary } from "@/types/domain";

export interface BudgetAdjustmentImpact {
  id: "stays" | "cities" | "days" | "activities" | "travel" | "route";
  title: string;
  detail: string;
}

export interface BudgetAdjustmentPreview {
  requestedBudget: number;
  currentBudget: number;
  currency: string;
  direction: "upgrade" | "downgrade" | "same";
  summary: string;
  impacts: BudgetAdjustmentImpact[];
  currentEstimatedCost: number;
  proposedEstimatedCost: number;
}

export function buildBudgetAdjustmentPreview(args: {
  current: Itinerary;
  proposed: Itinerary;
  requestedBudget: number;
  currency?: string;
}): BudgetAdjustmentPreview {
  const currency =
    args.currency ??
    args.proposed.preferences.budget.currency ??
    args.current.preferences.budget.currency ??
    "INR";
  const formatMoney = makeMoneyFormatter(currency);
  const direction = compareBudgetDirection(
    args.requestedBudget,
    args.current.preferences.budget.max,
  );
  const impacts = compact([
    buildStayImpact(args.current, args.proposed, formatMoney),
    buildCityImpact(args.current, args.proposed),
    buildDaySplitImpact(args.current, args.proposed),
    buildActivityImpact(args.current, args.proposed),
    buildTravelImpact(args.current, args.proposed),
  ]);

  if (impacts.length === 0) {
    impacts.push({
      id: "route",
      title: "Route shape",
      detail:
        "The overall trip stays broadly the same, so the main change is the new budget ceiling attached to this itinerary.",
    });
  }

  return {
    requestedBudget: Math.max(0, Math.round(args.requestedBudget)),
    currentBudget: args.current.preferences.budget.max,
    currency,
    direction,
    summary: buildSummary(direction, impacts),
    impacts,
    currentEstimatedCost: args.current.estimated_cost,
    proposedEstimatedCost: args.proposed.estimated_cost,
  };
}

function buildStayImpact(
  current: Itinerary,
  proposed: Itinerary,
  formatMoney: (value: number) => string,
): BudgetAdjustmentImpact | null {
  const currentNightly = resolveNightlyAverage(current);
  const proposedNightly = resolveNightlyAverage(proposed);
  const currentLodging = resolveLodgingSubtotal(current);
  const proposedLodging = resolveLodgingSubtotal(proposed);

  if (
    Math.abs(currentNightly - proposedNightly) < 250 &&
    Math.abs(currentLodging - proposedLodging) < 1_000
  ) {
    return null;
  }

  return {
    id: "stays",
    title: "Stay budget",
    detail: `Average stay spend shifts from ${formatMoney(currentNightly)}/night (${formatMoney(
      currentLodging,
    )} total) to ${formatMoney(proposedNightly)}/night (${formatMoney(
      proposedLodging,
    )} total).`,
  };
}

function buildCityImpact(
  current: Itinerary,
  proposed: Itinerary,
): BudgetAdjustmentImpact | null {
  const currentStops = getDisplayRouteStops(current);
  const proposedStops = getDisplayRouteStops(proposed);
  const currentCount = getDistinctDestinationCount(current);
  const proposedCount = getDistinctDestinationCount(proposed);
  const currentIds = new Set(currentStops.map((stop) => stop.id));
  const proposedIds = new Set(proposedStops.map((stop) => stop.id));
  const added = uniqueNames(
    proposedStops
      .filter((stop) => !currentIds.has(stop.id))
      .map((stop) => stop.name),
  );
  const removed = uniqueNames(
    currentStops
      .filter((stop) => !proposedIds.has(stop.id))
      .map((stop) => stop.name),
  );

  if (currentCount === proposedCount && added.length === 0 && removed.length === 0) {
    return null;
  }

  const sentences = [
    currentCount !== proposedCount
      ? `The route changes from ${currentCount} to ${proposedCount} destination${proposedCount === 1 ? "" : "s"}.`
      : "The route swaps out some stops while keeping the same number of destinations.",
    added.length > 0 ? `Adds ${formatNameList(added)}.` : null,
    removed.length > 0 ? `Drops ${formatNameList(removed)}.` : null,
  ];

  return {
    id: "cities",
    title: "Route coverage",
    detail: compact(sentences).join(" "),
  };
}

function buildDaySplitImpact(
  current: Itinerary,
  proposed: Itinerary,
): BudgetAdjustmentImpact | null {
  const currentDays = buildCityDayCounts(current);
  const proposedDays = buildCityDayCounts(proposed);
  const allIds = new Set([...currentDays.keys(), ...proposedDays.keys()]);
  const increases: Array<{ name: string; delta: number }> = [];
  const decreases: Array<{ name: string; delta: number }> = [];

  for (const id of allIds) {
    const currentEntry = currentDays.get(id);
    const proposedEntry = proposedDays.get(id);
    const delta = (proposedEntry?.days ?? 0) - (currentEntry?.days ?? 0);
    if (delta > 0) {
      increases.push({ name: proposedEntry?.name ?? currentEntry?.name ?? id, delta });
    } else if (delta < 0) {
      decreases.push({
        name: proposedEntry?.name ?? currentEntry?.name ?? id,
        delta: Math.abs(delta),
      });
    }
  }

  if (increases.length === 0 && decreases.length === 0) return null;

  const detail = compact([
    increases.length > 0
      ? `More time in ${formatDayDiffs(increases, "increase")}.`
      : null,
    decreases.length > 0
      ? `Less time in ${formatDayDiffs(decreases, "decrease")}.`
      : null,
  ]).join(" ");

  return {
    id: "days",
    title: "Day split",
    detail,
  };
}

function buildActivityImpact(
  current: Itinerary,
  proposed: Itinerary,
): BudgetAdjustmentImpact | null {
  const currentCount = countActivityBlocks(current);
  const proposedCount = countActivityBlocks(proposed);
  const currentHours = totalActivityHours(current);
  const proposedHours = totalActivityHours(proposed);

  if (currentCount === proposedCount && Math.abs(currentHours - proposedHours) < 1) {
    return null;
  }

  return {
    id: "activities",
    title: "Things to do",
    detail: `Planned activity time shifts from ${formatHours(
      currentHours,
    )} across ${currentCount} activity block${currentCount === 1 ? "" : "s"} to ${formatHours(
      proposedHours,
    )} across ${proposedCount} activity block${proposedCount === 1 ? "" : "s"}.`,
  };
}

function buildTravelImpact(
  current: Itinerary,
  proposed: Itinerary,
): BudgetAdjustmentImpact | null {
  const currentHours = totalTravelHours(current);
  const proposedHours = totalTravelHours(proposed);
  const currentMoveDays = current.day_plan.filter((day) => day.travel).length;
  const proposedMoveDays = proposed.day_plan.filter((day) => day.travel).length;

  if (Math.abs(currentHours - proposedHours) < 0.5 && currentMoveDays === proposedMoveDays) {
    return null;
  }

  return {
    id: "travel",
    title: "Travel load",
    detail: `Travel changes from ${formatHours(currentHours)} over ${currentMoveDays} move day${currentMoveDays === 1 ? "" : "s"} to ${formatHours(
      proposedHours,
    )} over ${proposedMoveDays} move day${proposedMoveDays === 1 ? "" : "s"}.`,
  };
}

function buildSummary(
  direction: BudgetAdjustmentPreview["direction"],
  impacts: BudgetAdjustmentImpact[],
): string {
  const labels = impacts
    .map((impact) => impact.title.toLowerCase())
    .filter((label) => label !== "route shape");
  const joined = labels.length > 0 ? joinLabels(labels.slice(0, 3)) : "the same plan";

  switch (direction) {
    case "downgrade":
      return `A lower budget would mainly trim ${joined}.`;
    case "upgrade":
      return `A higher budget could improve ${joined}.`;
    default:
      return "This budget keeps the overall trip shape broadly the same.";
  }
}

function compareBudgetDirection(
  requestedBudget: number,
  currentBudget: number,
): BudgetAdjustmentPreview["direction"] {
  if (requestedBudget > currentBudget) return "upgrade";
  if (requestedBudget < currentBudget) return "downgrade";
  return "same";
}

function resolveLodgingSubtotal(itinerary: Itinerary): number {
  if (typeof itinerary.budget_breakdown?.lodgingSubtotal === "number") {
    return itinerary.budget_breakdown.lodgingSubtotal;
  }
  return itinerary.stays.reduce((sum, stay) => sum + stay.totalCost, 0);
}

function resolveNightlyAverage(itinerary: Itinerary): number {
  if (typeof itinerary.budget_breakdown?.nightlyAverage === "number") {
    return itinerary.budget_breakdown.nightlyAverage;
  }
  const nights = itinerary.stays.reduce((sum, stay) => sum + stay.nights, 0);
  if (nights <= 0) return 0;
  return resolveLodgingSubtotal(itinerary) / nights;
}

function buildCityDayCounts(
  itinerary: Itinerary,
): Map<string, { name: string; days: number }> {
  const counts = new Map<string, { name: string; days: number }>();

  for (const day of itinerary.day_plan) {
    const existing = counts.get(day.base_node_id);
    if (existing) {
      existing.days += 1;
      continue;
    }
    counts.set(day.base_node_id, {
      name: day.base_node_name,
      days: 1,
    });
  }

  return counts;
}

function countActivityBlocks(itinerary: Itinerary): number {
  return itinerary.day_plan.reduce((sum, day) => sum + day.activities.length, 0);
}

function totalActivityHours(itinerary: Itinerary): number {
  return itinerary.day_plan.reduce((sum, day) => sum + day.total_activity_hours, 0);
}

function totalTravelHours(itinerary: Itinerary): number {
  return itinerary.day_plan.reduce((sum, day) => sum + day.total_travel_hours, 0);
}

function formatHours(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}h`;
}

function formatNameList(names: string[]): string {
  return joinLabels(names.slice(0, 3));
}

function formatDayDiffs(
  entries: Array<{ name: string; delta: number }>,
  direction: "increase" | "decrease",
): string {
  return entries
    .sort((left, right) => {
      const deltaDiff = right.delta - left.delta;
      if (deltaDiff !== 0) return deltaDiff;
      return left.name.localeCompare(right.name);
    })
    .slice(0, 2)
    .map((entry) => {
      const prefix = direction === "increase" ? "+" : "-";
      return `${entry.name} (${prefix}${entry.delta} day${entry.delta === 1 ? "" : "s"})`;
    })
    .join(", ");
}

function joinLabels(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const name of names) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }

  return out;
}

function compact<T>(values: Array<T | null>): T[] {
  return values.filter((value): value is T => value !== null);
}
