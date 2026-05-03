import {
  topBudgetDrivers,
  type BudgetDriver,
} from "@/lib/itinerary/budget";
import { formatTravellerParty } from "@/lib/itinerary/presentation";
import type {
  BudgetRange,
  ItineraryBudgetBreakdown,
  ItineraryBudgetLineItem,
  TravellerComposition,
} from "@/types/domain";

const EMPTY_LINE_ITEMS: ItineraryBudgetLineItem[] = [];

export interface BudgetPanelState {
  currency: string;
  travellerLabel: string;
  lineItems: ItineraryBudgetLineItem[];
  hasStaySubtotal: boolean;
  lodgingSubtotal: number;
  hasTravelSubtotal: boolean;
  travelSubtotal: number;
  hasAttractionSubtotal: boolean;
  attractionSubtotal: number;
  verifiedAttractionCostsCount: number;
  estimatedAttractionCostsCount: number;
  unknownAttractionCostsCount: number;
  hasUnknownAttractionCosts: boolean;
  hasNightlyAverage: boolean;
  nightlyAverage: number;
  totalTripCost: number;
  hasDetailedBreakdown: boolean;
  recommendedBudget?: BudgetRange;
  budgetGap: number;
  budgetGapLabel: "Budget buffer" | "Over budget";
  biggestDrivers: BudgetDriver[];
}

export function deriveBudgetPanelState(args: {
  estimatedCost: number;
  requestedBudget: BudgetRange;
  travellers: TravellerComposition;
  breakdown?: ItineraryBudgetBreakdown;
}): BudgetPanelState {
  const lineItems = args.breakdown?.line_items ?? EMPTY_LINE_ITEMS;
  const attractionLineItems = lineItems.filter((item) => item.kind === "attraction");
  const {
    verified: derivedVerifiedAttractionCount,
    estimated: derivedEstimatedAttractionCount,
  } = deriveAttractionConfidenceCounts(attractionLineItems);
  const hasAttractionSubtotal =
    args.breakdown?.attractionSubtotal !== undefined ||
    attractionLineItems.length > 0;
  const attractionSubtotal = hasAttractionSubtotal
    ? args.breakdown?.attractionSubtotal ??
      sumBudgetLineItemsByKind(lineItems, "attraction")
    : 0;
  const verifiedAttractionCostsCount = normaliseCount(
    args.breakdown?.verifiedAttractionCostsCount,
    Math.max(0, derivedVerifiedAttractionCount),
  );
  const estimatedAttractionCostsCount = normaliseCount(
    args.breakdown?.estimatedAttractionCostsCount,
    Math.max(0, derivedEstimatedAttractionCount),
  );
  const unknownAttractionCostsCount = normaliseCount(
    args.breakdown?.unknownAttractionCostsCount,
    0,
  );
  const hasStaySubtotal =
    args.breakdown?.lodgingSubtotal !== undefined ||
    lineItems.some((item) => item.kind === "stay");
  const lodgingSubtotal = hasStaySubtotal
    ? args.breakdown?.lodgingSubtotal ?? sumBudgetLineItemsByKind(lineItems, "stay")
    : 0;
  const hasTravelSubtotal =
    args.breakdown?.travelSubtotal !== undefined ||
    lineItems.some((item) => item.kind === "travel");
  const travelSubtotal = hasTravelSubtotal
    ? args.breakdown?.travelSubtotal ??
      sumBudgetLineItemsByKind(lineItems, "travel")
    : 0;
  const hasNightlyAverage = args.breakdown?.nightlyAverage !== undefined;
  const nightlyAverage = hasNightlyAverage ? args.breakdown?.nightlyAverage ?? 0 : 0;
  const totalTripCost = args.breakdown?.totalTripCost ?? args.estimatedCost;
  const budgetGap = args.requestedBudget.max - totalTripCost;

  return {
    currency: args.requestedBudget.currency ?? "INR",
    travellerLabel: formatTravellerParty(args.travellers),
    lineItems,
    hasStaySubtotal,
    lodgingSubtotal,
    hasTravelSubtotal,
    travelSubtotal,
    hasAttractionSubtotal,
    attractionSubtotal,
    verifiedAttractionCostsCount,
    estimatedAttractionCostsCount,
    unknownAttractionCostsCount,
    hasUnknownAttractionCosts: unknownAttractionCostsCount > 0,
    hasNightlyAverage,
    nightlyAverage,
    totalTripCost,
    hasDetailedBreakdown:
      hasStaySubtotal ||
      hasTravelSubtotal ||
      hasAttractionSubtotal ||
      hasNightlyAverage ||
      verifiedAttractionCostsCount > 0 ||
      estimatedAttractionCostsCount > 0 ||
      unknownAttractionCostsCount > 0,
    recommendedBudget: args.breakdown?.recommendedBudget,
    budgetGap,
    budgetGapLabel: budgetGap >= 0 ? "Budget buffer" : "Over budget",
    biggestDrivers: topBudgetDrivers(lineItems, 3),
  };
}

