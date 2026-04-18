import type {
  BudgetRange,
  ItineraryBudgetLineItem,
} from "@/types/domain";

export const AUTO_BUDGET_MAX = 1_000_000_000;

const BUDGET_BUFFER_RATIO = 0.15;
const MIN_BUDGET_BUFFER = 1_500;
const BUDGET_STEP = 500;

export interface BudgetAssessment {
  status: "within_range" | "shortfall" | "excess";
  delta: number;
  topDrivers: BudgetDriver[];
}

export interface BudgetDriver {
  label: string;
  kind: ItineraryBudgetLineItem["kind"];
  amount: number;
  occurrences: number;
}

export function makeAutoBudget(currency?: string): BudgetRange {
  return { min: 0, max: AUTO_BUDGET_MAX, currency };
}

export function deriveOptimalBudget(
  estimatedCost: number,
  currency?: string,
): BudgetRange {
  const min = Math.max(0, Math.round(estimatedCost));
  const buffer = Math.max(
    MIN_BUDGET_BUFFER,
    Math.round(min * BUDGET_BUFFER_RATIO),
  );

  return {
    min,
    max: roundUpBudget(min + buffer),
    currency,
  };
}

export function assessBudgetRequest(args: {
  requestedBudget: number;
  estimatedCost: number;
  recommended: Pick<BudgetRange, "min" | "max">;
  lineItems?: ItineraryBudgetLineItem[];
}): BudgetAssessment {
  const requestedBudget = Math.max(0, Math.round(args.requestedBudget));
  const topDrivers = topBudgetDrivers(args.lineItems ?? [], 3);

  if (requestedBudget < args.estimatedCost) {
    return {
      status: "shortfall",
      delta: Math.round(args.estimatedCost - requestedBudget),
      topDrivers,
    };
  }

  if (requestedBudget > args.recommended.max) {
    return {
      status: "excess",
      delta: Math.round(requestedBudget - args.recommended.max),
      topDrivers,
    };
  }

  return {
    status: "within_range",
    delta: 0,
    topDrivers,
  };
}

export function topBudgetDrivers(
  lineItems: ItineraryBudgetLineItem[],
  limit = 3,
): BudgetDriver[] {
  const grouped = new Map<string, BudgetDriver>();

  for (const item of lineItems) {
    const key = `${item.kind}:${item.label}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.amount += item.amount;
      existing.occurrences += 1;
      continue;
    }

    grouped.set(key, {
      label: item.label,
      kind: item.kind,
      amount: item.amount,
      occurrences: 1,
    });
  }

  return Array.from(grouped.values())
    .map((driver) => ({
      ...driver,
      amount: Math.round(driver.amount),
    }))
    .sort((left, right) => {
      const amountDiff = right.amount - left.amount;
      if (amountDiff !== 0) return amountDiff;
      return left.label.localeCompare(right.label);
    })
    .slice(0, limit);
}

function roundUpBudget(amount: number): number {
  return Math.ceil(Math.max(0, amount) / BUDGET_STEP) * BUDGET_STEP;
}
