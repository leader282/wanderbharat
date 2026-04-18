import type { TransportMode } from "@/types/domain";
import { idealRadiusKm } from "@/lib/config/transportMode";

/**
 * Engine tunables. Every magic number that used to live inline in
 * `engine.ts` / `scoring.ts` / `travelMatrix.ts` has an entry here so the
 * same algorithm can be reused for different dataset sizes and modes.
 */
export interface EngineTuning {
  /** DFS pool size bounds. */
  poolSize: {
    min: number;
    max: number;
    /** Multiplier over maxVisitCount; final pool is clamped to [min, max]. */
    multiplier: number;
  };
  /** Fallback stop-desire hours used by the day planner. */
  defaultStopHours: number;
  /** Fallback attraction hours when metadata is sparse. */
  defaultAttractionHours: number;
  /** Scoring Gaussian radius, selectable per-mode. */
  idealRadiusKm: (modes: TransportMode[]) => number;
  /**
   * Cap on total pair-wise legs resolved in a single `resolveTravelMatrix`
   * run. Protects against runaway Google Routes spend. O(n²) grows fast.
   */
  maxMatrixPairs: number;
  /** Concurrency for outbound Routes / Places calls. */
  networkConcurrency: number;
  /**
   * Per-leg scoring weights used by the engine when multiple modes are
   * viable between the same pair: `α·hours + β·cost + γ·fatigue`.
   */
  legCost: {
    hours: number;
    cost: number;
    fatigue: number;
  };
}

export const defaultEngineTuning: EngineTuning = {
  poolSize: { min: 4, max: 12, multiplier: 4 },
  defaultStopHours: 4,
  defaultAttractionHours: 2,
  idealRadiusKm: (modes) => {
    if (modes.length === 0) return 500;
    let sum = 0;
    for (const mode of modes) sum += idealRadiusKm(mode);
    return sum / modes.length;
  },
  maxMatrixPairs: 2_000,
  networkConcurrency: 8,
  legCost: { hours: 1, cost: 0.0005, fatigue: 0.5 },
};

/** Per-region overrides applied on top of defaults. */
export type EngineTuningOverride = Partial<
  Omit<EngineTuning, "idealRadiusKm" | "poolSize" | "legCost">
> & {
  poolSize?: Partial<EngineTuning["poolSize"]>;
  legCost?: Partial<EngineTuning["legCost"]>;
};

export function mergeEngineTuning(
  base: EngineTuning,
  override?: EngineTuningOverride,
): EngineTuning {
  if (!override) return base;
  return {
    ...base,
    ...override,
    poolSize: { ...base.poolSize, ...(override.poolSize ?? {}) },
    legCost: { ...base.legCost, ...(override.legCost ?? {}) },
    idealRadiusKm: base.idealRadiusKm,
  };
}
