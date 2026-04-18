import type {
  GraphNode,
  ItineraryPreferences,
  PreferenceTag,
} from "@/types/domain";
import { distanceBetween } from "@/lib/itinerary/graph";
import {
  defaultEngineTuning,
  type EngineTuning,
} from "@/lib/config/engineTuning";

/**
 * Pure scoring helpers. No side effects, no I/O. Every score is normalised
 * into [0, 1] so composite scores are meaningful across factors.
 */

export interface ScoredNode {
  node: GraphNode;
  score: number;
  /** Breakdown for debugging / UI. */
  factors: {
    proximity: number;
    tagMatch: number;
    popularity: number;
  };
}

/**
 * Score a candidate destination node relative to the trip's start and the
 * user's preferences.
 *
 * - `proximity` rewards nodes that are neither too close (skip Jaipur if
 *   you start in Jaipur) nor too far (skip Leh on a 3-day Rajasthan trip).
 * - `tagMatch` is the fraction of the user's interests that the node's
 *   tags cover.
 * - `popularity` is a soft prior derived from seed metadata
 *   (`recommended_hours`) so well-documented places outrank stubs.
 */
export function scoreCandidateNode(
  candidate: GraphNode,
  start: GraphNode,
  prefs: ItineraryPreferences,
  /**
   * Radius (km) within which proximity is maximal. If omitted, derived
   * from the preferred transport modes via {@link defaultEngineTuning}.
   */
  idealRadiusKm?: number,
  tuning: EngineTuning = defaultEngineTuning,
): ScoredNode {
  const distance = distanceBetween(start.location, candidate.location);

  const radius =
    idealRadiusKm ??
    tuning.idealRadiusKm(prefs.transport_modes ?? ["road"]);

  // Gaussian-ish proximity: peaks near radius/3, tails off smoothly.
  const proximity = Math.max(
    0,
    1 - Math.abs(distance - radius / 3) / radius,
  );

  const interests = prefs.interests ?? [];
  const tagMatch = computeTagOverlap(candidate.tags, interests);

  const recHours = Number(candidate.metadata.recommended_hours ?? 0);
  const popularity = clamp01(recHours / 24); // 24h worth of content → 1.0

  const score =
    0.45 * proximity + 0.4 * tagMatch + 0.15 * popularity;

  return {
    node: candidate,
    score,
    factors: { proximity, tagMatch, popularity },
  };
}

export function computeTagOverlap(
  nodeTags: PreferenceTag[],
  interests: PreferenceTag[],
): number {
  if (interests.length === 0) return 0.5; // neutral — don't penalise absence of input
  const nodeSet = new Set(nodeTags.map((t) => t.toLowerCase()));
  let hits = 0;
  for (const tag of interests) {
    if (nodeSet.has(tag.toLowerCase())) hits += 1;
  }
  return hits / interests.length;
}

/**
 * Final composite score for a full itinerary. Used for the `score` field
 * persisted on the itinerary document.
 */
export function scoreItinerary(options: {
  destinationScores: number[];
  budgetUtilisation: number;
  totalTravelHours: number;
  daysAvailable: number;
  maxTravelHoursPerDay: number;
}): number {
  const avgDestScore =
    options.destinationScores.length > 0
      ? average(options.destinationScores)
      : 0.5;

  // Penalise itineraries that burn their entire time on the road.
  const totalBudgetedTravel =
    options.daysAvailable * options.maxTravelHoursPerDay;
  const travelPenalty = clamp01(
    options.totalTravelHours / Math.max(1, totalBudgetedTravel),
  );
  const pacing = 1 - Math.max(0, travelPenalty - 0.75) * 4;

  // Reward trips that use 70-95% of the budget — under-use feels wasteful,
  // over-use is infeasible and is already rejected by the constraint engine.
  const budget = 1 - Math.abs(options.budgetUtilisation - 0.85);

  return clamp01(0.6 * avgDestScore + 0.25 * clamp01(pacing) + 0.15 * clamp01(budget));
}

function average(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
