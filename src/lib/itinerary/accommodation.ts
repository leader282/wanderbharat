import type {
  Accommodation,
  AccommodationPreference,
  BudgetRange,
  Coordinates,
  ItineraryDay,
  LocalDateString,
  PreferenceTag,
  StayAssignment,
  StayHotelRateOption,
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
import type { HotelDataProvider } from "@/lib/providers/hotels/HotelDataProvider";
import type {
  HotelOfferSnapshot,
  HotelSearchSnapshot,
} from "@/lib/providers/hotels/types";
import {
  resolveStayHotelRatePlans,
  type StayHotelRatePlan,
} from "@/lib/services/hotelRateSnapshotService";

export interface AccommodationPlanningDependencies {
  getByNode: (nodeId: string) => Promise<Accommodation[]>;
  hotelDataProvider?: HotelDataProvider;
  findLatestHotelSearchSnapshotByQueryKey?: (
    queryKey: string,
  ) => Promise<HotelSearchSnapshot | null>;
  saveHotelSearchSnapshot?: (
    snapshot: HotelSearchSnapshot,
  ) => Promise<HotelSearchSnapshot>;
  findLatestHotelOfferSnapshotByCacheKey?: (
    cacheKey: string,
  ) => Promise<HotelOfferSnapshot | null>;
  saveHotelOfferSnapshot?: (
    snapshot: HotelOfferSnapshot,
  ) => Promise<HotelOfferSnapshot>;
  maxHotelProviderCalls?: number;
  maxHotelOptionsPerStay?: number;
  nowMs?: () => number;
}

export interface AccommodationPlanningInput {
  days: ItineraryDay[];
  budget: BudgetRange;
  travellers: TravellerComposition;
  travelStyle: TravelStyle;
  accommodationPreference?: AccommodationPreference;
  interests?: PreferenceTag[];
  tripStartDate?: LocalDateString;
  region?: string;
  cityLocationsByNodeId?: Record<string, Coordinates>;
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
  if (deps.hotelDataProvider) {
    return planWithHotelRatePlans({
      input,
      deps,
      stayBlocks,
      nightlyBudget,
    });
  }

  return planWithLegacyAccommodations({
    input,
    deps,
    stayBlocks,
    accommodationPreference,
    allowedCategories,
    nightlyBudget,
  });
}

async function planWithHotelRatePlans(args: {
  input: AccommodationPlanningInput;
  deps: AccommodationPlanningDependencies;
  stayBlocks: ReturnType<typeof deriveStayBlocks>;
  nightlyBudget: ReturnType<typeof deriveNightlyBudgetRange>;
}): Promise<AccommodationPlanResult> {
  const resolved = await resolveStayHotelRatePlans(
    {
      region: args.input.region ?? "",
      tripStartDate: args.input.tripStartDate,
      stayBlocks: args.stayBlocks,
      travellers: args.input.travellers,
      currency: args.input.budget.currency ?? "INR",
      cityLocationsByNodeId: args.input.cityLocationsByNodeId,
    },
    {
      provider: args.deps.hotelDataProvider!,
      nowMs: args.deps.nowMs,
      maxProviderCalls: args.deps.maxHotelProviderCalls,
      findLatestSearchSnapshotByQueryKey:
        args.deps.findLatestHotelSearchSnapshotByQueryKey,
      saveHotelSearchSnapshot: args.deps.saveHotelSearchSnapshot,
      findLatestOfferSnapshotByCacheKey:
        args.deps.findLatestHotelOfferSnapshotByCacheKey,
      saveHotelOfferSnapshot: args.deps.saveHotelOfferSnapshot,
    },
  );

  const plansByKey = new Map(
    resolved.plans.map((plan) => [plan.blockKey, plan] as const),
  );
  const warnings: string[] = [...resolved.warnings];
  const stays: StayAssignment[] = [];

  for (const block of args.stayBlocks) {
    const plan = plansByKey.get(buildBlockKey(block));
    if (!plan || plan.options.length === 0) {
      stays.push(
        toUnknownRateStay({
          block,
          plan,
        }),
      );
      continue;
    }

    const selected = selectTopHotelRateOptions({
      options: plan.options,
      nights: block.nights,
      nightlyBudgetMax: args.nightlyBudget.max,
      maxOptions: Math.max(1, Math.min(args.deps.maxHotelOptionsPerStay ?? 5, 5)),
    });

    if (!selected) {
      warnings.push(
        `No usable LiteAPI hotel prices were available for ${block.nodeName}.`,
      );
      stays.push(
        toUnknownRateStay({
          block,
          plan: {
            ...plan,
            unavailableReason: "no_rates",
          },
        }),
      );
      continue;
    }

    if (selected.warning) warnings.push(selected.warning);

    stays.push({
      nodeId: block.nodeId,
      startDay: block.startDay,
      endDay: block.endDay,
      nights: block.nights,
      accommodationId: null,
      nightlyCost: selected.selectedNightly,
      totalCost: selected.selectedTotal,
      hotelRateStatus: plan.status,
      hotelRateLastCheckedAt: plan.lastCheckedAt ?? null,
      hotelSearchSnapshotId: plan.searchSnapshotId ?? null,
      hotelOfferSnapshotId: plan.offerSnapshotId ?? null,
      hotelRateOptions: selected.options,
      selectedHotelRateOptionIndex: 0,
    });
  }

  return {
    stays,
    warnings: dedupeWarnings(warnings),
  };
}

async function planWithLegacyAccommodations(args: {
  input: AccommodationPlanningInput;
  deps: AccommodationPlanningDependencies;
  stayBlocks: ReturnType<typeof deriveStayBlocks>;
  accommodationPreference: AccommodationPreference;
  allowedCategories: ReturnType<typeof deriveAllowedAccommodationCategories>;
  nightlyBudget: ReturnType<typeof deriveNightlyBudgetRange>;
}): Promise<AccommodationPlanResult> {
  const minRating = defaultAccommodationRatingThreshold(
    args.accommodationPreference,
  );
  const planned = await Promise.all(
    args.stayBlocks.map(async (block) => {
      const allForNode = await args.deps.getByNode(block.nodeId);
      const baseMatches = filterAccommodationsForStay(allForNode, {
        nodeId: block.nodeId,
        activeOnly: true,
        allowedCategories: args.allowedCategories,
        minRating,
      });
      const feasibleMatches = baseMatches
        .map((accommodation) => {
          const roomAllocation = selectOptimalRoomAllocation({
            accommodation,
            travellers: args.input.travellers,
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
        (match) => match.nightlyCost <= args.nightlyBudget.max,
      );
      const selectionPool =
        inBudgetMatches.length > 0 ? inBudgetMatches : feasibleMatches;

      if (selectionPool.length === 0) {
        if (baseMatches.length > 0 && feasibleMatches.length === 0) {
          return {
            stay: toUnknownLegacyStay(block),
            warning: `No room configuration in ${block.nodeName} could fit ${formatTravellerParty(args.input.travellers)}.`,
          };
        }
        return {
          stay: toUnknownLegacyStay(block),
          warning: `No active accommodations matched the travel-style filters for ${block.nodeName}.`,
        };
      }

      const ranked = [...selectionPool].sort((left, right) => {
        const nightlyDiff = left.nightlyCost - right.nightlyCost;
        if (Math.abs(nightlyDiff) > 1e-9) return nightlyDiff;

        const leftScore = scoreAccommodation(left.accommodation, {
          travelStyle: args.input.travelStyle,
          accommodationPreference: args.accommodationPreference,
          nightlyBudget: args.nightlyBudget,
          interests: args.input.interests,
          effectiveNightlyCost: left.nightlyCost,
        }).score;
        const rightScore = scoreAccommodation(right.accommodation, {
          travelStyle: args.input.travelStyle,
          accommodationPreference: args.accommodationPreference,
          nightlyBudget: args.nightlyBudget,
          interests: args.input.interests,
          effectiveNightlyCost: right.nightlyCost,
        }).score;
        const scoreDiff = rightScore - leftScore;
        if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;

        return left.accommodation.id.localeCompare(right.accommodation.id);
      });
      const best = ranked[0];
      if (!best) {
        return {
          stay: toUnknownLegacyStay(block),
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

function toUnknownLegacyStay(
  block: ReturnType<typeof deriveStayBlocks>[number],
): StayAssignment {
  return {
    nodeId: block.nodeId,
    startDay: block.startDay,
    endDay: block.endDay,
    nights: block.nights,
    accommodationId: null,
    nightlyCost: null,
    totalCost: null,
    hotelRateStatus: "unknown",
    hotelRateUnavailableReason: "no_rates",
  };
}

function toUnknownRateStay(args: {
  block: ReturnType<typeof deriveStayBlocks>[number];
  plan?: StayHotelRatePlan;
}): StayAssignment {
  return {
    nodeId: args.block.nodeId,
    startDay: args.block.startDay,
    endDay: args.block.endDay,
    nights: args.block.nights,
    accommodationId: null,
    nightlyCost: null,
    totalCost: null,
    hotelRateStatus: "unknown",
    hotelRateUnavailableReason: args.plan?.unavailableReason ?? "no_rates",
    hotelRateLastCheckedAt: args.plan?.lastCheckedAt ?? null,
    hotelSearchSnapshotId: args.plan?.searchSnapshotId ?? null,
    hotelOfferSnapshotId: args.plan?.offerSnapshotId ?? null,
    hotelRateOptions: [],
    selectedHotelRateOptionIndex: null,
  };
}

function selectTopHotelRateOptions(args: {
  options: StayHotelRateOption[];
  nights: number;
  nightlyBudgetMax: number;
  maxOptions: number;
}): {
  options: StayHotelRateOption[];
  selectedNightly: number;
  selectedTotal: number;
  warning: string | null;
} | null {
  const priced: Array<{
    option: StayHotelRateOption;
    nightly: number;
    total: number;
  }> = [];
  for (const option of args.options) {
    const nightly = resolveNightlyAmount(option, args.nights);
    const total = resolveTotalAmount(option, args.nights);
    if (nightly === null || total === null) continue;
    priced.push({
      option: {
        ...option,
        nightly_amount: nightly,
        total_amount: total,
      },
      nightly,
      total,
    });
  }

  if (priced.length === 0) return null;

  const inBudget = priced.filter((entry) => entry.nightly <= args.nightlyBudgetMax);
  const pool = inBudget.length > 0 ? inBudget : priced;
  const topCount = Math.min(Math.max(1, args.maxOptions), pool.length);
  const topOptions = pool.slice(0, topCount);
  const selected = topOptions[0];
  if (!selected) return null;

  return {
    options: topOptions.map((entry) => entry.option),
    selectedNightly: selected.nightly,
    selectedTotal: selected.total,
    warning:
      inBudget.length === 0
        ? "Only over-budget LiteAPI hotel rates were available; selected the most affordable deterministic option."
        : null,
  };
}

function resolveNightlyAmount(
  option: StayHotelRateOption,
  nights: number,
): number | null {
  if (option.nightly_amount !== null && Number.isFinite(option.nightly_amount)) {
    return roundCurrency(option.nightly_amount);
  }
  if (option.total_amount !== null && Number.isFinite(option.total_amount)) {
    return roundCurrency(option.total_amount / Math.max(1, nights));
  }
  return null;
}

function resolveTotalAmount(
  option: StayHotelRateOption,
  nights: number,
): number | null {
  if (option.total_amount !== null && Number.isFinite(option.total_amount)) {
    return roundCurrency(option.total_amount);
  }
  const nightly = resolveNightlyAmount(option, nights);
  if (nightly === null) return null;
  return roundCurrency(nightly * Math.max(1, nights));
}

function buildBlockKey(
  block: ReturnType<typeof deriveStayBlocks>[number],
): string {
  return `${block.nodeId}:${block.startDay}:${block.endDay}`;
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

