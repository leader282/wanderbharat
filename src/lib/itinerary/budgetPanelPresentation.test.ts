import assert from "node:assert/strict";
import test from "node:test";

import {
  describeBudgetBreakdown,
  deriveBudgetPanelState,
  formatBudgetDriverLabel,
  formatBudgetDriverMeta,
  sumBudgetLineItemsByKind,
} from "@/lib/itinerary/budgetPanelPresentation";
import type {
  BudgetRange,
  ItineraryBudgetBreakdown,
  ItineraryBudgetLineItem,
  TravellerComposition,
} from "@/types/domain";

const requestedBudget: BudgetRange = {
  min: 18_000,
  max: 24_000,
  currency: "INR",
};
const travellers: TravellerComposition = { adults: 2, children: 1 };

function breakdown(
  overrides: Partial<ItineraryBudgetBreakdown> = {},
): ItineraryBudgetBreakdown {
  return {
    line_items: [],
    ...overrides,
  };
}

function lineItem(
  overrides: Partial<ItineraryBudgetLineItem> &
    Pick<ItineraryBudgetLineItem, "id" | "kind" | "label" | "amount">,
): ItineraryBudgetLineItem {
  const { id, kind, label, amount, ...rest } = overrides;
  return {
    day_index: 0,
    ...rest,
    id,
    kind,
    label,
    amount,
  };
}

test("deriveBudgetPanelState falls back to summed line items and aggregates top drivers", () => {
  const state = deriveBudgetPanelState({
    estimatedCost: 21_000,
    requestedBudget,
    travellers,
    breakdown: breakdown({
      line_items: [
        lineItem({
          id: "stay_1",
          kind: "stay",
          label: "Heritage haveli",
          amount: 5000,
        }),
        lineItem({
          id: "stay_2",
          kind: "stay",
          label: "Heritage haveli",
          amount: 5500,
          day_index: 1,
        }),
        lineItem({
          id: "travel_1",
          kind: "travel",
          label: "Road transfer",
          amount: 1800,
        }),
      ],
    }),
  });

  assert.equal(state.currency, "INR");
  assert.equal(state.travellerLabel, "2 adults + 1 child");
  assert.equal(state.lodgingSubtotal, 10_500);
  assert.equal(state.travelSubtotal, 1800);
  assert.equal(state.hasAttractionSubtotal, false);
  assert.equal(state.attractionSubtotal, 0);
  assert.equal(state.verifiedAttractionCostsCount, 0);
  assert.equal(state.estimatedAttractionCostsCount, 0);
  assert.equal(state.unknownAttractionCostsCount, 0);
  assert.equal(state.totalTripCost, 21_000);
  assert.equal(state.showCostRange, true);
  assert.equal(state.totalCostFloor, 21_000);
  assert.equal(state.totalCostCeiling, 24_672);
  assert.equal(state.hotelsDataState, "unknown");
  assert.equal(state.travelDataState, "estimated");
  assert.equal(state.foodDataState, "estimated");
  assert.equal(state.localTransportDataState, "estimated");
  assert.equal(state.budgetGap, -672);
  assert.equal(state.budgetGapLabel, "Over budget");
  assert.equal(state.hasDetailedBreakdown, true);
  assert.equal(state.biggestDrivers[0]?.label, "Heritage haveli");
  assert.equal(state.biggestDrivers[0]?.occurrences, 2);
  assert.equal(formatBudgetDriverLabel(state.biggestDrivers[0]!), "Heritage haveli (2 days)");
  assert.equal(
    formatBudgetDriverMeta(state.biggestDrivers[0]!),
    "Accommodation across repeated nights",
  );
});

test("deriveBudgetPanelState stays resilient when breakdown data is missing", () => {
  const state = deriveBudgetPanelState({
    estimatedCost: 19_500,
    requestedBudget: { ...requestedBudget, max: 18_000 },
    travellers,
  });

  assert.equal(state.hasStaySubtotal, false);
  assert.equal(state.hasTravelSubtotal, false);
  assert.equal(state.hasAttractionSubtotal, false);
  assert.equal(state.biggestDrivers.length, 0);
  assert.equal(state.showCostRange, true);
  assert.equal(state.totalCostFloor, 19_500);
  assert.equal(state.totalCostCeiling, 21_336);
  assert.equal(state.budgetGap, -3336);
  assert.equal(state.budgetGapLabel, "Over budget");
});