export function describeBudgetBreakdown(
  state: Pick<
    BudgetPanelState,
    | "hasDetailedBreakdown"
    | "hasTravelSubtotal"
    | "travelSubtotal"
    | "hasAttractionSubtotal"
    | "attractionSubtotal"
    | "verifiedAttractionCostsCount"
    | "estimatedAttractionCostsCount"
    | "unknownAttractionCostsCount"
    | "hasNightlyAverage"
    | "nightlyAverage"
  >,
  formatMoney: (value: number) => string,
): string {
  if (!state.hasDetailedBreakdown) {
    return "This saved itinerary predates the newer line-item breakdown, so the total estimate is still valid even though the detailed split is limited.";
  }

  return [
    state.hasTravelSubtotal
      ? `Travel comes to ${formatMoney(state.travelSubtotal)}.`
      : "Travel is not itemised separately in this saved itinerary.",
    state.hasAttractionSubtotal
      ? `Attraction entries contribute ${formatMoney(
          state.attractionSubtotal,
        )} (${state.verifiedAttractionCostsCount} verified, ${state.estimatedAttractionCostsCount} estimated, ${state.unknownAttractionCostsCount} unknown).`
      : state.verifiedAttractionCostsCount > 0 ||
          state.estimatedAttractionCostsCount > 0 ||
          state.unknownAttractionCostsCount > 0
        ? `Attraction entries include ${state.verifiedAttractionCostsCount} verified, ${state.estimatedAttractionCostsCount} estimated, and ${state.unknownAttractionCostsCount} unknown costs.`
        : "Attraction entry costs are not itemised separately in this saved itinerary.",
    state.hasNightlyAverage
      ? `The average nightly room allocation comes to ${formatMoney(
          state.nightlyAverage,
        )}.`
      : "Night-by-night room averages are not available for this saved itinerary yet.",
  ].join(" ");
}

export function formatBudgetDriverLabel(driver: BudgetDriver): string {
  if (driver.kind === "stay" && driver.occurrences > 1) {
    return `${driver.label} (${driver.occurrences} days)`;
  }
  if (driver.kind === "travel" && driver.occurrences > 1) {
    return `${driver.label} (${driver.occurrences} legs)`;
  }
  if (driver.kind === "attraction" && driver.occurrences > 1) {
    return `${driver.label} (${driver.occurrences} visits)`;
  }
  return driver.label;
}

export function formatBudgetDriverMeta(driver: BudgetDriver): string {
  if (driver.kind === "stay") {
    return driver.occurrences > 1
      ? "Accommodation across repeated nights"
      : "Accommodation for this stop";
  }
  if (driver.kind === "attraction") {
    return driver.occurrences > 1
      ? "Admission fees across repeated visits"
      : "Admission fee for this attraction";
  }
  return driver.occurrences > 1
    ? "Repeated transport legs in this itinerary"
    : "Transport between destinations";
}

export function sumBudgetLineItemsByKind(
  lineItems: ItineraryBudgetLineItem[],
  kind: ItineraryBudgetLineItem["kind"],
): number {
  return lineItems
    .filter((item) => item.kind === kind)
    .reduce((sum, item) => sum + item.amount, 0);
}

function normaliseCount(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(Number(value))) : fallback;
}

function deriveAttractionConfidenceCounts(
  attractionLineItems: ItineraryBudgetLineItem[],
): { verified: number; estimated: number } {
  let verified = 0;
  let estimated = 0;
  for (const item of attractionLineItems) {
    const confidence = item.provenance?.confidence;
    if (confidence === "estimated") {
      estimated += 1;
      continue;
    }
    if (
      confidence === "verified" ||
      confidence === "live" ||
      confidence === "cached"
    ) {
      verified += 1;
      continue;
    }
    if (
      confidence === undefined &&
      item.label.toLowerCase().includes("estimated")
    ) {
      estimated += 1;
    } else {
      verified += 1;
    }
  }
  return { verified, estimated };
}
