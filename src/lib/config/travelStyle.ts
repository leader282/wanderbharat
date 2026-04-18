import type { TravelStyle } from "@/types/domain";

/**
 * Pacing profiles consumed by the itinerary engine. Every value that used
 * to be hard-coded ("relaxed → fewer nodes", "max 10 hours / day") lives
 * here. To add a new style:
 *
 *   1. Add the slug to `TRAVEL_STYLES` in `types/domain.ts`.
 *   2. Add an entry below.
 *
 * The engine never branches on the string — it only reads these numbers.
 */
export interface TravelStyleConfig {
  /** Maximum travel hours per day (bus / train / flight in-seat time). */
  maxTravelHoursPerDay: number;
  /** Maximum total activity + travel hours per day. */
  maxTotalHoursPerDay: number;
  /** Minimum hours to spend at a single base before moving on. */
  minHoursPerStop: number;
  /**
   * Fraction (0..1) of day fillable with activities after travel. Lower
   * numbers = slower pace = more free time for meals / rest.
   */
  activityFillRatio: number;
  /**
   * Multiplier applied to the ideal number of distinct destinations per
   * trip, relative to `days`. e.g. 0.5 means "~half as many destinations
   * as days". Engine clamps with graph size.
   */
  destinationDensity: number;
}

export const travelStyleConfig: Record<TravelStyle, TravelStyleConfig> = {
  relaxed: {
    maxTravelHoursPerDay: 4,
    maxTotalHoursPerDay: 9,
    minHoursPerStop: 18,
    activityFillRatio: 0.6,
    destinationDensity: 0.4,
  },
  balanced: {
    maxTravelHoursPerDay: 6,
    maxTotalHoursPerDay: 10,
    minHoursPerStop: 12,
    activityFillRatio: 0.75,
    destinationDensity: 0.6,
  },
  adventurous: {
    maxTravelHoursPerDay: 8,
    maxTotalHoursPerDay: 11,
    minHoursPerStop: 8,
    activityFillRatio: 0.9,
    destinationDensity: 0.85,
  },
};

export function getTravelStyleConfig(style: TravelStyle): TravelStyleConfig {
  const cfg = travelStyleConfig[style];
  if (!cfg) {
    throw new Error(`Unknown travel style: ${style}`);
  }
  return cfg;
}