test("deriveBudgetPanelState surfaces attraction subtotal and confidence counters", () => {
  const state = deriveBudgetPanelState({
    estimatedCost: 22_800,
    requestedBudget,
    travellers,
    breakdown: breakdown({
      line_items: [
        lineItem({
          id: "attraction_verified",
          kind: "attraction",
          label: "Amber Fort admission",
          amount: 800,
        }),
        lineItem({
          id: "attraction_estimated",
          kind: "attraction",
          label: "Stepwell entry (estimated)",
          amount: 500,
        }),
      ],
      attractionSubtotal: 1300,
      verifiedAttractionCostsCount: 1,
      estimatedAttractionCostsCount: 1,
      unknownAttractionCostsCount: 2,
    }),
  });

  assert.equal(state.hasAttractionSubtotal, true);
  assert.equal(state.attractionSubtotal, 1300);
  assert.equal(state.verifiedAttractionCostsCount, 1);
  assert.equal(state.estimatedAttractionCostsCount, 1);
  assert.equal(state.unknownAttractionCostsCount, 2);
  assert.equal(state.hasUnknownAttractionCosts, true);
  assert.equal(state.attractionsDataState, "unknown");
  assert.equal(state.unknownCostExclusionsCount, 2);
  assert.equal(state.showCostRange, true);
  assert.equal(state.totalCostFloor, 22_800);
  assert.equal(state.totalCostCeiling, 25_136);
});

test("deriveBudgetPanelState marks hotels as live when live rates exist", () => {
  const state = deriveBudgetPanelState({
    estimatedCost: 30_000,
    requestedBudget: { ...requestedBudget, max: 45_000 },
    travellers,
    tripDays: 4,
    breakdown: breakdown({
      line_items: [
        lineItem({
          id: "stay_live",
          kind: "stay",
          label: "Stay in Jaipur",
          amount: 11_000,
          provenance: {
            confidence: "live",
          },
        }),
      ],
      lodgingSubtotal: 11_000,
      lodgingRateState: "lodging_live",
      totalTripCost: 30_000,
      unknownLodgingStaysCount: 0,
    }),
  });

  assert.equal(state.hotelsDataState, "live");
  assert.equal(state.showCostRange, true);
  assert.equal(state.foodEstimate, 5400);
  assert.equal(state.localTransportEstimate, 1944);
});

test("describeBudgetBreakdown formats detailed and legacy copy", () => {
  const formatMoney = (value: number) => `INR ${value}`;

  assert.equal(
    describeBudgetBreakdown(
      {
        hasDetailedBreakdown: true,
        lodgingRateState: "lodging_cached",
        unknownLodgingStaysCount: 0,
        hasTravelSubtotal: false,
        travelSubtotal: 0,
        hasAttractionSubtotal: false,
        attractionSubtotal: 0,
        verifiedAttractionCostsCount: 0,
        estimatedAttractionCostsCount: 0,
        unknownAttractionCostsCount: 0,
        hasNightlyAverage: true,
        nightlyAverage: 3200,
      },
      formatMoney,
    ),
    "Hotel rates are cached from a recent snapshot. Travel is not itemised separately in this saved itinerary. Attraction entry costs are not itemised separately in this saved itinerary. The average nightly room allocation comes to INR 3200.",
  );

  assert.equal(
    describeBudgetBreakdown(
      {
        hasDetailedBreakdown: false,
        lodgingRateState: "lodging_unknown",
        unknownLodgingStaysCount: 0,
        hasTravelSubtotal: false,
        travelSubtotal: 0,
        hasAttractionSubtotal: false,
        attractionSubtotal: 0,
        verifiedAttractionCostsCount: 0,
        estimatedAttractionCostsCount: 0,
        unknownAttractionCostsCount: 0,
        hasNightlyAverage: false,
        nightlyAverage: 0,
      },
      formatMoney,
    ),
    "This saved itinerary predates the newer line-item breakdown, so the total estimate is still valid even though the detailed split is limited.",
  );
});

test("sumBudgetLineItemsByKind totals matching entries and ignores the rest", () => {
  const items = [
    lineItem({ id: "stay", kind: "stay", label: "Camp", amount: 4000 }),
    lineItem({ id: "travel", kind: "travel", label: "Train", amount: 1200 }),
    lineItem({ id: "stay_2", kind: "stay", label: "Camp", amount: 4500 }),
  ];

  assert.equal(sumBudgetLineItemsByKind(items, "stay"), 8500);
  assert.equal(sumBudgetLineItemsByKind(items, "travel"), 1200);
});
