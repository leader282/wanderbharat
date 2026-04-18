import type {
  ConstraintError,
  GenerateItineraryInput,
  GraphEdge,
  GraphNode,
  Itinerary,
  ItineraryBudgetLineItem,
  ItineraryActivity,
  ItineraryDay,
  PreferenceTag,
  TransportMode,
} from "@/types/domain";
import { getTravelStyleConfig } from "@/lib/config/travelStyle";
import {
  defaultEngineTuning,
  mergeEngineTuning,
  type EngineTuning,
  type EngineTuningOverride,
} from "@/lib/config/engineTuning";
import { defaultPerKmCost, maxDailyHoursFor } from "@/lib/config/transportMode";
import { TravelGraph } from "@/lib/itinerary/graph";
import { scoreCandidateNode, scoreItinerary } from "@/lib/itinerary/scoring";
import {
  buildTravelMatrix,
  resolveTravelMatrix,
  type ResolvedTravelLeg,
  type TravelMatrix,
} from "@/lib/itinerary/travelMatrix";
import {
  insufficientNodes,
  noFeasibleRoute,
  validateBudget,
  validateDayPlan,
  validateInput,
} from "@/lib/itinerary/constraints";
import { deriveOptimalBudget } from "@/lib/itinerary/budget";

/**
 * The itinerary engine orchestrates two phases:
 * 1. Resolve and cache concrete travel legs for the planning pool.
 * 2. Run a deterministic, pure route/day allocator against that strict matrix.
 */

export interface EngineContext {
  /** Nodes visible to this planning run (already filtered by region, etc). */
  nodes: GraphNode[];
  /** Edges visible to this planning run. */
  edges: GraphEdge[];
  /** Attraction nodes grouped by parent city id (optional). */
  attractionsByCity?: Map<string, GraphNode[]>;
  /** Clock injected for deterministic tests. */
  now?: () => number;
  /** Id generator injected for deterministic tests. */
  makeId?: (prefix: string) => string;
  /** Per-region / per-deploy tunables layered on top of defaults. */
  tuningOverride?: EngineTuningOverride;
}

export interface EngineDependencies {
  resolveTravelMatrix?: typeof resolveTravelMatrix;
}

export type EngineResult =
  | { ok: true; itinerary: Itinerary }
  | { ok: false; error: ConstraintError };

interface RouteSearchInput {
  start: GraphNode;
  end: GraphNode;
  days: number;
  candidates: GraphNode[];
  cfg: ReturnType<typeof getTravelStyleConfig>;
  preferences: GenerateItineraryInput["preferences"];
  matrix: TravelMatrix;
  nodesById: Map<string, GraphNode>;
  attractionsByCity?: Map<string, GraphNode[]>;
  scoredById: Map<string, number>;
  maxVisitCount: number;
  modes: TransportMode[];
  tuning: EngineTuning;
}

interface RouteSelection {
  order: GraphNode[];
  dayPlan: ItineraryDay[];
  estimatedCost: number;
  budgetLineItems: ItineraryBudgetLineItem[];
  totalTravelHours: number;
  totalTravelDistance: number;
  totalFatigueHours: number;
  meaningfulStopCount: number;
  destinationScores: number[];
  experienceScore: number;
  fatiguePenalty: number;
  isFallbackStay: boolean;
}

type StayRole = "visit" | "destination" | "return_home" | "staycation";

interface StaySpec {
  base: GraphNode;
  arrivalLeg: ResolvedTravelLeg | null;
  role: StayRole;
  requiredHours: number;
  desiredHours: number;
  scoreWeight: number;
}

