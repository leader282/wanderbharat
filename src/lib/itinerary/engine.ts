import type {
  AttractionAdmissionAudience,
  AttractionAdmissionNationality,
  AttractionAdmissionRule,
  AttractionOpeningHours,
  ConstraintError,
  GenerateItineraryInput,
  GraphEdge,
  GraphNode,
  Itinerary,
  ItineraryBudgetLineItem,
  ItineraryBudgetLineItemProvenance,
  ItineraryActivity,
  ItineraryDay,
  LocalDateString,
  OpeningHoursConfidence,
  OpeningPeriod,
  OpeningTimeRange,
  OpeningHoursWeekday,
  PreferenceTag,
  TravellerComposition,
  TransportMode,
} from "@/types/domain";
import {
  DEFAULT_CURRENCY,
  DEFAULT_GUEST_NATIONALITY,
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
  requestedCitiesUncovered,
  validateBudget,
  validateDayPlan,
  validateInput,
} from "@/lib/itinerary/constraints";
import { deriveOptimalBudget } from "@/lib/itinerary/budget";
import {
  MAX_TRIP_DAYS,
  normaliseTravellers,
  totalTravellers,
} from "@/lib/itinerary/planningLimits";
import { isDayScheduleFeasible } from "@/lib/itinerary/daySchedule";

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
  requestedNodeIds: Set<string>;
  preferredStartTime?: string;
  tripStartDate?: LocalDateString;
  travellers: TravellerComposition;
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
  requestedCoverageCount: number;
  attractionSubtotal: number;
  verifiedAttractionCostsCount: number;
  estimatedAttractionCostsCount: number;
  unknownAttractionCostsCount: number;
  warnings: string[];
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

interface ResolvedOpeningHoursForDay {
  state: "known" | "closed" | "unknown";
  periods: OpeningTimeRange[];
  confidence: OpeningHoursConfidence;
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
  const allowedRegions = new Set<string>(input.regions);
  const travellers = normaliseTravellers(input.preferences.travellers);
  const requestedNodeIds = new Set<string>();

  for (const cityId of input.requested_city_ids ?? []) {
    if (!cityId || cityId === start.id || cityId === end.id) continue;
    const requestedNode = graph.getNode(cityId);
    if (!requestedNode) {
      return {
        ok: false,
        error: invalidInput(`Requested city "${cityId}" not found.`),
      };
    }
    if (requestedNode.type !== "city") {
      return {
        ok: false,
        error: invalidInput(
          `Requested city "${requestedNode.name}" is not a plannable city node.`,
        ),
      };
    }
    if (!allowedRegions.has(requestedNode.region)) {
      return {
        ok: false,
        error: invalidInput(
          `Requested city "${requestedNode.name}" is outside the selected planning regions.`,
        ),
      };
    }
    requestedNodeIds.add(requestedNode.id);
  }

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
  const requestedPool = scored.filter((entry) => requestedNodeIds.has(entry.node.id));
  const pool = uniqueScoredNodes([...scored.slice(0, poolSize), ...requestedPool]);
  const nodesById = new Map<string, GraphNode>();
  for (const node of ctx.nodes) nodesById.set(node.id, node);

  const matrixResolver = deps.resolveTravelMatrix ?? resolveTravelMatrix;
  const matrix =
    pool.length > 0 || end.id !== start.id
      ? await matrixResolver({
          nodes: uniqueNodes([start, end, ...pool.map((entry) => entry.node)]),
          edges: ctx.edges,
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
    requestedNodeIds,
    preferredStartTime: input.preferences.preferred_start_time,
    tripStartDate: input.preferences.trip_start_date,
    travellers,
  });

  if (!selected) return { ok: false, error: noFeasibleRoute() };

  const missingRequestedCityIds = Array.from(requestedNodeIds).filter(
    (cityId) => !selected.order.some((node) => node.id === cityId),
  );
  if (missingRequestedCityIds.length > 0) {
    const requiredDays = estimateRequiredDaysForRequestedCities({
      currentDays: input.days,
      maxDays: MAX_TRIP_DAYS,
      base: {
        start,
        end,
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
        requestedNodeIds,
        preferredStartTime: input.preferences.preferred_start_time,
        tripStartDate: input.preferences.trip_start_date,
        travellers,
      },
    });

    return {
      ok: false,
      error: requestedCitiesUncovered({
        missingCityIds: missingRequestedCityIds,
        missingCityNames: missingRequestedCityIds.map(
          (cityId) => nodesById.get(cityId)?.name ?? cityId,
        ),
        currentDays: input.days,
        requiredDays,
        maxTripDays: MAX_TRIP_DAYS,
      }),
    };
  }

