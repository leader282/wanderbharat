import type {
  AccommodationPreference,
  BudgetRange,
  Itinerary,
  ItineraryBudgetBreakdown,
  ItineraryPreferences,
  StayAssignment,
} from "@/types/domain";
import { DEFAULT_CURRENCY } from "@/types/domain";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { deriveOptimalBudget } from "@/lib/itinerary/budget";
import {
  DEFAULT_TRAVELLERS,
  normaliseTravellers,
} from "@/lib/itinerary/planningLimits";

function db() {
  return getAdminDb();
}

type StoredItinerary = Partial<Itinerary> & {
  preferences?: Partial<ItineraryPreferences> & {
    accommodationPreference?: AccommodationPreference;
    budget?: Partial<BudgetRange>;
  };
  budget_breakdown?: Partial<ItineraryBudgetBreakdown>;
};

export async function saveItinerary(itinerary: Itinerary): Promise<void> {
  await withFirestoreDiagnostics("saveItinerary", async () => {
    await db()
      .collection(COLLECTIONS.itineraries)
      .doc(itinerary.id)
      .set(stripUndefinedDeep(itinerary));
  });
}

export async function getItinerary(id: string): Promise<Itinerary | null> {
  const snap = await db().collection(COLLECTIONS.itineraries).doc(id).get();
  return snap.exists ? normaliseStoredItinerary(snap.data() as Itinerary) : null;
}

export async function deleteItinerary(id: string): Promise<void> {
  await withFirestoreDiagnostics("deleteItinerary", async () => {
    await db().collection(COLLECTIONS.itineraries).doc(id).delete();
  });
}

export async function listItinerariesForUser(
  userId: string,
  limit = 50,
): Promise<Itinerary[]> {
  const snap = await db()
    .collection(COLLECTIONS.itineraries)
    .where("user_id", "==", userId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => normaliseStoredItinerary(d.data() as Itinerary));
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      const cleaned = stripUndefinedDeep(nested);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out as T;
  }

  return value;
}

export function normaliseStoredItinerary(itinerary: StoredItinerary): Itinerary {
  const day_plan = Array.isArray(itinerary.day_plan) ? itinerary.day_plan : [];
  const stays = Array.isArray(itinerary.stays) ? itinerary.stays : [];
  const estimated_cost = normaliseCostAmount(itinerary.estimated_cost, 0);
  const rawPreferences = (itinerary.preferences ?? {}) as NonNullable<
    StoredItinerary["preferences"]
  >;
  const {
    accommodationPreference: legacyAccommodationPreference,
    ...preferences
  } = rawPreferences;
  const budget = normaliseBudgetRange(rawPreferences.budget, estimated_cost);
  const warnings = normaliseStringList(itinerary.warnings);
  const budget_breakdown = normaliseBudgetBreakdown(itinerary.budget_breakdown, {
    budget,
    estimated_cost,
    stays,
    warnings,
  });

  return {
    ...itinerary,
    nodes: normaliseNodes(itinerary.nodes, day_plan),
    day_plan,
    stays,
    estimated_cost,
    preferences: {
      ...preferences,
      budget,
      travellers: normaliseTravellers(
        rawPreferences.travellers ?? DEFAULT_TRAVELLERS,
      ),
      accommodation_preference:
        rawPreferences.accommodation_preference ??
        legacyAccommodationPreference,
    } as ItineraryPreferences,
    budget_breakdown,
    warnings: warnings.length > 0 ? warnings : undefined,
  } as Itinerary;
}

function normaliseNodes(
  nodes: Itinerary["nodes"] | undefined,
  dayPlan: Itinerary["day_plan"],
): Itinerary["nodes"] {
  if (Array.isArray(nodes) && nodes.length > 0) return nodes;
  const deduped = new Set<string>();
  for (const day of dayPlan) {
    if (!day.base_node_id || deduped.has(day.base_node_id)) continue;
    deduped.add(day.base_node_id);
  }
  return Array.from(deduped);
}