export async function generateItinerary(
  input: GenerateItineraryInput,
  ctx: EngineContext,
  deps: EngineDependencies = {},
): Promise<EngineResult> {
  const inputError = validateInput(input);
  if (inputError) return { ok: false, error: inputError };

  const tuning = mergeEngineTuning(defaultEngineTuning, ctx.tuningOverride);

  const graph = new TravelGraph(ctx.nodes, ctx.edges);
  const start = graph.getNode(input.start_node);
  if (!start) {
    return {
      ok: false,
      error: invalidInput(`Start node "${input.start_node}" not found.`),
    };
  }

  const requestedEndId = input.end_node ?? input.start_node;
  const end = graph.getNode(requestedEndId);
  if (!end) {
    return {
      ok: false,
      error: invalidInput(`End node "${requestedEndId}" not found.`),
    };
  }

  const cfg = getTravelStyleConfig(input.preferences.travel_style);
  const modes = normaliseModes(input.preferences.transport_modes);
  const allowedRegions = new Set<string>(
    input.regions && input.regions.length > 0 ? input.regions : [input.region],
  );

  const candidates = graph
    .allNodes()
    .filter(
      (node) =>
        node.type === "city" &&
        allowedRegions.has(node.region) &&
        node.id !== start.id &&
        node.id !== end.id,
    );

  const scored = candidates
    .map((node) =>
      scoreCandidateNode(node, start, input.preferences, undefined, tuning),
    )
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
      return left.node.id.localeCompare(right.node.id);
    });

  if (scored.length === 0 && end.id === start.id && input.days > 1) {
    return { ok: false, error: insufficientNodes(0, 1) };
  }

  const maxVisitCount = computeMaxVisitCount({
    days: input.days,
    candidateCount: scored.length,
    cfg,
    hasFixedEnd: end.id !== start.id,
  });
  const poolSize = computeCandidatePoolSize(
    scored.length,
    maxVisitCount,
    tuning,
  );
  const pool = scored.slice(0, poolSize);
  const nodesById = new Map<string, GraphNode>();
  for (const node of ctx.nodes) nodesById.set(node.id, node);

  const matrixResolver = deps.resolveTravelMatrix ?? resolveTravelMatrix;
  const matrix =
    pool.length > 0 || end.id !== start.id
      ? await matrixResolver({
          nodes: uniqueNodes([start, end, ...pool.map((entry) => entry.node)]),
          edges: ctx.edges,
          region: input.region,
          regions: Array.from(allowedRegions),
          modes,
          now: ctx.now,
          tuning,
        })
      : buildTravelMatrix([start], ctx.edges, modes, tuning);

  const selected = selectOptimalRoute({
    start,
    end,
    days: input.days,
    candidates: pool.map((entry) => entry.node),
    cfg,
    preferences: input.preferences,
    matrix,
    nodesById,
    attractionsByCity: ctx.attractionsByCity,
    scoredById: new Map(scored.map((entry) => [entry.node.id, entry.score])),
    maxVisitCount,
    modes,
    tuning,
  });

  if (!selected) return { ok: false, error: noFeasibleRoute() };

  const dayPlanError = validateDayPlan(selected.dayPlan, cfg, modes);
  if (dayPlanError) return { ok: false, error: dayPlanError };

  const budgetError = validateBudget(
    selected.estimatedCost,
    input.preferences.budget,
  );
  if (budgetError) return { ok: false, error: budgetError };

  const derivedBudget = deriveOptimalBudget(
    selected.estimatedCost,
    input.preferences.budget.currency,
  );

  const score = scoreItinerary({
    destinationScores: selected.destinationScores,
    budgetUtilisation: clamp(
      selected.estimatedCost / Math.max(1, derivedBudget.max),
      0,
      1.25,
    ),
    totalTravelHours: selected.totalTravelHours,
    daysAvailable: input.days,
    maxTravelHoursPerDay: cfg.maxTravelHoursPerDay,
  });

  const now = ctx.now?.() ?? Date.now();
  const id = ctx.makeId?.("it") ?? `it_${now.toString(36)}_${randomSuffix()}`;

  const itinerary: Itinerary = {
    id,
    user_id: input.user_id ?? null,
    region: input.region,
    start_node: start.id,
    end_node: end.id,
    days: input.days,
    preferences: {
      ...input.preferences,
      budget: derivedBudget,
    },
    nodes: buildNodeSequence(
      start.id,
      selected.order.map((node) => node.id),
      end.id,
    ),
    day_plan: selected.dayPlan,
    estimated_cost: Math.round(selected.estimatedCost),
    budget_breakdown: {
      line_items: selected.budgetLineItems,
    },
    score: Number(score.toFixed(3)),
    created_at: now,
  };

  return { ok: true, itinerary };
}

function normaliseModes(modes: TransportMode[] | undefined): TransportMode[] {
  if (!modes || modes.length === 0) return ["road"];
  const seen = new Set<TransportMode>();
  const out: TransportMode[] = [];
  for (const mode of modes) {
    if (seen.has(mode)) continue;
    seen.add(mode);
    out.push(mode);
  }
  return out;
}

