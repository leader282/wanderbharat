import type {
  BudgetRange,
  Itinerary,
  ItineraryBudgetBreakdown,
  ItineraryBudgetLineItem,
  StayAssignment,
} from "@/types/domain";
import { deriveOptimalBudget } from "@/lib/itinerary/budget";

export function computeLodgingSubtotal(stays: StayAssignment[]): number {
  return roundCurrency(stays.reduce((sum, stay) => sum + stay.totalCost, 0));
}

export function computeNightlyAverage(stays: StayAssignment[]): number {
  const totalNights = stays.reduce((sum, stay) => sum + stay.nights, 0);
  if (totalNights <= 0) return 0;
  return roundCurrency(computeLodgingSubtotal(stays) / totalNights);
}

export function integrateAccommodationPlanIntoItinerary(args: {
  itinerary: Itinerary;
  stays: StayAssignment[];
  warnings?: string[];
  requestedBudget?: Pick<BudgetRange, "currency">;
}): Itinerary {
  const existingLineItems = args.itinerary.budget_breakdown?.line_items ?? [];
  const travelLineItems = existingLineItems.filter((item) => item.kind === "travel");
  const stayLineItems = buildStayBudgetLineItems(
    args.stays,
    buildCityNameMap(args.itinerary),
  );

  const lodgingSubtotal = computeLodgingSubtotal(args.stays);
  const travelSubtotal = roundCurrency(
    travelLineItems.reduce((sum, item) => sum + item.amount, 0),
  );
  const totalTripCost = roundCurrency(lodgingSubtotal + travelSubtotal);
  const nightlyAverage = computeNightlyAverage(args.stays);
  const warnings = dedupeWarnings([
    ...(args.itinerary.warnings ?? []),
    ...(args.warnings ?? []),
  ]);
  const currency =
    args.requestedBudget?.currency ?? args.itinerary.preferences.budget.currency;
  const derivedBudget = deriveOptimalBudget(totalTripCost, currency);
  const budgetBreakdown: ItineraryBudgetBreakdown = {
    line_items: sortBudgetLineItems([...stayLineItems, ...travelLineItems]),
    lodgingSubtotal,
    travelSubtotal,
    nightlyAverage,
    totalTripCost,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  return {
    ...args.itinerary,
    stays: args.stays,
    estimated_cost: Math.round(totalTripCost),
    preferences: {
      ...args.itinerary.preferences,
      budget: derivedBudget,
    },
    budget_breakdown: budgetBreakdown,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function buildStayBudgetLineItems(
  stays: StayAssignment[],
  cityNamesById: Map<string, string>,
): ItineraryBudgetLineItem[] {
  return stays
    .filter((stay) => stay.totalCost > 0)
    .map((stay) => {
      const cityName = cityNamesById.get(stay.nodeId) ?? stay.nodeId;
      return {
        id: `stay_${stay.startDay}_${stay.nodeId}_${stay.accommodationId ?? "unassigned"}`,
        day_index: stay.startDay,
        kind: "stay" as const,
        label: `Stay in ${cityName}`,
        amount: roundCurrency(stay.totalCost),
      };
    });
}

function buildCityNameMap(itinerary: Itinerary): Map<string, string> {
  const cityNamesById = new Map<string, string>();
  for (const day of itinerary.day_plan) {
    if (!cityNamesById.has(day.base_node_id)) {
      cityNamesById.set(day.base_node_id, day.base_node_name);
    }
  }
  return cityNamesById;
}

function sortBudgetLineItems(
  lineItems: ItineraryBudgetLineItem[],
): ItineraryBudgetLineItem[] {
  return [...lineItems].sort((left, right) => {
    const dayDiff = left.day_index - right.day_index;
    if (dayDiff !== 0) return dayDiff;

    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }

    return left.id.localeCompare(right.id);
  });
}

function dedupeWarnings(warnings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const warning of warnings) {
    const trimmed = warning.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
}

function roundCurrency(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}
