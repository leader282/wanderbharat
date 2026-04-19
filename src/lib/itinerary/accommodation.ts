import type {
  Accommodation,
  AccommodationPreference,
  BudgetRange,
  ItineraryDay,
  PreferenceTag,
  StayAssignment,
  TravelStyle,
} from "@/types/domain";
import {
  defaultAccommodationRatingThreshold,
  deriveAllowedAccommodationCategories,
  deriveNightlyBudgetRange,
  filterAccommodationsForStay,
} from "@/lib/itinerary/accommodationConstraints";
import {
  scoreAccommodation,
  sortScoredAccommodations,
} from "@/lib/itinerary/accommodationScoring";
import { deriveStayBlocks, totalStayNights } from "@/lib/itinerary/stayBlocks";

export interface AccommodationPlanningDependencies {
  getByNode: (nodeId: string) => Promise<Accommodation[]>;
}

export interface AccommodationPlanningInput {
  days: ItineraryDay[];
  budget: BudgetRange;
  travelStyle: TravelStyle;
  accommodationPreference?: AccommodationPreference;
  interests?: PreferenceTag[];
}

export interface AccommodationPlanResult {
  stays: StayAssignment[];
  warnings: string[];
}

export async function planAccommodations(
  input: AccommodationPlanningInput,
  deps: AccommodationPlanningDependencies,
): Promise<AccommodationPlanResult> {
  const stayBlocks = deriveStayBlocks(input.days);
  if (stayBlocks.length === 0) {
    return { stays: [], warnings: [] };
  }

  const accommodationPreference = input.accommodationPreference ?? "auto";
  const allowedCategories = deriveAllowedAccommodationCategories({
    travelStyle: input.travelStyle,
    accommodationPreference,
  });
  const nightlyBudget = deriveNightlyBudgetRange({
    budget: input.budget,
    totalNights: totalStayNights(stayBlocks),
    travelStyle: input.travelStyle,
    accommodationPreference,
  });
  const minRating = defaultAccommodationRatingThreshold(accommodationPreference);

  const planned = await Promise.all(
    stayBlocks.map(async (block) => {
      const allForNode = await deps.getByNode(block.nodeId);
      const baseMatches = filterAccommodationsForStay(allForNode, {
        nodeId: block.nodeId,
        activeOnly: true,
        allowedCategories,
        minRating,
      });
      const inBudgetMatches = filterAccommodationsForStay(baseMatches, {
        nodeId: block.nodeId,
        activeOnly: true,
        allowedCategories,
        nightlyBudget,
        minRating,
      });

      const selectionPool =
        inBudgetMatches.length > 0 ? inBudgetMatches : baseMatches;

      if (selectionPool.length === 0) {
        return {
          stay: {
            nodeId: block.nodeId,
            startDay: block.startDay,
            endDay: block.endDay,
            nights: block.nights,
            accommodationId: null,
            nightlyCost: 0,
            totalCost: 0,
          },
          warning: `No active accommodations matched the travel-style filters for ${block.nodeName}.`,
        };
      }

      const scored = sortScoredAccommodations(
        selectionPool.map((accommodation) =>
          scoreAccommodation(accommodation, {
            travelStyle: input.travelStyle,
            accommodationPreference,
            nightlyBudget,
            interests: input.interests,
          }),
        ),
      );
      const best = scored[0]?.accommodation;

      if (!best) {
        return {
          stay: {
            nodeId: block.nodeId,
            startDay: block.startDay,
            endDay: block.endDay,
            nights: block.nights,
            accommodationId: null,
            nightlyCost: 0,
            totalCost: 0,
          },
          warning: `No active accommodations were available for ${block.nodeName}.`,
        };
      }

      const warning =
        inBudgetMatches.length === 0
          ? `Only over-budget accommodations were available in ${block.nodeName}; selected the best deterministic fallback.`
          : null;

      return {
        stay: {
          nodeId: block.nodeId,
          startDay: block.startDay,
          endDay: block.endDay,
          nights: block.nights,
          accommodationId: best.id,
          nightlyCost: roundCurrency(best.pricePerNight),
          totalCost: roundCurrency(best.pricePerNight * block.nights),
        },
        warning,
      };
    }),
  );

  return {
    stays: planned.map((entry) => entry.stay),
    warnings: dedupeWarnings(
      planned
        .map((entry) => entry.warning)
        .filter((warning): warning is string => Boolean(warning)),
    ),
  };
}

function dedupeWarnings(warnings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const warning of warnings) {
    if (seen.has(warning)) continue;
    seen.add(warning);
    out.push(warning);
  }

  return out;
}

function roundCurrency(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}
