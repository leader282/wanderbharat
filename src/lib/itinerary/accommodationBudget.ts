import type {
  BudgetRange,
  Itinerary,
  ItineraryBudgetBreakdown,
  ItineraryBudgetLineItem,
  StayAssignment,
} from "@/types/domain";
import { deriveOptimalBudget } from "@/lib/itinerary/budget";

export function computeLodgingSubtotal(stays: StayAssignment[]): number {
  return roundCurrency(
    stays.reduce((sum, stay) => {
      if (!isFiniteAmount(stay.totalCost)) return sum;
      return sum + stay.totalCost;
    }, 0),
  );
}

export function computeNightlyAverage(stays: StayAssignment[]): number {
  const knownStays = stays.filter((stay) => isFiniteAmount(stay.totalCost));
  const totalNights = knownStays.reduce((sum, stay) => sum + stay.nights, 0);
  if (totalNights <= 0) return 0;
  return roundCurrency(computeLodgingSubtotal(knownStays) / totalNights);
}

export function integrateAccommodationPlanIntoItinerary(args: {
  itinerary: Itinerary;
  stays: StayAssignment[];
  warnings?: string[];
  requestedBudget?: BudgetRange;
}): Itinerary {
  const stays = args.stays.map(normaliseStayAssignment);
  const existingLineItems = args.itinerary.budget_breakdown?.line_items ?? [];
  const travelLineItems = existingLineItems.filter((item) => item.kind === "travel");
  const attractionLineItems = existingLineItems.filter(
    (item) => item.kind === "attraction",
  );
  const stayLineItems = buildStayBudgetLineItems(
    stays,
    buildCityNameMap(args.itinerary),
  );
  const lodgingRateSummary = deriveLodgingRateSummary(stays);

  const lodgingSubtotal = computeLodgingSubtotal(stays);
  const travelSubtotal = roundCurrency(
    travelLineItems.reduce((sum, item) => sum + item.amount, 0),
  );
  const hasAttractionSubtotal =
    args.itinerary.budget_breakdown?.attractionSubtotal !== undefined ||
    attractionLineItems.length > 0;
  const attractionSubtotal = hasAttractionSubtotal
    ? roundCurrency(
        args.itinerary.budget_breakdown?.attractionSubtotal ??
          attractionLineItems.reduce((sum, item) => sum + item.amount, 0),
      )
    : undefined;
  const attractionCounts = deriveAttractionCostCounts(
    args.itinerary.budget_breakdown,
    attractionLineItems,
  );
  const totalTripCost = roundCurrency(
    lodgingSubtotal + travelSubtotal + (attractionSubtotal ?? 0),
  );
  const nightlyAverage = computeNightlyAverage(stays);
  // Itinerary-level warnings are the single source of truth: engine warnings
  // (opening hours, closed days, ...) merged with accommodation warnings.
  // We deliberately do NOT mirror them onto `budget_breakdown.warnings`
  // anymore so the UI can surface them in a dedicated notices banner instead
  // of mislabeling them as accommodation notes.
  const warnings = dedupeWarnings([
    ...(args.itinerary.warnings ?? []),
    ...(args.warnings ?? []),
  ]);
  const requestedBudget = args.requestedBudget ?? args.itinerary.preferences.budget;
  const currency = requestedBudget.currency ?? args.itinerary.preferences.budget.currency;
  const derivedBudget = deriveOptimalBudget(totalTripCost, currency);
  const budgetBreakdown: ItineraryBudgetBreakdown = {
    line_items: sortBudgetLineItems([
      ...stayLineItems,
      ...travelLineItems,
      ...attractionLineItems,
    ]),
    lodgingSubtotal,
    lodgingRateState: lodgingRateSummary.state,
    lodgingLastCheckedAt: lodgingRateSummary.lastCheckedAt,
    unknownLodgingStaysCount: lodgingRateSummary.unknownStaysCount,
    travelSubtotal,
    attractionSubtotal,
    verifiedAttractionCostsCount: attractionCounts.verified,
    estimatedAttractionCostsCount: attractionCounts.estimated,
    unknownAttractionCostsCount: attractionCounts.unknown,
    nightlyAverage,
    totalTripCost,
    requestedBudget,
    recommendedBudget: derivedBudget,
  };

  return {
    ...args.itinerary,
    stays,
    estimated_cost: Math.round(totalTripCost),
    budget_breakdown: budgetBreakdown,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function normaliseStayAssignment(stay: StayAssignment): StayAssignment {
  const hasSelectedRate = Boolean(resolveSelectedHotelRateOption(stay));
  if (
    stay.accommodationId === null &&
    !hasSelectedRate &&
    stay.nightlyCost === 0 &&
    stay.totalCost === 0
  ) {
    return {
      ...stay,
      nightlyCost: null,
      totalCost: null,
      hotelRateStatus: stay.hotelRateStatus ?? "unknown",
      hotelRateUnavailableReason: stay.hotelRateUnavailableReason ?? "no_rates",
    };
  }

  return stay;
}

function buildStayBudgetLineItems(
  stays: StayAssignment[],
  cityNamesById: Map<string, string>,
): ItineraryBudgetLineItem[] {
  return stays
    .filter((stay) => isFiniteAmount(stay.totalCost) && stay.totalCost > 0)
    .map((stay) => {
      const cityName = cityNamesById.get(stay.nodeId) ?? stay.nodeId;
      const selectedRateOption = resolveSelectedHotelRateOption(stay);
      return {
        id: `stay_${stay.startDay}_${stay.nodeId}_${stay.accommodationId ?? "unassigned"}`,
        day_index: stay.startDay,
        kind: "stay" as const,
        label: `Stay in ${cityName}`,
        amount: roundCurrency(stay.totalCost!),
        provenance:
          selectedRateOption &&
          (selectedRateOption.confidence === "live" ||
            selectedRateOption.confidence === "cached")
            ? {
                source_type: selectedRateOption.source_type,
                confidence: selectedRateOption.confidence,
                rule_id: selectedRateOption.offer_snapshot_id ?? undefined,
                currency: selectedRateOption.currency,
                fetched_at: selectedRateOption.fetched_at ?? null,
              }
            : undefined,
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

function deriveAttractionCostCounts(
  breakdown: Itinerary["budget_breakdown"] | undefined,
  attractionLineItems: ItineraryBudgetLineItem[],
): {
  verified: number | undefined;
  estimated: number | undefined;
  unknown: number | undefined;
} {
  const hasStoredCounts =
    breakdown?.verifiedAttractionCostsCount !== undefined ||
    breakdown?.estimatedAttractionCostsCount !== undefined ||
    breakdown?.unknownAttractionCostsCount !== undefined;
  if (hasStoredCounts) {
    return {
      verified: normaliseNonNegativeInteger(
        breakdown?.verifiedAttractionCostsCount,
      ),
      estimated: normaliseNonNegativeInteger(
        breakdown?.estimatedAttractionCostsCount,
      ),
      unknown: normaliseNonNegativeInteger(
        breakdown?.unknownAttractionCostsCount,
      ),
    };
  }

  if (attractionLineItems.length === 0) {
    return {
      verified: undefined,
      estimated: undefined,
      unknown: undefined,
    };
  }

  // Prefer structured provenance over label scraping. Fall back to label
  // matching only for legacy itineraries persisted before provenance was
  // added — the substring is stable but should never be the source of truth
  // for new data.
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
    // Legacy fallback: scrape the label only when no provenance is present.
    if (
      confidence === undefined &&
      item.label.toLowerCase().includes("estimated")
    ) {
      estimated += 1;
    } else {
      verified += 1;
    }
  }
  return {
    verified,
    estimated,
    unknown: 0,
  };
}

function normaliseNonNegativeInteger(value: unknown): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(Number(value)));
}

function deriveLodgingRateSummary(stays: StayAssignment[]): {
  state: ItineraryBudgetBreakdown["lodgingRateState"];
  lastCheckedAt: number | null;
  unknownStaysCount: number;
} {
  if (stays.length === 0) {
    return {
      state: "lodging_unknown",
      lastCheckedAt: null,
      unknownStaysCount: 0,
    };
  }

  let knownRatesCount = 0;
  let hasLive = false;
  let hasCached = false;
  let unknownStaysCount = 0;
  let lastCheckedAt = 0;

  for (const stay of stays) {
    if (stay.hotelRateStatus === "live") {
      hasLive = true;
      knownRatesCount += 1;
    } else if (stay.hotelRateStatus === "cached") {
      hasCached = true;
      knownRatesCount += 1;
    } else {
      unknownStaysCount += 1;
    }

    if (
      Number.isFinite(stay.hotelRateLastCheckedAt) &&
      Number(stay.hotelRateLastCheckedAt) > lastCheckedAt
    ) {
      lastCheckedAt = Number(stay.hotelRateLastCheckedAt);
    }
  }

  if (knownRatesCount === 0 || unknownStaysCount > 0) {
    return {
      state: "lodging_unknown",
      lastCheckedAt: lastCheckedAt > 0 ? lastCheckedAt : null,
      unknownStaysCount,
    };
  }

  return {
    state: hasLive ? "lodging_live" : hasCached ? "lodging_cached" : "lodging_unknown",
    lastCheckedAt: lastCheckedAt > 0 ? lastCheckedAt : null,
    unknownStaysCount: 0,
  };
}

function resolveSelectedHotelRateOption(stay: StayAssignment) {
  const options = stay.hotelRateOptions ?? [];
  if (options.length === 0) return null;
  const requestedIndex = stay.selectedHotelRateOptionIndex ?? 0;
  const safeIndex = Math.max(0, Math.min(requestedIndex, options.length - 1));
  return options[safeIndex] ?? null;
}

function isFiniteAmount(value: number | null | undefined): value is number {
  return Number.isFinite(value);
}
