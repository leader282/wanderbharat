export type PlanFormNumberValue = number | "";

interface ParsePlanFormNumberInputOptions {
  min?: number;
  max?: number;
}

interface NormalisePlanFormNumberInputOptions {
  min?: number;
  max?: number;
  fallback: number;
}

export function parsePlanFormNumberInput(
  rawValue: string,
  options: ParsePlanFormNumberInputOptions = {},
): PlanFormNumberValue {
  if (rawValue === "") return "";

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue)) return "";

  return clampWholeNumber(parsedValue, options);
}

export function normalisePlanFormNumberInput(
  value: PlanFormNumberValue,
  options: NormalisePlanFormNumberInputOptions,
): number {
  if (value === "" || !Number.isFinite(value)) {
    return clampWholeNumber(options.fallback, options);
  }

  return clampWholeNumber(value, options);
}

function clampWholeNumber(
  value: number,
  options: ParsePlanFormNumberInputOptions,
): number {
  const min = options.min ?? 0;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
