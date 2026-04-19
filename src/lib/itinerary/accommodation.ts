import type {
  Accommodation,
  AccommodationPreference,
  BudgetRange,
  ItineraryDay,
  PreferenceTag,
  StayAssignment,
  TravellerComposition,
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
} from "@/lib/itinerary/accommodationScoring";
import { formatTravellerParty } from "@/lib/itinerary/presentation";
import { selectOptimalRoomAllocation } from "@/lib/itinerary/roomAllocation";
import { deriveStayBlocks, totalStayNights } from "@/lib/itinerary/stayBlocks";

export interface AccommodationPlanningDependencies {
  getByNode: (nodeId: string) => Promise<Accommodation[]>;
}

export interface AccommodationPlanningInput {
  days: ItineraryDay[];
  budget: BudgetRange;
  travellers: TravellerComposition;
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
      const feasibleMatches = baseMatches
        .map((accommodation) => {
          const roomAllocation = selectOptimalRoomAllocation({
            accommodation,
            travellers: input.travellers,
            nights: block.nights,
          });
          if (!roomAllocation) return null;
          const nightlyCost = roomAllocation.rooms.reduce(
            (sum, room) => sum + room.nightlyCost,
            0,
          );
          return {
            accommodation,
            roomAllocation,
            nightlyCost: roundCurrency(nightlyCost),
          };
        })
        .filter(
          (
            match,
          ): match is {
            accommodation: Accommodation;
            roomAllocation: NonNullable<StayAssignment["roomAllocation"]>;
            nightlyCost: number;
          } => Boolean(match),
        );
      const inBudgetMatches = feasibleMatches.filter(
        (match) => match.nightlyCost <= nightlyBudget.max,
      );

      const selectionPool =
        inBudgetMatches.length > 0 ? inBudgetMatches : feasibleMatches;

      if (selectionPool.length === 0) {
        if (baseMatches.length > 0 && feasibleMatches.length === 0) {
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
            warning: `No room configuration in ${block.nodeName} could fit ${formatTravellerParty(input.travellers)}.`,
          };
        }
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

      // Lowest feasible room-allocation cost wins. Existing accommodation scoring
      // only acts as a deterministic tie-breaker when two properties land at the
      // same nightly total for the traveller party.
      const ranked = [...selectionPool].sort((left, right) => {
        const nightlyDiff = left.nightlyCost - right.nightlyCost;
        if (Math.abs(nightlyDiff) > 1e-9) return nightlyDiff;

        const leftScore = scoreAccommodation(left.accommodation, {
          travelStyle: input.travelStyle,
          accommodationPreference,
          nightlyBudget,
          interests: input.interests,
          effectiveNightlyCost: left.nightlyCost,
        }).score;
        const rightScore = scoreAccommodation(right.accommodation, {
          travelStyle: input.travelStyle,
          accommodationPreference,
          nightlyBudget,
          interests: input.interests,
          effectiveNightlyCost: right.nightlyCost,
        }).score;
        const scoreDiff = rightScore - leftScore;
        if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;

        return left.accommodation.id.localeCompare(right.accommodation.id);
      });
      const best = ranked[0];

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
          accommodationId: best.accommodation.id,
          nightlyCost: best.nightlyCost,
          totalCost: roundCurrency(best.nightlyCost * block.nights),
          roomAllocation: best.roomAllocation,
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

