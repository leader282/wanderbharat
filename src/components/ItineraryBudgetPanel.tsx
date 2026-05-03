"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { presentGenerateItineraryError } from "@/lib/api/generateItineraryError";
import { useAuth } from "@/lib/auth/AuthProvider";
import { assessBudgetRequest } from "@/lib/itinerary/budget";
import type { BudgetAdjustmentPreview } from "@/lib/itinerary/budgetAdjustmentPreview";
import {
  type BudgetDataState,
  deriveBudgetPanelState,
  formatBudgetDriverLabel,
  formatBudgetDriverMeta,
} from "@/lib/itinerary/budgetPanelPresentation";
import { makeMoneyFormatter } from "@/lib/itinerary/presentation";
import DataStateBadge from "@/components/itinerary/DataStateBadge";
import type {
  BudgetRange,
  ItineraryBudgetBreakdown,
  TravellerComposition,
} from "@/types/domain";

export default function ItineraryBudgetPanel({
  itineraryId,
  estimatedCost,
  requestedBudget,
  travellers,
  tripDays,
  breakdown,
}: {
  itineraryId: string;
  estimatedCost: number;
  requestedBudget: BudgetRange;
  travellers: TravellerComposition;
  tripDays?: number;
  breakdown?: ItineraryBudgetBreakdown;
}) {
  const router = useRouter();
  const { getIdToken } = useAuth();
  const [enteredBudget, setEnteredBudget] = useState("");
  const [preview, setPreview] = useState<BudgetAdjustmentPreview | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const budgetState = useMemo(
    () =>
      deriveBudgetPanelState({
        estimatedCost,
        requestedBudget,
        travellers,
        tripDays,
        breakdown,
      }),
    [breakdown, estimatedCost, requestedBudget, travellers, tripDays],
  );
  const {
    attractionSubtotal,
    attractionsDataState,
    budgetGap,
    budgetGapLabel,
    biggestDrivers,
    currency,
    estimatedAttractionCostsCount,
    estimatedComponentTotal,
    foodDataState,
    foodEstimate,
    hasAttractionSubtotal,
    hasStaySubtotal,
    hasTravelSubtotal,
    hasUnknownLodgingCosts,
    hotelsDataState,
    localTransportDataState,
    localTransportEstimate,
    lodgingLastCheckedAt,
    lodgingRateState,
    unknownLodgingStaysCount,
    showCostRange,
    totalCostCeiling,
    totalCostFloor,
    travelDataState,
    travelSubtotal,
    tripDays: budgetTripDays,
    unknownCostExclusionsCount,
    lineItems,
    lodgingSubtotal,
    unknownAttractionCostsCount,
    recommendedBudget,
    totalTripCost,
    travellerLabel,
    verifiedAttractionCostsCount,
  } = budgetState;
  const formatMoney = useMemo(() => makeMoneyFormatter(currency), [currency]);
  const lodgingLastCheckedLabel = useMemo(() => {
    if (!lodgingLastCheckedAt) return null;
    try {
      return new Date(lodgingLastCheckedAt).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return null;
    }
  }, [lodgingLastCheckedAt]);
  const displayedPlanCost = showCostRange ? totalCostCeiling : totalTripCost;
  const totalCostLabel = showCostRange
    ? `${formatMoney(totalCostFloor)} – ${formatMoney(totalCostCeiling)}`
    : formatMoney(totalTripCost);

  const parsedBudget =
    enteredBudget.trim() === "" ? null : Number(enteredBudget);
  const invalidBudget =
    parsedBudget !== null &&
    (!Number.isFinite(parsedBudget) || parsedBudget < 0);
  const nextBudget = parsedBudget === null || invalidBudget ? null : Math.round(parsedBudget);
  const canRequestPreview = nextBudget !== null;

  const assessment = useMemo(() => {
    if (parsedBudget === null || invalidBudget) return null;
    return assessBudgetRequest({
      requestedBudget: parsedBudget,
      estimatedCost: displayedPlanCost,
      recommended: recommendedBudget ?? requestedBudget,
      lineItems,
    });
  }, [
    displayedPlanCost,
    invalidBudget,
    lineItems,
    parsedBudget,
    recommendedBudget,
    requestedBudget,
  ]);

  const tone = assessment ? toneFor(assessment.status) : null;

  async function requestBudgetPreview(applyChange: boolean) {
    if (nextBudget === null) return;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const idToken = await getIdToken();
    if (idToken) headers.Authorization = `Bearer ${idToken}`;

    if (applyChange) {
      setApplying(true);
    } else {
      setPreviewing(true);
    }
    setRequestError(null);

    try {
      const res = await fetch(`/api/itinerary/${encodeURIComponent(itineraryId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          total_budget: nextBudget,
          apply: applyChange,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { preview?: BudgetAdjustmentPreview }
        | null;

      if (!res.ok) {
        setRequestError(presentGenerateItineraryError(payload, res.status));
        return;
      }

      setPreview(payload?.preview ?? null);
      if (applyChange) {
        router.refresh();
      }
    } catch {
      setRequestError(
        "We couldn't recalculate this budget right now. Please try again.",
      );
    } finally {
      setPreviewing(false);
      setApplying(false);
    }
  }

  return (
    <div className="card p-6 md:p-8">
      <div>
        <p className="eyebrow">Budget</p>
        <h2 className="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
          How your budget breaks down
        </h2>
        <p className="mt-2 max-w-2xl text-[var(--color-ink-500)]">
          {showCostRange ? "Current planning range for this route is " : "Current trip total is "}
          <span className="font-semibold text-[var(--color-ink-900)]">
            {totalCostLabel}
          </span>{" "}
          for {travellerLabel} over {budgetTripDays}{" "}
          {budgetTripDays === 1 ? "day" : "days"}.
          {showCostRange && (
            <> We show a range whenever parts of the trip are estimated.</>
          )}
          {" "}Your requested budget is {formatMoney(requestedBudget.max)}.
          {recommendedBudget && (
            <>
              {" "}
              A comfortable route range is{" "}
              {formatMoney(recommendedBudget.min)}&nbsp;–&nbsp;
              {formatMoney(recommendedBudget.max)}.
            </>
          )}
        </p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BudgetStat
          label="Your budget"
          value={formatMoney(requestedBudget.max)}
        />
        <BudgetStat
          label={showCostRange ? "Planning total range" : "Current total"}
          value={totalCostLabel}
        />
        <BudgetStat
          label={budgetGapLabel}
          value={formatMoney(Math.abs(budgetGap))}
        />
        <BudgetStat
          label="Unknown costs excluded"
          value={
            unknownCostExclusionsCount > 0
              ? `${unknownCostExclusionsCount} item${unknownCostExclusionsCount === 1 ? "" : "s"}`
              : "None"
          }
        />
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--hairline)]">
        <BudgetCategoryRow
          label="Hotels"
          state={hotelsDataState}
          amount={
            hasUnknownLodgingCosts && lodgingSubtotal <= 0
              ? "Rates unavailable"
              : hasStaySubtotal
                ? formatMoney(lodgingSubtotal)
                : "Not itemised"
          }
          detail={
            lodgingRateState === "lodging_live"
              ? "Live rates available for this itinerary."
              : lodgingRateState === "lodging_cached"
                ? "Rates come from cached snapshots."
                : unknownLodgingStaysCount > 0
                  ? `Rates unavailable for ${unknownLodgingStaysCount} stay ${unknownLodgingStaysCount === 1 ? "block" : "blocks"}.`
                  : "Rates are currently unavailable."
          }
          subdetail={
            lodgingLastCheckedLabel
              ? `Last checked ${lodgingLastCheckedLabel}`
              : undefined
          }
        />
        <BudgetCategoryRow
          label="Attractions"
          state={attractionsDataState}
          amount={hasAttractionSubtotal ? formatMoney(attractionSubtotal) : "Not itemised"}
          detail={`Coverage: ${verifiedAttractionCostsCount} verified · ${estimatedAttractionCostsCount} estimated · ${unknownAttractionCostsCount} unknown`}
        />
        <BudgetCategoryRow
          label="Travel"
          state={travelDataState}
          amount={hasTravelSubtotal ? formatMoney(travelSubtotal) : "Not itemised"}
          detail={
            hasTravelSubtotal
              ? "Route transfer costs from current itinerary data."
              : "Travel costs are not itemised separately yet."
          }
        />
        <BudgetCategoryRow
          label="Food"
          state={foodDataState}
          amount={formatMoney(foodEstimate)}
          detail="Estimated daily meal allowance."
        />
        <BudgetCategoryRow
          label="Local transport"
          state={localTransportDataState}
          amount={formatMoney(localTransportEstimate)}
          detail="Estimated autos, taxis, and short local rides."
        />
      </div>

      <p className="mt-3 text-sm text-[var(--color-ink-500)]">
        Estimated components add {formatMoney(estimatedComponentTotal)} to the
        upper end of this range.
      </p>
      {unknownCostExclusionsCount > 0 && (
        <p className="mt-2 text-sm text-amber-700">
          {unknownCostExclusionsCount} unknown cost{" "}
          {unknownCostExclusionsCount === 1 ? "item is" : "items are"} excluded
          from the total until data is verified or estimated.
        </p>
      )}
      <p className="mt-2 text-sm text-[var(--color-ink-500)]">
        Hotel prices may change between checks. Booking is disabled in this
        prototype.
      </p>
      {verifiedAttractionCostsCount +
        estimatedAttractionCostsCount +
        unknownAttractionCostsCount >
        0 && (
        <p className="mt-2 text-sm text-[var(--color-ink-500)]">
          Attraction cost coverage: {verifiedAttractionCostsCount} verified,{" "}
          {estimatedAttractionCostsCount} estimated, {unknownAttractionCostsCount}{" "}
          unknown.
        </p>
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
                      {formatBudgetDriverLabel(driver)}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
                      {formatBudgetDriverMeta(driver)}
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
              Try a different budget
            </span>
            <span className="mt-1 block text-sm text-[var(--color-ink-500)]">
              See how the route, stays, and things to do shift before you
              commit — enter a new total in {currency}.
            </span>
            <input
              type="number"
              min={0}
              step={500}
              inputMode="numeric"
              value={enteredBudget}
              onChange={(e) => {
                setEnteredBudget(e.target.value);
                setPreview(null);
                setRequestError(null);
              }}
              placeholder={String(requestedBudget.max)}
              className="input mt-3"
            />
          </label>

          <p className="mt-2 text-xs text-[var(--color-ink-500)]">
            Currently planned at {formatMoney(requestedBudget.max)}
            {recommendedBudget && (
              <>
                {" "}
                · Comfortable range {formatMoney(recommendedBudget.min)}&nbsp;–&nbsp;
                {formatMoney(recommendedBudget.max)}
              </>
            )}
          </p>

          {invalidBudget && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              Enter a valid non-negative budget to preview changes.
            </div>
          )}

          {requestError && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              {requestError}
            </div>
          )}

          {assessment && tone && (
            <div
              role="status"
              className={`mt-4 rounded-xl border px-4 py-3 text-sm ${tone.container}`}
            >
              <p className="font-semibold">{messageForAssessment(assessment, {
                budget: recommendedBudget ?? requestedBudget,
                estimatedCost: displayedPlanCost,
                formatMoney,
              })}</p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void requestBudgetPreview(false)}
              disabled={!canRequestPreview || previewing || applying}
              className="btn-secondary"
            >
              {previewing ? (
                <>
                  <Spinner />
                  Previewing…
                </>
              ) : (
                "Preview new budget"
              )}
            </button>

            {preview && (
              <button
                type="button"
                onClick={() => void requestBudgetPreview(true)}
                disabled={previewing || applying}
                className="btn-primary"
              >
              {applying ? (
                <>
                  <Spinner />
                  Updating itinerary…
                </>
              ) : (
                "Apply new budget"
              )}
              </button>
            )}
          </div>

          {preview && (
            <BudgetPreviewCard
              preview={preview}
              formatMoney={formatMoney}
            />
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

function BudgetCategoryRow({
  label,
  state,
  amount,
  detail,
  subdetail,
}: {
  label: string;
  state: BudgetDataState;
  amount: string;
  detail: string;
  subdetail?: string;
}) {
  return (
    <div className="border-b border-[var(--hairline)] px-4 py-3 last:border-b-0 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-ink-900)]">
            {label}
          </p>
          <p className="mt-1 text-xs text-[var(--color-ink-500)]">{detail}</p>
          {subdetail && (
            <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
              {subdetail}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DataStateBadge state={state} />
          <span className="text-sm font-semibold text-[var(--color-ink-900)] whitespace-nowrap">
            {amount}
          </span>
        </div>
      </div>
    </div>
  );
}

function BudgetPreviewCard({
  preview,
  formatMoney,
}: {
  preview: BudgetAdjustmentPreview;
  formatMoney: (value: number) => string;
}) {
  const tone = previewToneFor(preview.direction);

  return (
    <div className={`mt-4 rounded-xl border px-4 py-4 ${tone.container}`}>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em]">
        {previewHeading(preview)}
      </p>
      <p className="mt-2 font-semibold">{preview.summary}</p>

      <div className="mt-3 space-y-2">
        {preview.impacts.map((impact) => (
          <div
            key={impact.id}
            className={`rounded-xl border px-3 py-3 ${tone.item}`}
          >
            <p className="font-semibold">{impact.title}</p>
            <p className="mt-1 text-xs leading-relaxed">{impact.detail}</p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs">
        Estimated trip cost: {formatMoney(preview.currentEstimatedCost)} now,{" "}
        {formatMoney(preview.proposedEstimatedCost)} with this budget.
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
      return `This budget is ${args.formatMoney(assessment.delta)} short of covering the current plan. Most of that gap sits in the stays and travel below.`;
    case "excess":
      return `This is ${args.formatMoney(assessment.delta)} above the recommended ceiling for this route (estimated at ${args.formatMoney(args.estimatedCost)}). You have room to spare, but the current plan won't spend it.`;
    default:
      return `That works. This budget sits inside the comfortable ${args.formatMoney(args.budget.min)}–${args.formatMoney(args.budget.max)} range for this route.`;
  }
}

function previewToneFor(direction: BudgetAdjustmentPreview["direction"]) {
  switch (direction) {
    case "downgrade":
      return {
        container: "border-amber-200 bg-amber-50 text-amber-900",
        item: "border-amber-200/80 bg-white/70 text-amber-950",
      };
    case "upgrade":
      return {
        container: "border-emerald-200 bg-emerald-50 text-emerald-900",
        item: "border-emerald-200/80 bg-white/70 text-emerald-950",
      };
    default:
      return {
        container: "border-sky-200 bg-sky-50 text-sky-900",
        item: "border-sky-200/80 bg-white/70 text-sky-950",
      };
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

function previewHeading(preview: BudgetAdjustmentPreview): string {
  switch (preview.direction) {
    case "downgrade":
      return "Possible downgrades";
    case "upgrade":
      return "Possible upgrades";
    default:
      return "Route impact";
  }
}

function Spinner() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