  const dayPlanError = validateDayPlan(selected.dayPlan, cfg, modes);
  if (dayPlanError) return { ok: false, error: dayPlanError };

  if (selected.estimatedCost < input.preferences.budget.min) {
    const budgetFloorError = validateBudget(selected.estimatedCost, {
      min: input.preferences.budget.min,
      max: Number.POSITIVE_INFINITY,
    });
    if (budgetFloorError) return { ok: false, error: budgetFloorError };
  }

  // The route search uses rough per-city stay estimates to rank candidates, but
  // the hard max-budget gate needs to wait until accommodation planning has
  // replaced those placeholders with room-aware totals.
  const derivedBudget = deriveOptimalBudget(
    selected.estimatedCost,
    input.preferences.budget.currency,
  );
  const budgetReferenceMax =
    input.preferences.budget.max > 0
      ? input.preferences.budget.max
      : derivedBudget.max;

  const score = scoreItinerary({
    destinationScores: selected.destinationScores,
    budgetUtilisation: clamp(
      selected.estimatedCost / Math.max(1, budgetReferenceMax),
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
    region: input.regions[0],
    start_node: start.id,
    end_node: end.id,
    days: input.days,
    preferences: {
      ...input.preferences,
      travellers,
    },
    nodes: buildNodeSequence(
      start.id,
      selected.order.map((node) => node.id),
      end.id,
    ),
    day_plan: selected.dayPlan,
    stays: [],
    estimated_cost: Math.round(selected.estimatedCost),
    budget_breakdown: {
      line_items: selected.budgetLineItems,
      attractionSubtotal: selected.attractionSubtotal,
      verifiedAttractionCostsCount: selected.verifiedAttractionCostsCount,
      estimatedAttractionCostsCount: selected.estimatedAttractionCostsCount,
      unknownAttractionCostsCount: selected.unknownAttractionCostsCount,
      requestedBudget: input.preferences.budget,
      recommendedBudget: derivedBudget,
    },
    warnings: selected.warnings.length > 0 ? selected.warnings : undefined,
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
  return opts.requestedNodeIds.size > 0 ? bestOverall : bestFeasible ?? bestOverall;
}

function shouldPruneByTravelHours(args: {
  route: GraphNode[];
  travelHours: number;
  bestFeasible: RouteSelection | null;
  prioritizeCityCoverage: boolean;
  opts: RouteSearchInput;
}): boolean {
  const { bestFeasible } = args;
  if (args.opts.requestedNodeIds.size > 0) return false;
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
  const dayPlanResult = buildDayPlanForRoute({
    days: opts.days,
    start: opts.start,
    end: opts.end,
    order,
    cfg: opts.cfg,
    matrix: opts.matrix,
    attractionsByCity: opts.attractionsByCity,
    scoredById: opts.scoredById,
    tuning: opts.tuning,
    preferredStartTime: opts.preferredStartTime,
    tripStartDate: opts.tripStartDate,
  });
  if (!dayPlanResult) return null;
  const dayPlan = dayPlanResult.dayPlan;

  const costEstimate = estimateCost({
    dayPlan,
    nodesById: opts.nodesById,
    matrix: opts.matrix,
    travellers: opts.travellers,
    tripStartDate: opts.tripStartDate,
    currency:
      opts.preferences.budget.currency?.trim().toUpperCase() ||
      DEFAULT_CURRENCY,
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
    requestedCoverageCount: countRequestedCoverage(order, opts.requestedNodeIds),
    attractionSubtotal: costEstimate.attractionSubtotal,
    verifiedAttractionCostsCount: costEstimate.verifiedAttractionCostsCount,
    estimatedAttractionCostsCount: costEstimate.estimatedAttractionCostsCount,
    unknownAttractionCostsCount: costEstimate.unknownAttractionCostsCount,
    warnings: dedupeStrings([...dayPlanResult.warnings, ...costEstimate.warnings]),
  };
}

interface DayPlanBuildResult {
  dayPlan: ItineraryDay[];
  warnings: string[];
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
  preferredStartTime?: string;
  tripStartDate?: LocalDateString;
}): DayPlanBuildResult | null {
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
  const warnings = new Set<string>();
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
      startTime: args.preferredStartTime,
      maxTotalHoursPerDay: args.cfg.maxTotalHoursPerDay,
      tripStartDate: args.tripStartDate,
      startDayIndex: dayIndex,
      warnings,
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
  return {
    dayPlan,
    warnings: Array.from(warnings),
  };
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
  startTime?: string;
  maxTotalHoursPerDay: number;
  tripStartDate?: LocalDateString;
  startDayIndex: number;
  warnings: Set<string>;
}): ItineraryActivity[][] {
  const plan = args.dayCaps.map(() => [] as ItineraryActivity[]);
  const remainingAttractions = [...args.attractions];
  let remainingTarget = args.targetHours;

  for (let dayIndex = 0; dayIndex < args.dayCaps.length; dayIndex += 1) {
    let remainingCapacity = args.dayCaps[dayIndex];
    const dayDate = addDaysToLocalDate(
      args.tripStartDate,
      args.startDayIndex + dayIndex,
    );

    // Surface a single warning per day listing attractions that are closed on
    // this date. The placement loop also rejects them via the day-schedule
    // feasibility check, but we want the user to see *why* something they
    // might expect on day N didn't make it onto the plan.
    const closedToday = args.attractions.filter(
      (attraction) =>
        resolveOpeningHoursForAttractionOnDate(attraction, dayDate).state ===
        "closed",
    );
    if (closedToday.length > 0) {
      const dayLabel = `Day ${args.startDayIndex + dayIndex + 1}`;
      const sampleNames = closedToday.slice(0, 3).map((a) => a.name).join(", ");
      const moreSuffix =
        closedToday.length > 3 ? ` and ${closedToday.length - 3} more` : "";
      args.warnings.add(
        `${dayLabel} in ${args.base.name}: ${closedToday.length} attraction${
          closedToday.length === 1 ? "" : "s"
        } closed (${sampleNames}${moreSuffix}).`,
      );
    }

    while (remainingCapacity > 0.75 && remainingTarget > 0.25) {
      const maxBlock = Math.min(remainingCapacity, remainingTarget);
      let placedAttraction = false;
      const orderedAttractions = [...remainingAttractions].sort((left, right) =>
        compareAttractionsForDay(left, right, dayDate, args.tuning),
      );

      for (const attraction of orderedAttractions) {
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
        const resolvedOpeningHours = resolveOpeningHoursForAttractionOnDate(
          attraction,
          dayDate,
        );
        const candidate = toActivity(attraction, duration, resolvedOpeningHours);
        if (
          !canScheduleActivitiesForDay({
            base: args.base,
            dayIndex,
            activities: [...plan[dayIndex], candidate],
            arrivalTravelHours: dayIndex === 0 ? args.arrivalTravelHours : 0,
            startTime: args.startTime,
            maxTotalHoursPerDay: args.maxTotalHoursPerDay,
          })
        ) {
          continue;
        }

        plan[dayIndex].push(candidate);
        remainingCapacity -= duration;
        remainingTarget -= duration;
        const placedIndex = remainingAttractions.findIndex(
          (entry) => entry.id === attraction.id,
        );
        if (placedIndex >= 0) {
          remainingAttractions.splice(placedIndex, 1);
        }
        if (candidate.opening_hours_state === "unknown") {
          args.warnings.add(
            `Opening hours for ${candidate.name} are unknown; scheduled timing may be approximate.`,
          );
        } else if (candidate.opening_hours_confidence === "estimated") {
          args.warnings.add(
            `Opening hours for ${candidate.name} are estimated, not verified — confirm before visiting.`,
          );
        }
        placedAttraction = true;
        break;
      }

      if (placedAttraction) continue;

      const duration = Math.max(1, maxBlock);
      const filler = makeExploreActivity(
        args.base,
        duration,
        dayIndex === 0 && args.arrivalTravelHours > 0,
      );
      if (
        !canScheduleActivitiesForDay({
          base: args.base,
          dayIndex,
          activities: [...plan[dayIndex], filler],
          arrivalTravelHours: dayIndex === 0 ? args.arrivalTravelHours : 0,
          startTime: args.startTime,
          maxTotalHoursPerDay: args.maxTotalHoursPerDay,
        })
      ) {
        break;
      }

      plan[dayIndex].push(filler);
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

function toActivity(
  node: GraphNode,
  duration: number,
  openingHours?: ResolvedOpeningHoursForDay,
): ItineraryActivity {
  // Only surface clock fields when the resolved state is "known". For
  // unknown/closed states we deliberately leave them undefined so the UI
  // never shows a 09:00-18:00 placeholder that came from heuristic
  // metadata. The resolver already promotes legacy `metadata.opening_time`
  // pairs to a known/estimated period, so a real legacy window still flows
  // through `openingHours.periods` here.
  const periods =
    openingHours?.state === "known" && openingHours.periods.length > 0
      ? openingHours.periods
      : undefined;

  return {
    node_id: node.id,
    name: node.name,
    type: node.type,
    duration_hours: Number(duration.toFixed(2)),
    tags: node.tags,
    description: node.metadata.description as string | undefined,
    opening_time: periods?.[0]?.opens,
    closing_time: periods?.[periods.length - 1]?.closes,
    opening_periods: periods,
    opening_hours_state: openingHours?.state ?? undefined,
    opening_hours_confidence: openingHours?.confidence ?? undefined,
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

function canScheduleActivitiesForDay(args: {
  base: GraphNode;
  dayIndex: number;
  activities: ItineraryActivity[];
  arrivalTravelHours: number;
  startTime?: string;
  maxTotalHoursPerDay: number;
}): boolean {
  const totalActivityHours = sum(
    args.activities.map((activity) => activity.duration_hours),
  );

  return isDayScheduleFeasible({
    startTime: args.startTime,
    maxDaySpanHours: args.maxTotalHoursPerDay,
    day: {
      day_index: args.dayIndex,
      base_node_id: args.base.id,
      base_node_name: args.base.name,
      travel:
        args.arrivalTravelHours > 0
          ? {
              from_node_id: args.base.id,
              to_node_id: args.base.id,
              transport_mode: "road",
              distance_km: 0,
              travel_time_hours: args.arrivalTravelHours,
            }
          : undefined,
      activities: args.activities,
      total_activity_hours: Number(totalActivityHours.toFixed(2)),
      total_travel_hours: Number(args.arrivalTravelHours.toFixed(2)),
    },
  });
}

const WEEKDAYS_BY_UTC_INDEX: OpeningHoursWeekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

function compareAttractionsForDay(
  left: GraphNode,
  right: GraphNode,
  dayDate: LocalDateString | undefined,
  tuning: EngineTuning,
): number {
  const leftHours = resolveOpeningHoursForAttractionOnDate(left, dayDate);
  const rightHours = resolveOpeningHoursForAttractionOnDate(right, dayDate);

  const stateDiff =
    openingStatePriority(leftHours.state) - openingStatePriority(rightHours.state);
  if (stateDiff !== 0) return stateDiff;

  const leftClosing = resolveEffectiveClosingMinute(left, leftHours);
  const rightClosing = resolveEffectiveClosingMinute(right, rightHours);
  if (leftClosing !== rightClosing) return leftClosing - rightClosing;

  const leftOpening = resolveEffectiveOpeningMinute(left, leftHours);
  const rightOpening = resolveEffectiveOpeningMinute(right, rightHours);
  if (leftOpening !== rightOpening) return leftOpening - rightOpening;

  const hoursDiff =
    Number(right.metadata.recommended_hours ?? tuning.defaultAttractionHours) -
    Number(left.metadata.recommended_hours ?? tuning.defaultAttractionHours);
  if (Math.abs(hoursDiff) > 1e-9) return hoursDiff;

  return left.id.localeCompare(right.id);
}

function openingStatePriority(
  state: ResolvedOpeningHoursForDay["state"],
): number {
  switch (state) {
    case "known":
      return 0;
    case "unknown":
      return 1;
    case "closed":
      return 2;
  }
}

function resolveEffectiveOpeningMinute(
  attraction: GraphNode,
  resolved: ResolvedOpeningHoursForDay,
): number {
  if (resolved.periods.length > 0) {
    return Math.min(...resolved.periods.map((period) => toClockMinutes(period.opens)));
  }
  return parseClockValue(attraction.metadata.opening_time as string | undefined, 0);
}

function resolveEffectiveClosingMinute(
  attraction: GraphNode,
  resolved: ResolvedOpeningHoursForDay,
): number {
  if (resolved.periods.length > 0) {
    return Math.min(
      ...resolved.periods.map((period) => toClockMinutes(period.closes)),
    );
  }
  if (resolved.state === "closed") {
    return Number.POSITIVE_INFINITY;
  }
  return parseClockValue(
    attraction.metadata.closing_time as string | undefined,
    Number.POSITIVE_INFINITY,
  );
}

function resolveOpeningHoursForAttractionOnDate(
  attraction: GraphNode,
  dayDate: LocalDateString | undefined,
): ResolvedOpeningHoursForDay {
  const legacyRange = normaliseOpeningRange({
    opens: attraction.metadata.opening_time as string | undefined,
    closes: attraction.metadata.closing_time as string | undefined,
  });
  const schedule = attraction.metadata.opening_hours as
    | AttractionOpeningHours
    | undefined;
  const confidence = schedule?.confidence ?? "unknown";
  if (!schedule) {
    if (legacyRange) {
      return { state: "known", periods: [legacyRange], confidence: "estimated" };
    }
    return { state: "unknown", periods: [], confidence };
  }
  if (!dayDate) {
    if (legacyRange) {
      return { state: "known", periods: [legacyRange], confidence };
    }
    return { state: "unknown", periods: [], confidence };
  }

  if (schedule.confidence === "unknown") {
    return { state: "unknown", periods: [], confidence: schedule.confidence };
  }

  const fromException = resolveExceptionForDate(schedule, dayDate);
  if (fromException) {
    return fromException;
  }

  const weekday = weekdayForLocalDate(dayDate);
  if (!weekday) {
    return { state: "unknown", periods: [], confidence: schedule.confidence };
  }

  const closedDays = new Set(schedule.closed_days ?? []);
  const periods = (schedule.weekly_periods ?? [])
    .filter((period) => period.day === weekday)
    .map((period) => normaliseOpeningRange(period))
    .filter((period): period is OpeningTimeRange => Boolean(period))
    .sort((left, right) => {
      const openDiff = toClockMinutes(left.opens) - toClockMinutes(right.opens);
      if (openDiff !== 0) return openDiff;
      return toClockMinutes(left.closes) - toClockMinutes(right.closes);
    });

  if (periods.length > 0) {
    return { state: "known", periods, confidence: schedule.confidence };
  }
  if (closedDays.has(weekday)) {
    return { state: "closed", periods: [], confidence: schedule.confidence };
  }

  return { state: "unknown", periods: [], confidence: schedule.confidence };
}

function resolveExceptionForDate(
  schedule: AttractionOpeningHours,
  dayDate: LocalDateString,
): ResolvedOpeningHoursForDay | null {
  if (!Array.isArray(schedule.exceptions) || schedule.exceptions.length === 0) {
    return null;
  }

  const entry = schedule.exceptions.find((exception) => exception.date === dayDate);
  if (!entry) return null;

  if (entry.closed) {
    return { state: "closed", periods: [], confidence: schedule.confidence };
  }

  const range = normaliseOpeningRange(entry);
  if (range) {
    return {
      state: "known",
      periods: [range],
      confidence: schedule.confidence,
    };
  }

  return { state: "unknown", periods: [], confidence: schedule.confidence };
}

function normaliseOpeningRange(
  period: Pick<OpeningPeriod, "opens" | "closes"> | { opens?: string; closes?: string },
): OpeningTimeRange | null {
  const opens = normaliseClock(period.opens);
  const closes = normaliseClock(period.closes);
  if (!opens || !closes) return null;
  if (toClockMinutes(opens) >= toClockMinutes(closes)) return null;
  return { opens, closes };
}

function normaliseClock(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed) ? trimmed : null;
}

function toClockMinutes(clock: string): number {
  const [hours, minutes] = clock.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

function weekdayForLocalDate(
  localDate: LocalDateString,
): OpeningHoursWeekday | null {
  const parsed = parseLocalDate(localDate);
  if (!parsed) return null;
  return WEEKDAYS_BY_UTC_INDEX[parsed.getUTCDay()] ?? null;
}

function addDaysToLocalDate(
  localDate: LocalDateString | undefined,
  offsetDays: number,
): LocalDateString | undefined {
  if (!localDate) return undefined;
  const parsed = parseLocalDate(localDate);
  if (!parsed) return undefined;
  parsed.setUTCDate(parsed.getUTCDate() + offsetDays);
  return parsed.toISOString().slice(0, 10);
}

function parseLocalDate(localDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate;
}

function countRequestedCoverage(
  order: GraphNode[],
  requestedNodeIds: Set<string>,
): number {
  if (requestedNodeIds.size === 0) return 0;
  return order.reduce(
    (count, node) => count + (requestedNodeIds.has(node.id) ? 1 : 0),
    0,
  );
}

function estimateRequiredDaysForRequestedCities(args: {
  currentDays: number;
  maxDays: number;
  base: Omit<RouteSearchInput, "days">;
}): number | undefined {
  for (
    let candidateDays = Math.max(args.currentDays + 1, 1);
    candidateDays <= args.maxDays;
    candidateDays += 1
  ) {
    const selection = selectOptimalRoute({
      ...args.base,
      days: candidateDays,
      maxVisitCount: computeMaxVisitCount({
        days: candidateDays,
        candidateCount: args.base.candidates.length,
        cfg: args.base.cfg,
        hasFixedEnd: args.base.end.id !== args.base.start.id,
      }),
    });
    if (!selection) continue;
    const covered = countRequestedCoverage(
      selection.order,
      args.base.requestedNodeIds,
    );
    if (covered === args.base.requestedNodeIds.size) {
      return candidateDays;
    }
  }

  return undefined;
}

function parseClockValue(value: string | undefined, fallback: number): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? "");
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
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
  if (left.requestedCoverageCount !== right.requestedCoverageCount) {
    return right.requestedCoverageCount - left.requestedCoverageCount;
  }

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
  travellers: TravellerComposition;
  tripStartDate?: LocalDateString;
  currency: string;
}): {
  totalCost: number;
  lineItems: ItineraryBudgetLineItem[];
  attractionSubtotal: number;
  verifiedAttractionCostsCount: number;
  estimatedAttractionCostsCount: number;
  unknownAttractionCostsCount: number;
  warnings: string[];
} {
  const travellersCount = totalTravellers(args.travellers);
  const itineraryCurrency =
    args.currency?.trim().toUpperCase() || DEFAULT_CURRENCY;
  let totalCost = 0;
  let attractionSubtotal = 0;
  let verifiedAttractionCostsCount = 0;
  let estimatedAttractionCostsCount = 0;
  let unknownAttractionCostsCount = 0;
  const lineItems: ItineraryBudgetLineItem[] = [];
  const warnings = new Set<string>();

  for (const day of args.dayPlan) {
    const node = args.nodesById.get(day.base_node_id);
    const stayCost =
      Number(node?.metadata.avg_daily_cost ?? 0) * travellersCount;
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

    const dayDate = addDaysToLocalDate(args.tripStartDate, day.day_index);

    if (day.travel) {
      const leg = args.matrix.get(
        day.travel.from_node_id,
        day.travel.to_node_id,
        day.travel.transport_mode,
      );
      const explicit = Number(leg?.metadata?.estimated_cost ?? 0);
      const base = Number(leg?.metadata?.base_price ?? 0);
      const fallback =
        day.travel.distance_km * defaultPerKmCost(day.travel.transport_mode);
      const travelCostPerTraveller =
        explicit > 0 ? explicit : base > 0 ? base : fallback;
      const travelCost = travelCostPerTraveller * travellersCount;
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

    for (const [activityIndex, activity] of day.activities.entries()) {
      const attraction = args.nodesById.get(activity.node_id);
      if (!attraction || attraction.type !== "attraction") continue;
      const rules = Array.isArray(attraction.metadata.admission_rules)
        ? (attraction.metadata.admission_rules as AttractionAdmissionRule[])
        : [];
      const resolvedAdmission = resolveAdmissionForActivity({
        attraction,
        rules,
        travellers: args.travellers,
        dayDate,
        itineraryCurrency,
      });
      for (const warning of resolvedAdmission.warnings) {
        warnings.add(warning);
      }

      if (resolvedAdmission.state === "unknown") {
        unknownAttractionCostsCount += 1;
        warnings.add(
          `Admission costs for ${activity.name} are unknown and excluded from the budget total.`,
        );
        continue;
      }

      if (resolvedAdmission.state === "estimated") {
        estimatedAttractionCostsCount += 1;
      } else {
        verifiedAttractionCostsCount += 1;
      }

      attractionSubtotal += resolvedAdmission.amount;
      totalCost += resolvedAdmission.amount;
      const lineItemProvenance = buildLineItemProvenance(
        resolvedAdmission.contributingRules,
        itineraryCurrency,
      );
      // Always emit verified/estimated line items, even when the amount is
      // zero (free attractions). Otherwise there's no way for downstream
      // UIs to distinguish a verified-free entry from an un-modelled one.
      lineItems.push({
        id: `attraction_${day.day_index}_${activity.node_id}_${activityIndex}`,
        day_index: day.day_index,
        kind: "attraction",
        label:
          resolvedAdmission.state === "estimated"
            ? `${activity.name} admission (estimated)`
            : `${activity.name} admission`,
        amount: Number(resolvedAdmission.amount.toFixed(2)),
        provenance: lineItemProvenance,
      });
    }
  }

  return {
    totalCost,
    lineItems,
    attractionSubtotal: Number(attractionSubtotal.toFixed(2)),
    verifiedAttractionCostsCount,
    estimatedAttractionCostsCount,
    unknownAttractionCostsCount,
    warnings: Array.from(warnings),
  };
}

interface ResolvedAdmission {
  state: "verified" | "estimated" | "unknown";
  amount: number;
  warnings: string[];
  contributingRules: AttractionAdmissionRule[];
}

function resolveAdmissionForActivity(args: {
  attraction: GraphNode;
  rules: AttractionAdmissionRule[];
  travellers: TravellerComposition;
  dayDate?: LocalDateString;
  itineraryCurrency: string;
}): ResolvedAdmission {
  const warnings: string[] = [];
  if (args.rules.length === 0) {
    return { state: "unknown", amount: 0, warnings, contributingRules: [] };
  }

  // Treat any rule whose currency disagrees with the itinerary's currency
  // as untrustworthy: silently mixing currencies in a sum is a budget-honesty
  // bug, not a localisation concern. Surface it as a warning so admins can
  // re-quote the rule in the right currency.
  const currencyMatchedRules = args.rules.filter(
    (rule) => rule.currency === args.itineraryCurrency,
  );
  const mismatchedCurrencies = new Set<string>();
  for (const rule of args.rules) {
    if (rule.currency !== args.itineraryCurrency) {
      mismatchedCurrencies.add(rule.currency);
    }
  }
  if (mismatchedCurrencies.size > 0 && currencyMatchedRules.length === 0) {
    const list = Array.from(mismatchedCurrencies).sort().join(", ");
    warnings.push(
      `Admission rules for ${args.attraction.name} are priced in ${list}; itinerary currency is ${args.itineraryCurrency} — excluded from the budget total.`,
    );
    return { state: "unknown", amount: 0, warnings, contributingRules: [] };
  }
  if (mismatchedCurrencies.size > 0) {
    const list = Array.from(mismatchedCurrencies).sort().join(", ");
    warnings.push(
      `Some admission rules for ${args.attraction.name} are priced in ${list}; only ${args.itineraryCurrency} rules were used in the budget.`,
    );
  }

  const guestNationality = inferGuestNationality(args.travellers, args.attraction);
  const segments: Array<{
    count: number;
    audience: AttractionAdmissionAudience;
    nationality: AttractionAdmissionNationality;
  }> = [
    {
      count: Math.max(0, args.travellers.adults),
      audience: "adult",
      nationality: guestNationality,
    },
    {
      count: Math.max(0, args.travellers.children),
      audience: "child",
      nationality: guestNationality,
    },
  ];

  let amount = 0;
  let hasEstimated = false;
  const contributingRules: AttractionAdmissionRule[] = [];

  for (const segment of segments) {
    if (segment.count <= 0) continue;
    const selectedRule = selectBestAdmissionRule({
      rules: currencyMatchedRules,
      audience: segment.audience,
      nationality: segment.nationality,
      dayDate: args.dayDate,
    });
    if (!selectedRule) {
      return {
        state: "unknown",
        amount: 0,
        warnings,
        contributingRules: [],
      };
    }
    if (selectedRule.amount === null || selectedRule.confidence === "unknown") {
      return {
        state: "unknown",
        amount: 0,
        warnings,
        contributingRules: [],
      };
    }
    if (selectedRule.confidence === "estimated") {
      hasEstimated = true;
    }
    amount += selectedRule.amount * segment.count;
    contributingRules.push(selectedRule);
  }

  const roundedAmount = Number(Math.max(0, amount).toFixed(2));
  return {
    state: hasEstimated ? "estimated" : "verified",
    amount: roundedAmount,
    warnings,
    contributingRules,
  };
}

function selectBestAdmissionRule(args: {
  rules: AttractionAdmissionRule[];
  audience: AttractionAdmissionAudience;
  nationality: AttractionAdmissionNationality;
  dayDate?: LocalDateString;
}): AttractionAdmissionRule | null {
  const dayDate = args.dayDate;
  const datedRules = dayDate
    ? args.rules.filter((rule) => isRuleValidOnDate(rule, dayDate))
    : args.rules;
  const candidates = datedRules.length > 0 ? datedRules : args.rules;

  // Prefer non-student rules — student pricing is opt-in and we don't yet
  // model a student flag on TravellerComposition. Within that, prefer an
  // exact nationality match over the catch-all `any` bucket.
  const audienceMatches = candidates.filter(
    (rule) => rule.audience === args.audience && !rule.is_student,
  );
  if (audienceMatches.length === 0) return null;

  const exactNationality = audienceMatches.filter(
    (rule) => rule.nationality === args.nationality,
  );
  const fallbackNationality = audienceMatches.filter(
    (rule) => rule.nationality === "any",
  );

  const tiered = exactNationality.length > 0
    ? exactNationality
    : fallbackNationality.length > 0
      ? fallbackNationality
      : audienceMatches;
  return sortAdmissionRulesByPriority(tiered)[0] ?? null;
}

function sortAdmissionRulesByPriority(
  rules: AttractionAdmissionRule[],
): AttractionAdmissionRule[] {
  return [...rules].sort((left, right) => {
    const confidenceDiff =
      admissionConfidenceRank(right.confidence) -
      admissionConfidenceRank(left.confidence);
    if (confidenceDiff !== 0) return confidenceDiff;

    const sourceDiff =
      admissionSourceRank(right.source_type) - admissionSourceRank(left.source_type);
    if (sourceDiff !== 0) return sourceDiff;

    const freshnessDiff =
      (right.verified_at ?? right.fetched_at ?? 0) -
      (left.verified_at ?? left.fetched_at ?? 0);
    if (freshnessDiff !== 0) return freshnessDiff;

    return left.id.localeCompare(right.id);
  });
}

function admissionConfidenceRank(
  confidence: AttractionAdmissionRule["confidence"],
): number {
  switch (confidence) {
    case "verified":
      return 3;
    case "estimated":
      return 2;
    case "unknown":
      return 1;
  }
}

function admissionSourceRank(
  sourceType: AttractionAdmissionRule["source_type"],
): number {
  switch (sourceType) {
    case "official_website":
      return 5;
    case "manual":
      return 4;
    case "google_places":
      return 3;
    case "system":
      return 2;
    case "estimated":
      return 1;
  }
}

function isRuleValidOnDate(
  rule: AttractionAdmissionRule,
  dayDate: LocalDateString,
): boolean {
  if (rule.valid_from && dayDate < rule.valid_from) return false;
  if (rule.valid_until && dayDate > rule.valid_until) return false;
  return true;
}

/**
 * Resolve traveller nationality vs the attraction's country to one of the
 * structured nationality buckets. Falls back to `domestic` when the guest
 * nationality is unspecified, matching the existing default.
 */
function inferGuestNationality(
  travellers: TravellerComposition,
  attraction: GraphNode,
): AttractionAdmissionNationality {
  const guestIso = canonicaliseCountry(
    travellers.guest_nationality?.trim() || DEFAULT_GUEST_NATIONALITY,
  );
  const attractionIso = canonicaliseCountry(attraction.country);
  if (!guestIso || !attractionIso) return "domestic";
  return guestIso === attractionIso ? "domestic" : "foreigner";
}

/**
 * Best-effort normalisation between ISO 3166-1 alpha-2 codes (e.g. "IN")
 * and human-friendly slugs that occur in our seed data (e.g. "india").
 * The map only needs entries for countries we actively plan trips in;
 * unrecognised inputs round-trip through lowercasing so direct equality
 * still works when both sides use the same convention.
 */
const COUNTRY_SLUG_TO_ISO: Record<string, string> = {
  india: "in",
  bharat: "in",
};

function canonicaliseCountry(input: string): string {
  const lower = input.trim().toLowerCase();
  if (!lower) return "";
  if (lower.length === 2) return lower;
  return COUNTRY_SLUG_TO_ISO[lower] ?? lower;
}

function buildLineItemProvenance(
  rules: AttractionAdmissionRule[],
  itineraryCurrency: string,
): ItineraryBudgetLineItemProvenance | undefined {
  if (rules.length === 0) return undefined;
  // Multiple rules can contribute to one line item (e.g. adult + child); the
  // primary record drives the displayed confidence/source. We pick the rule
  // with the lowest confidence so the snapshot reflects the weakest link
  // in the calculation, which is what the budget honesty signals depend on.
  const ranked = [...rules].sort(
    (left, right) =>
      admissionConfidenceRank(left.confidence) -
      admissionConfidenceRank(right.confidence),
  );
  const primary = ranked[0];
  if (!primary) return undefined;
  return {
    source_type: primary.source_type,
    confidence: primary.confidence,
    rule_id: primary.id,
    currency: itineraryCurrency,
    fetched_at: primary.fetched_at ?? undefined,
    verified_at: primary.verified_at ?? undefined,
  };
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

function uniqueScoredNodes(
  entries: Array<{ node: GraphNode; score: number }>,
): Array<{ node: GraphNode; score: number }> {
  const seen = new Set<string>();
  const out: Array<{ node: GraphNode; score: number }> = [];

  for (const entry of entries) {
    if (seen.has(entry.node.id)) continue;
    seen.add(entry.node.id);
    out.push(entry);
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

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
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