function selectOptimalRoute(opts: RouteSearchInput): RouteSelection | null {
  const orderedCandidates = [...opts.candidates].sort((left, right) => {
    const scoreDiff =
      (opts.scoredById.get(right.id) ?? 0) -
      (opts.scoredById.get(left.id) ?? 0);
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
    return left.id.localeCompare(right.id);
  });

  let bestOverall: RouteSelection | null = null;
  let bestFeasible: RouteSelection | null = null;
  const route: GraphNode[] = [];
  const visited = new Set<string>();
  const prioritizeCityCoverage =
    opts.preferences.prioritize_city_coverage ?? false;

  const dfs = (cursor: GraphNode, travelHours: number) => {
    if (
      shouldPruneByTravelHours({
        route,
        travelHours,
        bestFeasible,
        prioritizeCityCoverage,
        opts,
      })
    ) {
      return;
    }

    const current = evaluateRoute(route, opts);
    if (current) {
      if (
        !bestOverall ||
        compareRoutes(current, bestOverall, prioritizeCityCoverage) < 0
      ) {
        bestOverall = current;
      }

      if (
        !validateBudget(current.estimatedCost, opts.preferences.budget) &&
        (!bestFeasible ||
          compareRoutes(current, bestFeasible, prioritizeCityCoverage) < 0)
      ) {
        bestFeasible = current;
      }
    }

    if (route.length >= opts.maxVisitCount) return;
    if (computeMinimumDaysForPrefix(route, opts) > opts.days) return;

    for (const candidate of orderedCandidates) {
      if (visited.has(candidate.id)) continue;
      const leg = bestLegFor(cursor.id, candidate.id, opts);
      if (!leg) continue;
      if (
        leg.travel_time_hours >
        modeAwareDailyCap(leg.transport_mode, opts.cfg) + 0.01
      )
        continue;

      route.push(candidate);
      visited.add(candidate.id);

      if (computeMinimumDaysForPrefix(route, opts) <= opts.days) {
        dfs(candidate, travelHours + leg.travel_time_hours);
      }

      visited.delete(candidate.id);
      route.pop();
    }
  };

  dfs(opts.start, 0);
  return bestFeasible ?? bestOverall;
}

function shouldPruneByTravelHours(args: {
  route: GraphNode[];
  travelHours: number;
  bestFeasible: RouteSelection | null;
  prioritizeCityCoverage: boolean;
  opts: RouteSearchInput;
}): boolean {
  const { bestFeasible } = args;
  if (!bestFeasible || bestFeasible.isFallbackStay) return false;
  if (args.travelHours <= bestFeasible.totalTravelHours + 0.01) return false;
  if (!args.prioritizeCityCoverage) return true;

  return (
    computeMaxPossibleMeaningfulStopCount(args.route, args.opts) <=
    bestFeasible.meaningfulStopCount
  );
}

function evaluateRoute(
  order: GraphNode[],
  opts: RouteSearchInput,
): RouteSelection | null {
  const dayPlan = buildDayPlanForRoute({
    days: opts.days,
    start: opts.start,
    end: opts.end,
    order,
    cfg: opts.cfg,
    matrix: opts.matrix,
    attractionsByCity: opts.attractionsByCity,
    scoredById: opts.scoredById,
    tuning: opts.tuning,
  });
  if (!dayPlan) return null;

  const costEstimate = estimateCost({
    dayPlan,
    nodesById: opts.nodesById,
    matrix: opts.matrix,
  });

  const destinationScores = buildDestinationScores(order, opts);
  const travelHours = sum(dayPlan.map((day) => day.total_travel_hours));
  const travelDistance = sum(
    dayPlan.map((day) => day.travel?.distance_km ?? 0),
  );
  const fatigueHours = sum(
    dayPlan.map((day) => {
      if (!day.travel) return 0;
      const leg = opts.matrix.get(
        day.travel.from_node_id,
        day.travel.to_node_id,
        day.travel.transport_mode,
      );
      if (!leg) return day.travel.travel_time_hours;
      const factor = Number(leg.metadata?.fatigue_factor ?? 1);
      return day.travel.travel_time_hours * factor;
    }),
  );
  const meaningfulStops = getMeaningfulStops(order, opts.start, opts.end);

  return {
    order: [...order],
    dayPlan,
    estimatedCost: costEstimate.totalCost,
    budgetLineItems: costEstimate.lineItems,
    totalTravelHours: travelHours,
    totalTravelDistance: travelDistance,
    totalFatigueHours: fatigueHours,
    meaningfulStopCount: meaningfulStops.length,
    destinationScores,
    experienceScore: computeExperienceScore(meaningfulStops, destinationScores),
    fatiguePenalty: computeFatiguePenalty(dayPlan, opts.cfg, fatigueHours),
    isFallbackStay:
      order.length === 0 &&
      opts.start.id === opts.end.id &&
      opts.candidates.length > 0,
  };
}

