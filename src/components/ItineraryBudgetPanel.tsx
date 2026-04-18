"use client";

import { useMemo, useState } from "react";

import {
  assessBudgetRequest,
  topBudgetDrivers,
  type BudgetDriver,
} from "@/lib/itinerary/budget";
import type {
  BudgetRange,
  ItineraryBudgetBreakdown,
  ItineraryBudgetLineItem,
} from "@/types/domain";

const EMPTY_LINE_ITEMS: ItineraryBudgetLineItem[] = [];

export default function ItineraryBudgetPanel({
  estimatedCost,
  budget,
  breakdown,
}: {
  estimatedCost: number;
  budget: BudgetRange;
  breakdown?: ItineraryBudgetBreakdown;
}) {
  const [requestedBudget, setRequestedBudget] = useState("");
  const currency = budget.currency ?? "INR";
  const formatMoney = useMemo(() => makeMoneyFormatter(currency), [currency]);
  const buffer = Math.max(0, budget.max - estimatedCost);
  const lineItems = breakdown?.line_items ?? EMPTY_LINE_ITEMS;
  const biggestDrivers = useMemo(
    () => topBudgetDrivers(lineItems, 3),
    [lineItems],
  );

  const parsedBudget =
    requestedBudget.trim() === "" ? null : Number(requestedBudget);
  const invalidBudget =
    parsedBudget !== null &&
    (!Number.isFinite(parsedBudget) || parsedBudget < 0);

  const assessment = useMemo(() => {
    if (parsedBudget === null || invalidBudget) return null;
    return assessBudgetRequest({
      requestedBudget: parsedBudget,
      estimatedCost,
      recommended: budget,
      lineItems,
    });
  }, [budget, estimatedCost, invalidBudget, lineItems, parsedBudget]);

  const tone = assessment ? toneFor(assessment.status) : null;

  return (
    <div className="mt-10 card p-6 md:p-7">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Budget</p>
          <h2 className="mt-2 text-2xl md:text-3xl font-black">
            Why this budget feels justified
          </h2>
          <p className="mt-2 text-[var(--color-ink-500)] max-w-2xl">
            We estimate this route at {formatMoney(estimatedCost)} per person,
            then add {formatMoney(buffer)} of headroom on top so the recommended
            budget still feels realistic when stays and transport move around.
          </p>
        </div>

        <span className="chip" aria-hidden>
          Per person
        </span>
      </div>

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
                  className="flex items-start justify-between gap-3 rounded-xl border border-[rgba(26,23,20,0.06)] bg-white px-4 py-3"
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
              <li className="rounded-xl border border-[rgba(26,23,20,0.06)] bg-white px-4 py-3 text-sm text-[var(--color-ink-500)]">
                We&apos;ll show the detailed cost drivers here as soon as the
                itinerary has itemised budget data.
              </li>
            )}
          </ul>
        </div>

        <div className="rounded-2xl border border-[rgba(26,23,20,0.08)] bg-[var(--color-sand-50)] p-4">
          <label className="block">
            <span className="text-sm font-semibold text-[var(--color-ink-700)]">
              Try your budget ({currency} per person)
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
              value={requestedBudget}
              onChange={(e) => setRequestedBudget(e.target.value)}
              placeholder={String(budget.max)}
              className="input mt-3"
            />
          </label>

          <p className="mt-2 text-xs text-[var(--color-ink-500)]">
            Recommended range: {formatMoney(budget.min)} to{" "}
            {formatMoney(budget.max)}
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
                budget,
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
      ? "Accommodation and local spend across repeated nights"
      : "Accommodation and local spend for this stop";
  }
  return driver.occurrences > 1
    ? "Repeated transport legs in this itinerary"
    : "Transport between destinations";
}

function makeMoneyFormatter(currency: string) {
  try {
    const nf = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    return (value: number) => nf.format(Math.max(0, Number(value) || 0));
  } catch {
    return (value: number) =>
      `${currency} ${Math.round(Math.max(0, Number(value) || 0)).toLocaleString("en-IN")}`;
  }
}
