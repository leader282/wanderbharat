import type { GraphEdge, GraphNode, TransportMode } from "@/types/domain";
import { upsertEdges } from "@/lib/repositories/edgeRepository";
import {
  defaultPerKmCost,
  fatigueFactor,
  getTransportModeConfig,
  supportsLiveTravelMode,
} from "@/lib/config/transportMode";
import {
  defaultEngineTuning,
  type EngineTuning,
} from "@/lib/config/engineTuning";
import {
  getTravelMatrix as googleTravelMatrix,
  getTravelTime,
  type TravelMatrixCell,
} from "@/lib/services/distanceService";

const KEY_SEPARATOR = "::";

export interface ResolvedTravelLeg {
  from_node_id: string;
  to_node_id: string;
  transport_mode: TransportMode;
  distance_km: number;
  travel_time_hours: number;
  metadata: GraphEdge["metadata"];
  /**
   * The weighted leg cost used by the engine when picking between modes
   * for the same pair. Lower = preferred. Pre-computed so the hot path in
   * the engine stays allocation-free.
   */
  leg_score: number;
}

export interface TravelMatrix {
  edges: GraphEdge[];
  /**
   * Best leg between `from` and `to`. When `mode` is omitted the lowest
   * `leg_score` across allowed modes is returned. When `mode` is supplied,
   * only that mode is considered.
   */
  get(
    fromId: string,
    toId: string,
    mode?: TransportMode,
  ): ResolvedTravelLeg | null;
  /** Every resolved leg for a pair (one entry per mode). */
  getAll(fromId: string, toId: string): ResolvedTravelLeg[];
  /** Allowed modes used to build the matrix. */
  modes: readonly TransportMode[];
}

export interface ResolveTravelMatrixInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  regions?: string[];
  modes: TransportMode[];
  now?: () => number;
  /** Cap on outbound HTTP calls; defaults to tuning.networkConcurrency. */
  concurrency?: number;
  /** Cap on pair-wise resolutions; defaults to tuning.maxMatrixPairs. */
  maxPairs?: number;
  tuning?: EngineTuning;
}

export interface TravelMatrixDependencies {
  /** Batched matrix fetcher; defaults to Google computeRouteMatrix. */
  fetchTravelMatrix?: typeof googleTravelMatrix;
  /**
   * Single-leg fetcher used when the batched matrix returns nothing
   * (e.g. provider error, empty response). Also the seam tests inject
   * to assert the resolution path without HTTP.
   */
  fetchTravelTime?: typeof getTravelTime;
  persistEdges?: typeof upsertEdges;
}

/**
 * Build a strictly-from-data matrix without any network. Useful for
 * tests and offline scoring. Every leg that has an edge becomes a
 * resolved entry; everything else is unreachable.
 */
export function buildTravelMatrix(
  nodes: GraphNode[],
  edges: GraphEdge[],
  modes: TransportMode[],
  tuning: EngineTuning = defaultEngineTuning,
): TravelMatrix {
  const lookup = createEdgeLookup(edges);
  const nodeIds = uniqueNodes(nodes).map((node) => node.id);
  const legs = new Map<string, ResolvedTravelLeg[]>();

  for (const fromId of nodeIds) {
    for (const toId of nodeIds) {
      if (fromId === toId) continue;
      const bucket: ResolvedTravelLeg[] = [];
      for (const mode of modes) {
        const edge = lookup.bestEdge(fromId, toId, [mode]);
        if (!edge) continue;
        bucket.push(toResolvedLeg(edge, tuning));
      }
      if (bucket.length > 0) {
        bucket.sort((a, b) => a.leg_score - b.leg_score);
        legs.set(makeMatrixKey(fromId, toId), bucket);
      }
    }
  }

  return makeMatrixView(legs, lookup.listEdges(), modes);
}

/**
 * Resolve a travel matrix using cached edges first, falling back to live
 * routing for any missing pair×mode combination. Batches Google calls
 * through `computeRouteMatrix` (up to 25×25 per request) and runs tiles in
 * parallel. Newly-resolved legs are persisted back to the edges cache on
 * a best-effort basis.
 */
