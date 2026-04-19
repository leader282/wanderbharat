"use client";

import { useMemo, useState } from "react";

import {
  assessBudgetRequest,
  topBudgetDrivers,
  type BudgetDriver,
} from "@/lib/itinerary/budget";
import {
  formatTravellerParty,
  makeMoneyFormatter,
} from "@/lib/itinerary/presentation";
import type {
  BudgetRange,
  ItineraryBudgetBreakdown,
  ItineraryBudgetLineItem,
  TravellerComposition,
} from "@/types/domain";

const EMPTY_LINE_ITEMS: ItineraryBudgetLineItem[] = [];

export default function ItineraryBudgetPanel({
  estimatedCost,
  requestedBudget,
  travellers,
  breakdown,
}: {
  estimatedCost: number;
  requestedBudget: BudgetRange;
  travellers: TravellerComposition;
  breakdown?: ItineraryBudgetBreakdown;
}) {
  const [enteredBudget, setEnteredBudget] = useState("");
  const currency = requestedBudget.currency ?? "INR";
  const formatMoney = useMemo(() => makeMoneyFormatter(currency), [currency]);
  const lineItems = breakdown?.line_items ?? EMPTY_LINE_ITEMS;
  const hasStaySubtotal =
    breakdown?.lodgingSubtotal !== undefined ||
    lineItems.some((item) => item.kind === "stay");
  const lodgingSubtotal = hasStaySubtotal
    ? breakdown?.lodgingSubtotal ?? sumByKind(lineItems, "stay")
    : 0;
  const hasTravelSubtotal =
    breakdown?.travelSubtotal !== undefined ||
    lineItems.some((item) => item.kind === "travel");
  const travelSubtotal = hasTravelSubtotal
    ? breakdown?.travelSubtotal ?? sumByKind(lineItems, "travel")
    : 0;
  const hasNightlyAverage = breakdown?.nightlyAverage !== undefined;
  const nightlyAverage = hasNightlyAverage ? breakdown?.nightlyAverage ?? 0 : 0;
  const totalTripCost = breakdown?.totalTripCost ?? estimatedCost;
  const breakdownWarnings = breakdown?.warnings ?? [];
  const hasDetailedBreakdown =
    hasStaySubtotal || hasTravelSubtotal || hasNightlyAverage;
  const recommendedBudget = breakdown?.recommendedBudget;
  const biggestDrivers = useMemo(
    () => topBudgetDrivers(lineItems, 3),
    [lineItems],
  );

  const parsedBudget =
    enteredBudget.trim() === "" ? null : Number(enteredBudget);
  const invalidBudget =
    parsedBudget !== null &&
    (!Number.isFinite(parsedBudget) || parsedBudget < 0);

  const assessment = useMemo(() => {
    if (parsedBudget === null || invalidBudget) return null;
    return assessBudgetRequest({
      requestedBudget: parsedBudget,
      estimatedCost,
      recommended: recommendedBudget ?? requestedBudget,
      lineItems,
    });
  }, [
    estimatedCost,
    invalidBudget,
    lineItems,
    parsedBudget,
    recommendedBudget,
    requestedBudget,
  ]);

  const tone = assessment ? toneFor(assessment.status) : null;
  const budgetGap = requestedBudget.max - totalTripCost;
  const travellerLabel = formatTravellerParty(travellers);

  return (
    <div className="mt-10 card p-6 md:p-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Budget</p>
          <h2 className="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
            How the total budget breaks down
          </h2>
          <p className="mt-2 max-w-2xl text-[var(--color-ink-500)]">
            We estimate this route, travel, and room plan at{" "}
            {formatMoney(totalTripCost)} total for {travellerLabel}. Your current
            total trip budget is {formatMoney(requestedBudget.max)}.
            {recommendedBudget && (
              <>
                {" "}
                For this exact route, we&apos;d usually recommend{" "}
                {formatMoney(recommendedBudget.min)} to{" "}
                {formatMoney(recommendedBudget.max)}.
              </>
            )}
          </p>
        </div>

        <span className="chip" aria-hidden>
          {travellerLabel}
        </span>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BudgetStat
          label="Total trip budget"
          value={formatMoney(requestedBudget.max)}
        />
        <BudgetStat
          label="Estimated total cost"
          value={formatMoney(totalTripCost)}
        />
        <BudgetStat
          label="Stay subtotal"
          value={hasStaySubtotal ? formatMoney(lodgingSubtotal) : "Not itemised"}
        />
        <BudgetStat
          label={budgetGap >= 0 ? "Budget buffer" : "Over budget"}
          value={formatMoney(Math.abs(budgetGap))}
        />
      </div>

      {hasDetailedBreakdown ? (
        <p className="mt-3 text-sm text-[var(--color-ink-500)]">
          {hasTravelSubtotal
            ? `Travel comes to ${formatMoney(travelSubtotal)}. `
            : "Travel is not itemised separately in this saved itinerary. "}
          {hasNightlyAverage
            ? `The average nightly room allocation comes to ${formatMoney(
                nightlyAverage,
              )}.`
            : "Night-by-night room averages are not available for this saved itinerary yet."}
        </p>
      ) : (
        <p className="mt-3 text-sm text-[var(--color-ink-500)]">
          This saved itinerary predates the newer line-item breakdown, so the
          total estimate is still valid even though the detailed split is limited.
        </p>
      )}

      {breakdownWarnings.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">
            Accommodation notes
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {breakdownWarnings.map((warning) => (
              <li key={warning}>- {warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink-700)]">
            Biggest cost drivers
          </p>
          <ul className="mt-3 space-y-2">
            {biggestDrivers.length > 0 ? (
              biggestDrivers.map((driver) => (
                <li
                  key={`${driver.kind}:${driver.label}`}
                  className="flex items-start justify-between gap-3 rounded-xl border border-[var(--hairline)] bg-white px-4 py-3"
                >
                  <div>
                    <p className="font-semibold text-[var(--color-ink-900)]">
                      {driverLabel(driver)}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
                      {driverMeta(driver)}
                    </p>
                  </div>
                  <span className="font-bold text-[var(--color-ink-900)] whitespace-nowrap">
                    {formatMoney(driver.amount)}
                  </span>
                </li>
              ))
            ) : (
              <li className="rounded-xl border border-[var(--hairline)] bg-white px-4 py-3 text-sm text-[var(--color-ink-500)]">
                We&apos;ll show the detailed cost drivers here as soon as this
                itinerary has itemised budget data.
              </li>
            )}
          </ul>
        </div>

        <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--color-sand-50)] p-4">
          <label className="block">
            <span className="text-sm font-semibold text-[var(--color-ink-700)]">
              Try another total budget ({currency})
            </span>
            <span className="mt-1 block text-sm text-[var(--color-ink-500)]">
              Enter a total budget and we&apos;ll tell you exactly how it fits
              this itinerary.
            </span>
            <input
              type="number"
              min={0}
              step={500}
              inputMode="numeric"
              value={enteredBudget}
              onChange={(e) => setEnteredBudget(e.target.value)}
              placeholder={String(requestedBudget.max)}
              className="input mt-3"
            />
          </label>

          <p className="mt-2 text-xs text-[var(--color-ink-500)]">
            Requested budget: {formatMoney(requestedBudget.max)}
            {recommendedBudget && (
              <>
                {" "}
                · Recommended range: {formatMoney(recommendedBudget.min)} to{" "}
                {formatMoney(recommendedBudget.max)}
              </>
            )}
          </p>

          {invalidBudget && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              Enter a valid non-negative budget to compare against this route.
            </div>
          )}

          {assessment && tone && (
            <div
              role="status"
              className={`mt-4 rounded-xl border px-4 py-3 text-sm ${tone.container}`}
            >
              <p className="font-semibold">{messageForAssessment(assessment, {
                budget: recommendedBudget ?? requestedBudget,
                estimatedCost,
                formatMoney,
              })}</p>
              {assessment.topDrivers.length > 0 &&
                assessment.status !== "within_range" && (
                  <ul className="mt-3 space-y-2">
                    {assessment.topDrivers.map((driver) => (
                      <li
                        key={`assessment:${driver.kind}:${driver.label}`}
                        className={`flex items-start justify-between gap-3 ${tone.item}`}
                      >
                        <span>{driverLabel(driver)}</span>
                        <span className="font-semibold whitespace-nowrap">
                          {formatMoney(driver.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BudgetStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--hairline)] bg-[var(--color-sand-50)] px-4 py-3">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
        {label}
      </p>
      <p className="mt-1.5 text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
        {value}
      </p>
    </div>
  );
}

function messageForAssessment(
  assessment: ReturnType<typeof assessBudgetRequest>,
  args: {
    budget: BudgetRange;
    estimatedCost: number;
    formatMoney: (value: number) => string;
  },
): string {
  switch (assessment.status) {
    case "shortfall":
      return `This budget falls short by ${args.formatMoney(assessment.delta)}. Most of that gap comes from the stays and travel below.`;
    case "excess":
      return `This budget is ${args.formatMoney(assessment.delta)} above the recommended ceiling. The route itself is estimated at ${args.formatMoney(args.estimatedCost)}, so that extra headroom is not really justified by the current plan.`;
    default:
      return `That works. This budget sits inside the recommended ${args.formatMoney(args.budget.min)} to ${args.formatMoney(args.budget.max)} range for the current route.`;
  }
}

function toneFor(status: ReturnType<typeof assessBudgetRequest>["status"]) {
  switch (status) {
    case "shortfall":
      return {
        container: "border-red-200 bg-red-50 text-red-900",
        item: "text-red-900",
      };
    case "excess":
      return {
        container: "border-amber-200 bg-amber-50 text-amber-900",
        item: "text-amber-900",
      };
    default:
      return {
        container: "border-emerald-200 bg-emerald-50 text-emerald-900",
        item: "text-emerald-900",
      };
  }
}

function driverLabel(driver: BudgetDriver): string {
  if (driver.kind === "stay" && driver.occurrences > 1) {
    return `${driver.label} (${driver.occurrences} days)`;
  }
  if (driver.kind === "travel" && driver.occurrences > 1) {
    return `${driver.label} (${driver.occurrences} legs)`;
  }
  return driver.label;
}

function driverMeta(driver: BudgetDriver): string {
  if (driver.kind === "stay") {
    return driver.occurrences > 1
      ? "Accommodation across repeated nights"
      : "Accommodation for this stop";
  }
  return driver.occurrences > 1
    ? "Repeated transport legs in this itinerary"
    : "Transport between destinations";
}

function sumByKind(
  lineItems: ItineraryBudgetLineItem[],
  kind: ItineraryBudgetLineItem["kind"],
): number {
  return lineItems
    .filter((item) => item.kind === kind)
    .reduce((sum, item) => sum + item.amount, 0);
}