function buildDayPlanForRoute(args: {
  days: number;
  start: GraphNode;
  end: GraphNode;
  order: GraphNode[];
  cfg: ReturnType<typeof getTravelStyleConfig>;
  matrix: TravelMatrix;
  attractionsByCity?: Map<string, GraphNode[]>;
  scoredById: Map<string, number>;
  tuning: EngineTuning;
}): ItineraryDay[] | null {
  const stays = buildStaySpecs({
    start: args.start,
    end: args.end,
    order: args.order,
    cfg: args.cfg,
    matrix: args.matrix,
    attractionsByCity: args.attractionsByCity,
    scoredById: args.scoredById,
    tuning: args.tuning,
  });
  if (!stays) return null;

  const allocations = stays.map((stay) => minimumDaysForStay(stay, args.cfg));
  if (allocations.some((days) => days === null)) return null;

  const daysPerStay = allocations.map((days) => days ?? 0);
  let usedDays = sum(daysPerStay);
  if (usedDays > args.days) return null;

  while (usedDays < args.days) {
    const target = chooseExtraDayRecipient(stays, daysPerStay, args.cfg);
    daysPerStay[target] += 1;
    usedDays += 1;
  }

  const dayPlan: ItineraryDay[] = [];
  let dayIndex = 0;

  for (let i = 0; i < stays.length; i += 1) {
    const stay = stays[i];
    const dayCaps = buildDayCapacities(stay, daysPerStay[i], args.cfg);
    const targetHours = Math.min(
      sum(dayCaps),
      Math.max(stay.requiredHours, stay.desiredHours),
    );
    const activitiesByDay = distributeStopActivities({
      base: stay.base,
      dayCaps,
      targetHours,
      attractions: args.attractionsByCity?.get(stay.base.id) ?? [],
      arrivalTravelHours: stay.arrivalLeg?.travel_time_hours ?? 0,
      forceNonEmpty: stay.role !== "return_home",
      tuning: args.tuning,
    });

    for (let dayOffset = 0; dayOffset < dayCaps.length; dayOffset += 1) {
      const arrival = dayOffset === 0 ? stay.arrivalLeg : null;
      const activities = activitiesByDay[dayOffset] ?? [];
      const totalActivityHours = sum(
        activities.map((activity) => activity.duration_hours),
      );
      const totalTravelHours = arrival?.travel_time_hours ?? 0;

      dayPlan.push({
        day_index: dayIndex,
        base_node_id: stay.base.id,
        base_node_name: stay.base.name,
        travel: arrival
          ? {
              from_node_id: arrival.from_node_id,
              to_node_id: arrival.to_node_id,
              transport_mode: arrival.transport_mode,
              distance_km: Number(arrival.distance_km.toFixed(1)),
              travel_time_hours: Number(arrival.travel_time_hours.toFixed(2)),
            }
          : undefined,
        activities,
        total_activity_hours: Number(totalActivityHours.toFixed(2)),
        total_travel_hours: Number(totalTravelHours.toFixed(2)),
      });

      dayIndex += 1;
    }
  }

  if (dayPlan.length !== args.days) return null;
  return dayPlan;
}

function buildStaySpecs(args: {
  start: GraphNode;
  end: GraphNode;
  order: GraphNode[];
  cfg: ReturnType<typeof getTravelStyleConfig>;
  matrix: TravelMatrix;
  attractionsByCity?: Map<string, GraphNode[]>;
  scoredById: Map<string, number>;
  tuning: EngineTuning;
}): StaySpec[] | null {
  if (args.order.length === 0) {
    if (args.end.id === args.start.id) {
      return [
        createStaySpec({
          base: args.start,
          role: "staycation",
          arrivalLeg: null,
          cfg: args.cfg,
          attractionsByCity: args.attractionsByCity,
          scoreWeight: 0.35,
          tuning: args.tuning,
        }),
      ];
    }

    const arrival = args.matrix.get(args.start.id, args.end.id);
    if (
      !arrival ||
      arrival.travel_time_hours >
        modeAwareDailyCap(arrival.transport_mode, args.cfg) + 0.01
    ) {
      return null;
    }

    return [
      createStaySpec({
        base: args.end,
        role: "destination",
        arrivalLeg: arrival,
        cfg: args.cfg,
        attractionsByCity: args.attractionsByCity,
        scoreWeight: args.scoredById.get(args.end.id) ?? 0.45,
        tuning: args.tuning,
      }),
    ];
  }

  const stays: StaySpec[] = [];
  let previous = args.start;

  for (const stop of args.order) {
    const arrival = args.matrix.get(previous.id, stop.id);
    if (
      !arrival ||
      arrival.travel_time_hours >
        modeAwareDailyCap(arrival.transport_mode, args.cfg) + 0.01
    ) {
      return null;
    }

    stays.push(
      createStaySpec({
        base: stop,
        role: "visit",
        arrivalLeg: arrival,
        cfg: args.cfg,
        attractionsByCity: args.attractionsByCity,
        scoreWeight: args.scoredById.get(stop.id) ?? 0.45,
        tuning: args.tuning,
      }),
    );
    previous = stop;
  }

  if (args.end.id !== previous.id) {
    const arrival = args.matrix.get(previous.id, args.end.id);
    if (
      !arrival ||
      arrival.travel_time_hours >
        modeAwareDailyCap(arrival.transport_mode, args.cfg) + 0.01
    ) {
      return null;
    }

    stays.push(
      createStaySpec({
        base: args.end,
        role: args.end.id === args.start.id ? "return_home" : "destination",
        arrivalLeg: arrival,
        cfg: args.cfg,
        attractionsByCity: args.attractionsByCity,
        scoreWeight: args.scoredById.get(args.end.id) ?? 0.35,
        tuning: args.tuning,
      }),
    );
  }

  return stays;
}