function normaliseBudgetBreakdown(
  breakdown: StoredItinerary["budget_breakdown"],
  args: {
    budget: BudgetRange;
    estimated_cost: number;
    stays: StayAssignment[];
    warnings: string[];
  },
): ItineraryBudgetBreakdown | undefined {
  const line_items = Array.isArray(breakdown?.line_items)
    ? breakdown.line_items
    : [];
  const requestedBudget = normaliseBudgetRange(
    breakdown?.requestedBudget ?? args.budget,
    args.budget.max,
    args.budget.currency,
  );
  const totalTripCost =
    breakdown?.totalTripCost !== undefined
      ? normaliseCostAmount(breakdown.totalTripCost, args.estimated_cost)
      : args.estimated_cost;
  const recommendedBudget = breakdown?.recommendedBudget
    ? normaliseBudgetRange(
        breakdown.recommendedBudget,
        totalTripCost,
        requestedBudget.currency ?? args.budget.currency,
      )
    : deriveOptimalBudget(
        totalTripCost,
        requestedBudget.currency ?? args.budget.currency,
      );
  const warnings = normaliseStringList([
    ...args.warnings,
    ...(Array.isArray(breakdown?.warnings) ? breakdown.warnings : []),
  ]);
  const lodgingSubtotal =
    breakdown?.lodgingSubtotal !== undefined
      ? normaliseCostAmount(breakdown.lodgingSubtotal, 0)
      : line_items.some((item) => item.kind === "stay") || args.stays.length > 0
        ? sumLineItems(line_items, "stay")
        : undefined;
  const travelSubtotal =
    breakdown?.travelSubtotal !== undefined
      ? normaliseCostAmount(breakdown.travelSubtotal, 0)
      : line_items.some((item) => item.kind === "travel")
        ? sumLineItems(line_items, "travel")
        : undefined;
  const attractionSubtotal =
    breakdown?.attractionSubtotal !== undefined
      ? normaliseCostAmount(breakdown.attractionSubtotal, 0)
      : line_items.some((item) => item.kind === "attraction")
        ? sumLineItems(line_items, "attraction")
        : undefined;
  const attractionLineItems = line_items.filter(
    (item) => item.kind === "attraction",
  );
  const { verified: derivedVerifiedAttractionCount, estimated: derivedEstimatedAttractionCount } =
    deriveAttractionConfidenceCounts(attractionLineItems);
  const hasAttractionCounts =
    breakdown?.verifiedAttractionCostsCount !== undefined ||
    breakdown?.estimatedAttractionCostsCount !== undefined ||
    breakdown?.unknownAttractionCostsCount !== undefined ||
    attractionLineItems.length > 0;
  const verifiedAttractionCostsCount = hasAttractionCounts
    ? normaliseOptionalCount(
        breakdown?.verifiedAttractionCostsCount,
        Math.max(0, derivedVerifiedAttractionCount),
      )
    : undefined;
  const estimatedAttractionCostsCount = hasAttractionCounts
    ? normaliseOptionalCount(
        breakdown?.estimatedAttractionCostsCount,
        Math.max(0, derivedEstimatedAttractionCount),
      )
    : undefined;
  const unknownAttractionCostsCount = hasAttractionCounts
    ? normaliseOptionalCount(breakdown?.unknownAttractionCostsCount, 0)
    : undefined;
  const nightlyAverage =
    breakdown?.nightlyAverage !== undefined
      ? normaliseCostAmount(breakdown.nightlyAverage, 0)
      : args.stays.length > 0
        ? computeNightlyAverage(args.stays)
        : undefined;

  if (
    !breakdown &&
    line_items.length === 0 &&
    warnings.length === 0 &&
    args.estimated_cost <= 0
  ) {
    return undefined;
  }

  return {
    line_items,
    lodgingSubtotal,
    travelSubtotal,
    attractionSubtotal,
    verifiedAttractionCostsCount,
    estimatedAttractionCostsCount,
    unknownAttractionCostsCount,
    nightlyAverage,
    totalTripCost,
    requestedBudget,
    recommendedBudget,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function normaliseBudgetRange(
  budget: Partial<BudgetRange> | undefined,
  fallbackMax: number,
  fallbackCurrency?: string,
): BudgetRange {
  const min = normaliseBudgetAmount(budget?.min, 0);
  const max = Math.max(
    min,
    normaliseBudgetAmount(budget?.max, Math.max(min, fallbackMax)),
  );
  const currency =
    typeof budget?.currency === "string" && budget.currency.trim()
      ? budget.currency.trim().toUpperCase()
      : (fallbackCurrency ?? DEFAULT_CURRENCY);

  return { min, max, currency };
}

function computeNightlyAverage(stays: StayAssignment[]): number {
  const totalNights = stays.reduce((sum, stay) => sum + stay.nights, 0);
  if (totalNights <= 0) return 0;
  const totalCost = stays.reduce((sum, stay) => sum + stay.totalCost, 0);
  return normaliseCostAmount(totalCost / totalNights, 0);
}

function sumLineItems(
  lineItems: NonNullable<ItineraryBudgetBreakdown["line_items"]>,
  kind: "stay" | "travel" | "attraction",
): number {
  return normaliseCostAmount(
    lineItems
      .filter((item) => item.kind === kind)
      .reduce((sum, item) => sum + item.amount, 0),
    0,
  );
}

function deriveAttractionConfidenceCounts(
  attractionLineItems: NonNullable<ItineraryBudgetBreakdown["line_items"]>,
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

function normaliseOptionalCount(
  value: unknown,
  fallback: number | undefined,
): number | undefined {
  if (Number.isFinite(value)) {
    return Math.max(0, Math.round(Number(value)));
  }
  if (fallback === undefined) return undefined;
  return Math.max(0, Math.round(fallback));
}

function normaliseBudgetAmount(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(Number(value))) : fallback;
}

function normaliseCostAmount(value: unknown, fallback: number): number {
  return Number.isFinite(value)
    ? Number(Math.max(0, Number(value)).toFixed(2))
    : fallback;
}

function normaliseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
}
