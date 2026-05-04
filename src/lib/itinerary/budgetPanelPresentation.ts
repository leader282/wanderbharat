import {
  topBudgetDrivers,
  type BudgetDriver,
} from "@/lib/itinerary/budget";
import { formatTravellerParty } from "@/lib/itinerary/presentation";
import type {
  BudgetRange,
  DataConfidence,
  ItineraryBudgetBreakdown,
  ItineraryBudgetLineItem,
  TravellerComposition,
} from "@/types/domain";

const EMPTY_LINE_ITEMS: ItineraryBudgetLineItem[] = [];
const FOOD_ESTIMATE_PER_TRAVELLER_PER_DAY = 500;
const LOCAL_TRANSPORT_ESTIMATE_PER_TRAVELLER_PER_DAY = 180;
const CHILD_ESTIMATE_WEIGHT = 0.7;

export type BudgetDataState = DataConfidence;

export interface BudgetPanelState {
  currency: string;
  travellerLabel: string;
  tripDays: number;
  lineItems: ItineraryBudgetLineItem[];
  hasStaySubtotal: boolean;
  lodgingSubtotal: number;
  lodgingRateState: ItineraryBudgetBreakdown["lodgingRateState"];
  hotelsDataState: BudgetDataState;
  lodgingLastCheckedAt: number | null;
  unknownLodgingStaysCount: number;
  hasUnknownLodgingCosts: boolean;
  hasTravelSubtotal: boolean;
  travelSubtotal: number;
  travelDataState: BudgetDataState;
  travelConfidenceCounts: Partial<Record<BudgetDataState, number>>;
  hasAttractionSubtotal: boolean;
  attractionSubtotal: number;
  attractionsDataState: BudgetDataState;
  verifiedAttractionCostsCount: number;
  estimatedAttractionCostsCount: number;
  unknownAttractionCostsCount: number;
  hasUnknownAttractionCosts: boolean;
  foodEstimate: number;
  localTransportEstimate: number;
  estimatedComponentTotal: number;
  unknownCostExclusionsCount: number;
  showCostRange: boolean;
  totalCostFloor: number;
  totalCostCeiling: number;
  foodDataState: BudgetDataState;
  localTransportDataState: BudgetDataState;
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
  tripDays?: number;
  breakdown?: ItineraryBudgetBreakdown;
}): BudgetPanelState {
  const lineItems = args.breakdown?.line_items ?? EMPTY_LINE_ITEMS;
  const tripDays = deriveTripDays(args.tripDays, lineItems);
  const attractionLineItems = lineItems.filter((item) => item.kind === "attraction");
  const travelLineItems = lineItems.filter((item) => item.kind === "travel");
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
  const lodgingRateState = args.breakdown?.lodgingRateState ?? "lodging_unknown";
  const hotelsDataState = lodgingRateStateToDataState(lodgingRateState);
  const lodgingLastCheckedAt =
    Number.isFinite(args.breakdown?.lodgingLastCheckedAt) &&
    Number(args.breakdown?.lodgingLastCheckedAt) > 0
      ? Math.round(Number(args.breakdown?.lodgingLastCheckedAt))
      : null;
  const unknownLodgingStaysCount = normaliseCount(
    args.breakdown?.unknownLodgingStaysCount,
    lodgingRateState === "lodging_unknown" && hasStaySubtotal ? 1 : 0,
  );
  const hasUnknownLodgingCosts = unknownLodgingStaysCount > 0;
  const hasTravelSubtotal =
    args.breakdown?.travelSubtotal !== undefined ||
    lineItems.some((item) => item.kind === "travel");
  const travelSubtotal = hasTravelSubtotal
    ? args.breakdown?.travelSubtotal ??
      sumBudgetLineItemsByKind(lineItems, "travel")
    : 0;
  const travelConfidenceCounts = deriveTravelConfidenceCounts(travelLineItems);
  const travelDataState = deriveDominantDataState(travelConfidenceCounts, {
    hasData: hasTravelSubtotal,
    fallback: hasTravelSubtotal ? "estimated" : "unknown",
  });
  const attractionsDataState = deriveAttractionsDataState({
    verifiedCount: verifiedAttractionCostsCount,
    estimatedCount: estimatedAttractionCostsCount,
    unknownCount: unknownAttractionCostsCount,
  });
  const estimatedAttractionSubtotal = roundCurrency(
    attractionLineItems.reduce((sum, item) => {
      const confidence = resolveBudgetLineItemConfidence(item);
      return confidence === "estimated" ? sum + item.amount : sum;
    }, 0),
  );
  const estimatedTravelSubtotal = roundCurrency(
    travelLineItems.reduce((sum, item) => {
      const confidence = resolveBudgetLineItemConfidence(item);
      return confidence === "estimated" ? sum + item.amount : sum;
    }, 0),
  );
  const travellerUnits =
    Math.max(0, args.travellers.adults) +
    Math.max(0, args.travellers.children) * CHILD_ESTIMATE_WEIGHT;
  const foodEstimate = roundCurrency(
    tripDays * travellerUnits * FOOD_ESTIMATE_PER_TRAVELLER_PER_DAY,
  );
  const localTransportEstimate = roundCurrency(
    tripDays * travellerUnits * LOCAL_TRANSPORT_ESTIMATE_PER_TRAVELLER_PER_DAY,
  );
  const estimatedComponentTotal = roundCurrency(
    estimatedAttractionSubtotal +
      estimatedTravelSubtotal +
      foodEstimate +
      localTransportEstimate,
  );
  const unknownCostExclusionsCount =
    unknownLodgingStaysCount + unknownAttractionCostsCount;
  const showCostRange =
    estimatedComponentTotal > 0 || unknownCostExclusionsCount > 0;
  const hasNightlyAverage = args.breakdown?.nightlyAverage !== undefined;
  const nightlyAverage = hasNightlyAverage ? args.breakdown?.nightlyAverage ?? 0 : 0;
  const totalTripCost = args.breakdown?.totalTripCost ?? args.estimatedCost;
  const totalCostFloor = totalTripCost;
  const totalCostCeiling = showCostRange
    ? roundCurrency(totalTripCost + estimatedComponentTotal)
    : totalTripCost;
  const budgetGap = args.requestedBudget.max - totalCostCeiling;

  return {
    currency: args.requestedBudget.currency ?? "INR",
    travellerLabel: formatTravellerParty(args.travellers),
    tripDays,
    lineItems,
    hasStaySubtotal,
    lodgingSubtotal,
    lodgingRateState,
    hotelsDataState,
    lodgingLastCheckedAt,
    unknownLodgingStaysCount,
    hasUnknownLodgingCosts,
    hasTravelSubtotal,
    travelSubtotal,
    travelDataState,
    travelConfidenceCounts,
    hasAttractionSubtotal,
    attractionSubtotal,
    attractionsDataState,
    verifiedAttractionCostsCount,
    estimatedAttractionCostsCount,
    unknownAttractionCostsCount,
    hasUnknownAttractionCosts: unknownAttractionCostsCount > 0,
    foodEstimate,
    localTransportEstimate,
    estimatedComponentTotal,
    unknownCostExclusionsCount,
    showCostRange,
    totalCostFloor,
    totalCostCeiling,
    foodDataState: "estimated",
    localTransportDataState: "estimated",
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
    | "lodgingRateState"
    | "unknownLodgingStaysCount"
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

  const lodgingSentence =
    state.lodgingRateState === "lodging_live"
      ? "Hotel rates are live for this itinerary."
      : state.lodgingRateState === "lodging_cached"
        ? "Hotel rates are cached from a recent snapshot."
        : state.unknownLodgingStaysCount > 0
          ? `Hotel rates are unavailable for ${state.unknownLodgingStaysCount} stay ${state.unknownLodgingStaysCount === 1 ? "block" : "blocks"}.`
          : "Hotel rates are currently unavailable.";

  return [
    lodgingSentence,
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

function roundCurrency(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}

function deriveAttractionConfidenceCounts(
  attractionLineItems: ItineraryBudgetLineItem[],
): { verified: number; estimated: number } {
  let verified = 0;
  let estimated = 0;
  for (const item of attractionLineItems) {
    const confidence = resolveBudgetLineItemConfidence(item);
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
    verified += 1;
  }
  return { verified, estimated };
}

function resolveBudgetLineItemConfidence(
  item: ItineraryBudgetLineItem,
): BudgetDataState | undefined {
  const confidence = item.provenance?.confidence;
  if (
    confidence === "live" ||
    confidence === "verified" ||
    confidence === "cached" ||
    confidence === "estimated" ||
    confidence === "unknown"
  ) {
    return confidence;
  }
  if (item.label.toLowerCase().includes("estimated")) {
    return "estimated";
  }
  return undefined;
}

function deriveTravelConfidenceCounts(
  travelLineItems: ItineraryBudgetLineItem[],
): Partial<Record<BudgetDataState, number>> {
  const counts: Partial<Record<BudgetDataState, number>> = {};
  for (const item of travelLineItems) {
    const confidence = resolveBudgetLineItemConfidence(item) ?? "estimated";
    counts[confidence] = (counts[confidence] ?? 0) + 1;
  }
  return counts;
}

function deriveDominantDataState(
  counts: Partial<Record<BudgetDataState, number>>,
  args: { hasData: boolean; fallback: BudgetDataState },
): BudgetDataState {
  if (!args.hasData) return "unknown";
  if ((counts.unknown ?? 0) > 0) return "unknown";
  if ((counts.estimated ?? 0) > 0) return "estimated";
  if ((counts.cached ?? 0) > 0) return "cached";
  if ((counts.verified ?? 0) > 0) return "verified";
  if ((counts.live ?? 0) > 0) return "live";
  return args.fallback;
}

function deriveAttractionsDataState(args: {
  verifiedCount: number;
  estimatedCount: number;
  unknownCount: number;
}): BudgetDataState {
  if (args.unknownCount > 0) return "unknown";
  if (args.estimatedCount > 0) return "estimated";
  if (args.verifiedCount > 0) return "verified";
  return "unknown";
}

function lodgingRateStateToDataState(
  value: ItineraryBudgetBreakdown["lodgingRateState"],
): BudgetDataState {
  if (value === "lodging_live") return "live";
  if (value === "lodging_cached") return "cached";
  return "unknown";
}

function deriveTripDays(
  tripDays: number | undefined,
  lineItems: ItineraryBudgetLineItem[],
): number {
  if (Number.isFinite(tripDays) && Number(tripDays) > 0) {
    return Math.round(Number(tripDays));
  }
  const maxDayIndex = lineItems.reduce(
    (max, item) => Math.max(max, item.day_index),
    -1,
  );
  return maxDayIndex >= 0 ? maxDayIndex + 1 : 1;
}