function createStaySpec(args: {
  base: GraphNode;
  role: StayRole;
  arrivalLeg: ResolvedTravelLeg | null;
  cfg: ReturnType<typeof getTravelStyleConfig>;
  attractionsByCity?: Map<string, GraphNode[]>;
  scoreWeight: number;
  tuning: EngineTuning;
}): StaySpec {
  const requiredHours =
    args.role === "visit" || args.role === "destination"
      ? args.cfg.minHoursPerStop
      : 0;

  return {
    base: args.base,
    arrivalLeg: args.arrivalLeg,
    role: args.role,
    requiredHours,
    desiredHours: Math.max(
      requiredHours,
      computeDesiredStopHours(args.base, args.attractionsByCity, args.tuning),
    ),
    scoreWeight: args.scoreWeight,
  };
}

function computeMinimumDaysForPrefix(
  order: GraphNode[],
  opts: RouteSearchInput,
): number {
  if (order.length === 0) return 0;

  let previous = opts.start;
  let total = 0;

  for (const stop of order) {
    const arrival = bestLegFor(previous.id, stop.id, opts);
    if (
      !arrival ||
      arrival.travel_time_hours >
        modeAwareDailyCap(arrival.transport_mode, opts.cfg) + 0.01
    ) {
      return Number.POSITIVE_INFINITY;
    }

    const stay = createStaySpec({
      base: stop,
      role: "visit",
      arrivalLeg: arrival,
      cfg: opts.cfg,
      attractionsByCity: opts.attractionsByCity,
      scoreWeight: opts.scoredById.get(stop.id) ?? 0.45,
      tuning: opts.tuning,
    });
    const minDays = minimumDaysForStay(stay, opts.cfg);
    if (!minDays) return Number.POSITIVE_INFINITY;

    total += minDays;
    previous = stop;
  }

  return total;
}

function computeMaxPossibleMeaningfulStopCount(
  order: GraphNode[],
  opts: RouteSearchInput,
): number {
  const minDaysUsed = computeMinimumDaysForPrefix(order, opts);
  if (!Number.isFinite(minDaysUsed)) {
    return getMeaningfulStops(order, opts.start, opts.end).length;
  }

  const currentStopCount = getMeaningfulStops(
    order,
    opts.start,
    opts.end,
  ).length;
  const remainingDays = Math.max(0, opts.days - minDaysUsed);
  const remainingCandidates = Math.max(
    0,
    opts.candidates.length - order.length,
  );
  const theoreticalMaxStops =
    opts.maxVisitCount + (opts.end.id !== opts.start.id ? 1 : 0);

  // This is intentionally a loose upper bound. If a branch can still
  // plausibly beat the best route on city coverage, we must keep exploring
  // it even when its current travel time is already higher.
  return Math.min(
    theoreticalMaxStops,
    currentStopCount + remainingDays,
    currentStopCount + remainingCandidates,
  );
}

function minimumDaysForStay(
  stay: StaySpec,
  cfg: ReturnType<typeof getTravelStyleConfig>,
): number | null {
  const travelHours = stay.arrivalLeg?.travel_time_hours ?? 0;
  const mode = stay.arrivalLeg?.transport_mode ?? "road";
  if (travelHours > modeAwareDailyCap(mode, cfg) + 0.01) return null;

  const arrivalCapacity = activityCapacity(travelHours, cfg);
  const fullCapacity = activityCapacity(0, cfg);

  if (stay.requiredHours <= 0) return 1;
  if (arrivalCapacity + 0.01 >= stay.requiredHours) return 1;
  if (fullCapacity <= 0.01) return null;

  return 1 + Math.ceil((stay.requiredHours - arrivalCapacity) / fullCapacity);
}