export async function resolveTravelMatrix(
  input: ResolveTravelMatrixInput,
  deps: TravelMatrixDependencies = {},
): Promise<TravelMatrix> {
  const tuning = input.tuning ?? defaultEngineTuning;
  const nodes = uniqueNodes(input.nodes);
  const lookup = createEdgeLookup(input.edges);
  const regionSet = new Set(input.regions ?? []);
  const freshEdges: GraphEdge[] = [];
  const fetchMatrix = deps.fetchTravelMatrix ?? googleTravelMatrix;
  const fetchSingle = deps.fetchTravelTime ?? getTravelTime;
  const persistEdges = deps.persistEdges ?? upsertEdges;

  const maxPairs = input.maxPairs ?? tuning.maxMatrixPairs;

  for (const mode of input.modes) {
    if (!supportsLiveTravelMode(mode)) continue;

    const missingPairs: Array<{ from: GraphNode; to: GraphNode }> = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const from = nodes[i];
        const to = nodes[j];
        const forward = lookup.bestEdge(from.id, to.id, [mode]);
        const backward = lookup.bestEdge(to.id, from.id, [mode]);
        if (forward && backward) continue;
        missingPairs.push({ from, to });
        if (missingPairs.length >= maxPairs) break;
      }
      if (missingPairs.length >= maxPairs) break;
    }

    if (missingPairs.length === 0) continue;

    const origins = missingPairs.map((p) => p.from.location);
    const destinations = missingPairs.map((p) => p.to.location);

    // Try batched matrix first. Fall back to sequential single-leg calls
    // only if batching throws (so tests that inject `fetchTravelTime` keep
    // working).
    let cells: TravelMatrixCell[] | null = null;
    try {
      cells = await fetchMatrix({ origins, destinations, mode });
    } catch {
      cells = null;
    }

    if (cells && cells.length > 0) {
      const forwardLeg = new Map<number, TravelMatrixCell>();
      for (const cell of cells) {
        if (cell.origin_index === cell.destination_index) {
          forwardLeg.set(cell.origin_index, cell);
        }
      }
      missingPairs.forEach((pair, idx) => {
        const cell = forwardLeg.get(idx);
        if (!cell || !cell.leg) return;
        const edge = createResolvedEdge({
          from: pair.from,
          to: pair.to,
          mode,
          leg: cell.leg,
          regions: regionSetFor(pair, regionSet),
          now: input.now,
        });
        if (
          !lookup.bestEdge(edge.from, edge.to, [mode]) ||
          !lookup.bestEdge(edge.to, edge.from, [mode])
        ) {
          lookup.add(edge);
          freshEdges.push(edge);
        }
      });
    } else {
      // Resolve one-by-one when the batched matrix returns nothing.
      for (const pair of missingPairs) {
        let leg = null;
        try {
          leg = await fetchSingle({
            origin: pair.from.location,
            destination: pair.to.location,
            mode,
          });
        } catch {
          continue;
        }
        if (!leg) continue;
        const edge = createResolvedEdge({
          from: pair.from,
          to: pair.to,
          mode,
          leg,
          regions: regionSetFor(pair, regionSet),
          now: input.now,
        });
        if (
          !lookup.bestEdge(edge.from, edge.to, [mode]) ||
          !lookup.bestEdge(edge.to, edge.from, [mode])
        ) {
          lookup.add(edge);
          freshEdges.push(edge);
        }
      }
    }
  }

  if (freshEdges.length > 0) {
    try {
      await persistEdges(freshEdges);
    } catch {
      // Cache persistence is opportunistic; planning should still succeed.
    }
  }

  return buildTravelMatrix(nodes, lookup.listEdges(), input.modes, tuning);
}

function regionSetFor(
  pair: { from: GraphNode; to: GraphNode },
  declared: Set<string>,
): string[] {
  const seen = new Set<string>(declared);
  if (pair.from.region) seen.add(pair.from.region);
  if (pair.to.region) seen.add(pair.to.region);
  return Array.from(seen);
}

