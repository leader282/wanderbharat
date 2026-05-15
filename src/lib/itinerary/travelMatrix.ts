import type { GraphEdge, GraphNode, TransportMode } from "@/types/domain";
import {
  defaultPerKmCost,
  fatigueFactor,
  getTransportModeConfig,
} from "@/lib/config/transportMode";
import {
  defaultEngineTuning,
  type EngineTuning,
} from "@/lib/config/engineTuning";

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
  now: () => number;
  /** Cap on outbound HTTP calls; defaults to tuning.networkConcurrency. */
  concurrency?: number;
  /** Cap on pair-wise resolutions; defaults to tuning.maxMatrixPairs. */
  maxPairs?: number;
  tuning?: EngineTuning;
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
    if (edge.bidirectional !== false && !isDirectionalProviderEdge(edge)) {
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

function isDirectionalProviderEdge(edge: GraphEdge): boolean {
  return edge.metadata?.provider === "google_routes";
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