function chooseExtraDayRecipient(
  stays: StaySpec[],
  daysPerStay: number[],
  cfg: ReturnType<typeof getTravelStyleConfig>,
): number {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < stays.length; i += 1) {
    const stay = stays[i];
    const currentCapacity = totalCapacityForStay(stay, daysPerStay[i], cfg);
    let desirability =
      Math.max(0, stay.desiredHours - currentCapacity) + stay.scoreWeight * 6;

    if (stay.role === "return_home") desirability -= 4;
    if (stay.role === "staycation" && stays.length > 1) desirability -= 2;
    desirability -= daysPerStay[i] * 0.05;

    if (desirability > bestScore + 1e-9) {
      bestScore = desirability;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function buildDayCapacities(
  stay: StaySpec,
  days: number,
  cfg: ReturnType<typeof getTravelStyleConfig>,
): number[] {
  const out: number[] = [];
  for (let day = 0; day < days; day += 1) {
    const travelHours =
      day === 0 ? (stay.arrivalLeg?.travel_time_hours ?? 0) : 0;
    out.push(activityCapacity(travelHours, cfg));
  }
  return out;
}

function distributeStopActivities(args: {
  base: GraphNode;
  dayCaps: number[];
  targetHours: number;
  attractions: GraphNode[];
  arrivalTravelHours: number;
  forceNonEmpty: boolean;
  tuning: EngineTuning;
}): ItineraryActivity[][] {
  const orderedAttractions = [...args.attractions].sort((left, right) => {
    const hoursDiff =
      Number(
        right.metadata.recommended_hours ?? args.tuning.defaultAttractionHours,
      ) -
      Number(
        left.metadata.recommended_hours ?? args.tuning.defaultAttractionHours,
      );
    if (Math.abs(hoursDiff) > 1e-9) return hoursDiff;
    return left.id.localeCompare(right.id);
  });

  const plan = args.dayCaps.map(() => [] as ItineraryActivity[]);
  let remainingTarget = args.targetHours;
  let attractionIndex = 0;

  for (let dayIndex = 0; dayIndex < args.dayCaps.length; dayIndex += 1) {
    let remainingCapacity = args.dayCaps[dayIndex];

    while (remainingCapacity > 0.75 && remainingTarget > 0.25) {
      const attraction = orderedAttractions[attractionIndex];
      const maxBlock = Math.min(remainingCapacity, remainingTarget);

      if (attraction) {
        const duration = Math.max(
          1,
          Math.min(
            Number(
              attraction.metadata.recommended_hours ??
                args.tuning.defaultAttractionHours,
            ),
            maxBlock,
          ),
        );
        plan[dayIndex].push(toActivity(attraction, duration));
        remainingCapacity -= duration;
        remainingTarget -= duration;
        attractionIndex += 1;
        continue;
      }

      const duration = Math.max(1, maxBlock);
      plan[dayIndex].push(
        makeExploreActivity(
          args.base,
          duration,
          dayIndex === 0 && args.arrivalTravelHours > 0,
        ),
      );
      remainingCapacity -= duration;
      remainingTarget -= duration;
    }

    if (
      plan[dayIndex].length === 0 &&
      args.forceNonEmpty &&
      args.dayCaps[dayIndex] > 1
    ) {
      const filler = Math.min(
        args.dayCaps[dayIndex],
        dayIndex === 0 && args.arrivalTravelHours > 0 ? 2.5 : 3.5,
      );
      plan[dayIndex].push(
        makeExploreActivity(
          args.base,
          filler,
          dayIndex === 0 && args.arrivalTravelHours > 0,
        ),
      );
    }
  }

  return plan;
}

function toActivity(node: GraphNode, duration: number): ItineraryActivity {
  return {
    node_id: node.id,
    name: node.name,
    type: node.type,
    duration_hours: Number(duration.toFixed(2)),
    tags: node.tags,
    description: node.metadata.description as string | undefined,
  };
}

function makeExploreActivity(
  base: GraphNode,
  duration: number,
  isArrivalDay: boolean,
): ItineraryActivity {
  return {
    node_id: base.id,
    name: `Explore ${base.name}`,
    type: base.type,
    duration_hours: Number(Math.min(duration, isArrivalDay ? 3 : 6).toFixed(2)),
    tags: base.tags,
    description: base.metadata.description as string | undefined,
  };
}

function buildDestinationScores(
  order: GraphNode[],
  opts: RouteSearchInput,
): number[] {
  if (order.length > 0) {
    return order.map(
      (node) =>
        opts.scoredById.get(node.id) ??
        scoreCandidateNode(
          node,
          opts.start,
          opts.preferences,
          undefined,
          opts.tuning,
        ).score,
    );
  }

  if (opts.end.id !== opts.start.id) {
    return [
      scoreCandidateNode(
        opts.end,
        opts.start,
        opts.preferences,
        undefined,
        opts.tuning,
      ).score,
    ];
  }

  return [0.4];
}

function getMeaningfulStops(
  order: GraphNode[],
  start: GraphNode,
  end: GraphNode,
): GraphNode[] {
  if (order.length > 0) return order;
  if (end.id !== start.id) return [end];
  return [];
}

function computeExperienceScore(
  stops: GraphNode[],
  destinationScores: number[],
): number {
  const avgDestinationScore =
    destinationScores.length > 0 ? average(destinationScores) : 0.4;
  const uniqueTags = new Set<string>();

  for (const stop of stops) {
    for (const tag of stop.tags) uniqueTags.add(tag.toLowerCase());
  }

  const diversity =
    stops.length > 0
      ? clamp(uniqueTags.size / Math.max(1, stops.length * 3), 0, 1)
      : 0;

  return avgDestinationScore + 0.12 * diversity + 0.05 * stops.length;
}

function computeFatiguePenalty(
  dayPlan: ItineraryDay[],
  cfg: ReturnType<typeof getTravelStyleConfig>,
  fatigueHours: number,
): number {
  const moveDays = dayPlan.filter((day) => day.travel).length;
  const heavyTravelDays = dayPlan.filter(
    (day) => day.total_travel_hours > cfg.maxTravelHoursPerDay * 0.75,
  ).length;
  const averageMoveDayTravel =
    moveDays > 0
      ? sum(dayPlan.map((day) => day.total_travel_hours)) / moveDays
      : 0;

  return (
    moveDays +
    heavyTravelDays * 0.5 +
    averageMoveDayTravel / 10 +
    fatigueHours / 15
  );
}

function compareRoutes(
  left: RouteSelection,
  right: RouteSelection,
  prioritizeCityCoverage = false,
): number {
  if (left.isFallbackStay !== right.isFallbackStay) {
    return left.isFallbackStay ? 1 : -1;
  }

  if (
    prioritizeCityCoverage &&
    left.meaningfulStopCount !== right.meaningfulStopCount
  ) {
    return right.meaningfulStopCount - left.meaningfulStopCount;
  }

  const travelHours = compareNumbers(
    left.totalTravelHours,
    right.totalTravelHours,
    0.01,
  );
  if (travelHours !== 0) return travelHours;

  const travelDistance = compareNumbers(
    left.totalTravelDistance,
    right.totalTravelDistance,
    0.1,
  );
  if (travelDistance !== 0) return travelDistance;

  const experience = compareNumbers(
    right.experienceScore,
    left.experienceScore,
    0.001,
  );
  if (experience !== 0) return experience;

  const fatigue = compareNumbers(
    left.fatiguePenalty,
    right.fatiguePenalty,
    0.001,
  );
  if (fatigue !== 0) return fatigue;

  const cost = compareNumbers(left.estimatedCost, right.estimatedCost, 1);
  if (cost !== 0) return cost;

  return compareNodeOrders(left.order, right.order);
}

function estimateCost(args: {
  dayPlan: ItineraryDay[];
  nodesById: Map<string, GraphNode>;
  matrix: TravelMatrix;
}): {
  totalCost: number;
  lineItems: ItineraryBudgetLineItem[];
} {
  let totalCost = 0;
  const lineItems: ItineraryBudgetLineItem[] = [];

  for (const day of args.dayPlan) {
    const node = args.nodesById.get(day.base_node_id);
    const stayCost = Number(node?.metadata.avg_daily_cost ?? 0);
    if (stayCost > 0) {
      lineItems.push({
        id: `stay_${day.day_index}_${day.base_node_id}`,
        day_index: day.day_index,
        kind: "stay",
        label: `Stay in ${day.base_node_name}`,
        amount: Number(stayCost.toFixed(2)),
      });
      totalCost += stayCost;
    }

    if (!day.travel) continue;
    const leg = args.matrix.get(
      day.travel.from_node_id,
      day.travel.to_node_id,
      day.travel.transport_mode,
    );
    const explicit = Number(leg?.metadata?.estimated_cost ?? 0);
    const base = Number(leg?.metadata?.base_price ?? 0);
    const fallback =
      day.travel.distance_km * defaultPerKmCost(day.travel.transport_mode);
    const travelCost = explicit > 0 ? explicit : base > 0 ? base : fallback;
    const fromName =
      args.nodesById.get(day.travel.from_node_id)?.name ?? "Previous stop";
    const toName =
      args.nodesById.get(day.travel.to_node_id)?.name ?? day.base_node_name;

    if (travelCost > 0) {
      lineItems.push({
        id: `travel_${day.day_index}_${day.travel.from_node_id}_${day.travel.to_node_id}_${day.travel.transport_mode}`,
        day_index: day.day_index,
        kind: "travel",
        label: `${fromName} to ${toName} by ${titleCase(day.travel.transport_mode)}`,
        amount: Number(travelCost.toFixed(2)),
      });
      totalCost += travelCost;
    }
  }

  return { totalCost, lineItems };
}

function computeDesiredStopHours(
  base: GraphNode,
  attractionsByCity: Map<string, GraphNode[]> | undefined,
  tuning: EngineTuning,
): number {
  const baseHours = Number(base.metadata.recommended_hours ?? 0);
  const attractionHours = sum(
    (attractionsByCity?.get(base.id) ?? []).map((attraction) =>
      Number(
        attraction.metadata.recommended_hours ?? tuning.defaultAttractionHours,
      ),
    ),
  );

  return Math.max(tuning.defaultStopHours, baseHours, attractionHours);
}

function computeCandidatePoolSize(
  totalCandidates: number,
  maxVisitCount: number,
  tuning: EngineTuning,
): number {
  if (maxVisitCount <= 0) return 0;
  const lower = Math.max(tuning.poolSize.min, 1);
  const upper = Math.max(lower, tuning.poolSize.max);
  return Math.min(
    totalCandidates,
    Math.max(
      lower,
      Math.min(upper, maxVisitCount * tuning.poolSize.multiplier),
    ),
  );
}

function computeMaxVisitCount(args: {
  days: number;
  candidateCount: number;
  cfg: ReturnType<typeof getTravelStyleConfig>;
  hasFixedEnd: boolean;
}): number {
  if (args.candidateCount === 0 || args.days <= 0) return 0;

  const fullDayCapacity = activityCapacity(0, args.cfg);
  const minDaysPerStop = Math.max(
    1,
    Math.ceil(args.cfg.minHoursPerStop / Math.max(1, fullDayCapacity)),
  );
  const reservedEndDays = args.hasFixedEnd ? minDaysPerStop : 0;
  const availableDays = Math.max(0, args.days - reservedEndDays);

  return Math.min(
    args.candidateCount,
    Math.floor(availableDays / Math.max(1, minDaysPerStop)),
  );
}

function activityCapacity(
  travelHours: number,
  cfg: ReturnType<typeof getTravelStyleConfig>,
): number {
  return (
    Math.max(0, cfg.maxTotalHoursPerDay - travelHours) * cfg.activityFillRatio
  );
}

function totalCapacityForStay(
  stay: StaySpec,
  days: number,
  cfg: ReturnType<typeof getTravelStyleConfig>,
): number {
  if (days <= 0) return 0;
  const firstDay = activityCapacity(
    stay.arrivalLeg?.travel_time_hours ?? 0,
    cfg,
  );
  const fullDay = activityCapacity(0, cfg);
  return firstDay + Math.max(0, days - 1) * fullDay;
}

function bestLegFor(
  fromId: string,
  toId: string,
  opts: RouteSearchInput,
): ResolvedTravelLeg | null {
  const options = opts.matrix.getAll(fromId, toId);
  if (options.length === 0) return null;
  // Options are sorted by `leg_score`, so the first one passing the per-mode
  // daily cap wins. Falling back to the mode-agnostic best preserves
  // previous behaviour when every option exceeds the cap.
  for (const option of options) {
    if (
      option.travel_time_hours <=
      modeAwareDailyCap(option.transport_mode, opts.cfg) + 0.01
    ) {
      return option;
    }
  }
  return options[0];
}

function modeAwareDailyCap(
  mode: TransportMode,
  cfg: ReturnType<typeof getTravelStyleConfig>,
): number {
  return maxDailyHoursFor(mode, cfg.maxTravelHoursPerDay);
}

function buildNodeSequence(
  startId: string,
  orderIds: string[],
  endId: string,
): string[] {
  const raw = [startId, ...orderIds, endId];
  const deduped: string[] = [];

  for (const id of raw) {
    if (deduped[deduped.length - 1] === id) continue;
    deduped.push(id);
  }

  return deduped;
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  const seen = new Set<string>();
  const out: GraphNode[] = [];

  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
  }

  return out;
}

function compareNodeOrders(left: GraphNode[], right: GraphNode[]): number {
  const leftKey = left.map((node) => node.id).join(">");
  const rightKey = right.map((node) => node.id).join(">");
  return leftKey.localeCompare(rightKey);
}

function compareNumbers(left: number, right: number, epsilon: number): number {
  if (left < right - epsilon) return -1;
  if (left > right + epsilon) return 1;
  return 0;
}

function average(values: number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function invalidInput(message: string): ConstraintError {
  return {
    error: "constraint_violation",
    reason: "invalid_input",
    message,
  };
}

function randomSuffix(): string {
  const fallback = Math.random().toString(36).slice(2, 10);
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${fallback}-${Date.now().toString(36)}`;
  return uuid.replace(/-/g, "").slice(0, 12);
}

function titleCase(s: string): string {
  return s
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Unused type export kept so downstream imports of `PreferenceTag` from
// this module still type-check.
export type { PreferenceTag };