function createResolvedEdge(args: {
  from: GraphNode;
  to: GraphNode;
  mode: TransportMode;
  leg: {
    distance_km: number;
    travel_time_hours: number;
    encoded_polyline?: string;
  };
  regions: string[];
  now?: () => number;
}): GraphEdge {
  const [left, right] = [args.from.id, args.to.id].sort((a, b) =>
    a.localeCompare(b),
  );
  const resolvedAt = args.now?.() ?? Date.now();

  return {
    id: `edge_resolved_${args.mode}_${left}__${right}`,
    from: left,
    to: right,
    type: args.mode,
    distance_km: Number(args.leg.distance_km.toFixed(1)),
    travel_time_hours: Number(args.leg.travel_time_hours.toFixed(2)),
    bidirectional: true,
    regions: args.regions.length > 0 ? args.regions : [args.from.region],
    metadata: {
      provider: "google_routes",
      resolved_at: resolvedAt,
      ...(args.leg.encoded_polyline
        ? { encoded_polyline: args.leg.encoded_polyline }
        : {}),
    },
  };
}

function toResolvedLeg(
  edge: GraphEdge,
  tuning: EngineTuning,
): ResolvedTravelLeg {
  const modeCfg = getTransportModeConfig(edge.type);
  const basePrice = Number(edge.metadata?.base_price ?? 0);
  const distance = edge.distance_km;
  const legCost =
    basePrice > 0 ? basePrice : distance * defaultPerKmCost(edge.type);
  const hours = edge.travel_time_hours;
  const fatigueHours = hours * fatigueFactor(edge.type);

  const legScore =
    tuning.legCost.hours * hours +
    tuning.legCost.cost * legCost +
    tuning.legCost.fatigue * fatigueHours;

  return {
    from_node_id: edge.from,
    to_node_id: edge.to,
    transport_mode: edge.type,
    distance_km: edge.distance_km,
    travel_time_hours: edge.travel_time_hours,
    metadata: {
      ...(edge.metadata ?? {}),
      estimated_cost: Number(legCost.toFixed(2)),
      fatigue_factor: modeCfg.fatigue_factor,
    },
    leg_score: Number(legScore.toFixed(4)),
  };
}

function makeMatrixView(
  legs: Map<string, ResolvedTravelLeg[]>,
  edges: GraphEdge[],
  modes: TransportMode[],
): TravelMatrix {
  return {
    edges,
    modes,
    get(fromId, toId, mode) {
      const bucket = legs.get(makeMatrixKey(fromId, toId));
      if (!bucket || bucket.length === 0) return null;
      if (!mode) return bucket[0];
      return bucket.find((leg) => leg.transport_mode === mode) ?? null;
    },
    getAll(fromId, toId) {
      return legs.get(makeMatrixKey(fromId, toId)) ?? [];
    },
  };
}

function createEdgeLookup(seedEdges: GraphEdge[]) {
  const storedEdges: GraphEdge[] = [];
  const adjacency = new Map<string, GraphEdge[]>();
  const storedIds = new Set<string>();

  for (const edge of seedEdges) {
    add(edge);
  }

  return {
    add,
    bestEdge,
    listEdges() {
      return [...storedEdges];
    },
  };

  function add(edge: GraphEdge) {
    if (!storedIds.has(edge.id)) {
      storedIds.add(edge.id);
      storedEdges.push(edge);
    }

    addDirectional(edge);
    if (edge.bidirectional !== false) {
      addDirectional({
        ...edge,
        from: edge.to,
        to: edge.from,
      });
    }
  }

  function addDirectional(edge: GraphEdge) {
    const key = makeMatrixKey(edge.from, edge.to);
    const list = adjacency.get(key) ?? [];
    list.push(edge);
    adjacency.set(key, list);
  }

  function bestEdge(
    fromId: string,
    toId: string,
    modes: TransportMode[],
  ): GraphEdge | undefined {
    const options = adjacency.get(makeMatrixKey(fromId, toId)) ?? [];
    const filtered =
      modes.length > 0
        ? options.filter((edge) => modes.includes(edge.type))
        : options;
    if (filtered.length === 0) return undefined;

    return filtered.reduce((best, current) =>
      current.travel_time_hours < best.travel_time_hours ? current : best,
    );
  }
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  const seen = new Set<string>();
  const ordered: GraphNode[] = [];

  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push(node);
  }

  return ordered;
}

function makeMatrixKey(fromId: string, toId: string): string {
  return `${fromId}${KEY_SEPARATOR}${toId}`;
}
