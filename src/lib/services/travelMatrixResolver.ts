import type { GraphEdge, GraphNode, TransportMode } from "@/types/domain";
import { supportsLiveTravelMode } from "@/lib/config/transportMode";
import { defaultEngineTuning } from "@/lib/config/engineTuning";
import { upsertEdges } from "@/lib/repositories/edgeRepository";
import {
  buildTravelMatrix,
  type ResolveTravelMatrixInput,
  type TravelMatrix,
} from "@/lib/itinerary/travelMatrix";
import {
  getTravelMatrix as googleTravelMatrix,
  getTravelTime,
  type TravelMatrixCell,
} from "@/lib/services/distanceService";

export interface TravelMatrixResolverDependencies {
  /** Batched matrix fetcher; defaults to Google computeRouteMatrix. */
  fetchTravelMatrix?: typeof googleTravelMatrix;
  /**
   * Single-leg fetcher used when the batched matrix returns nothing
   * (e.g. provider error, empty response). Tests inject this to assert the
   * resolution path without HTTP.
   */
  fetchTravelTime?: typeof getTravelTime;
  persistEdges?: typeof upsertEdges;
}

/**
 * Server-boundary resolver. Starts with cached edges, optionally calls Google
 * Routes for missing live-supported legs, and persists newly resolved edges.
 */
export async function resolveTravelMatrix(
  input: ResolveTravelMatrixInput,
  deps: TravelMatrixResolverDependencies = {},
): Promise<TravelMatrix> {
  const nodes = uniqueNodes(input.nodes);
  const lookup = createEdgeLookup(input.edges);
  const regionSet = new Set(input.regions ?? []);
  const freshEdges: GraphEdge[] = [];
  const fetchMatrix = deps.fetchTravelMatrix ?? googleTravelMatrix;
  const fetchSingle = deps.fetchTravelTime ?? getTravelTime;
  const persistEdges = deps.persistEdges ?? upsertEdges;
  const maxPairs =
    input.maxPairs ?? input.tuning?.maxMatrixPairs ?? defaultEngineTuning.maxMatrixPairs;

  for (const mode of input.modes) {
    if (!supportsLiveTravelMode(mode)) continue;

    const missingPairs: Array<{ from: GraphNode; to: GraphNode }> = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const from = nodes[i];
        const to = nodes[j];
        if (!lookup.bestEdge(from.id, to.id, [mode])) {
          missingPairs.push({ from, to });
          if (missingPairs.length >= maxPairs) break;
        }
        if (!lookup.bestEdge(to.id, from.id, [mode])) {
          missingPairs.push({ from: to, to: from });
          if (missingPairs.length >= maxPairs) break;
        }
      }
      if (missingPairs.length >= maxPairs) break;
    }

    if (missingPairs.length === 0) continue;

    const matrixNodes = uniqueNodes(
      missingPairs.flatMap((pair) => [pair.from, pair.to]),
    );
    const matrixNodeIndexById = new Map(
      matrixNodes.map((node, index) => [node.id, index] as const),
    );
    const matrixLocations = matrixNodes.map((node) => node.location);

    let cells: TravelMatrixCell[] | null = null;
    try {
      cells = await fetchMatrix({
        origins: matrixLocations,
        destinations: matrixLocations,
        mode,
      });
    } catch {
      cells = null;
    }

    if (cells && cells.length > 0) {
      const cellsByPair = new Map<string, TravelMatrixCell>();
      for (const cell of cells) {
        if (cell.origin_index === cell.destination_index) continue;
        const origin = matrixNodes[cell.origin_index];
        const destination = matrixNodes[cell.destination_index];
        if (!origin || !destination) continue;
        cellsByPair.set(makeMatrixKey(origin.id, destination.id), cell);
      }
      for (const pair of missingPairs) {
        const fromIndex = matrixNodeIndexById.get(pair.from.id);
        const toIndex = matrixNodeIndexById.get(pair.to.id);
        if (fromIndex === undefined || toIndex === undefined) continue;
        const cell = cellsByPair.get(makeMatrixKey(pair.from.id, pair.to.id));
        if (!cell?.leg) continue;
        addFreshEdge({
          edge: createResolvedEdge({
            from: pair.from,
            to: pair.to,
            mode,
            leg: cell.leg,
            regions: regionSetFor(pair, regionSet),
            now: input.now,
          }),
          lookup,
          freshEdges,
        });
      }
    } else {
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
        addFreshEdge({
          edge: createResolvedEdge({
            from: pair.from,
            to: pair.to,
            mode,
            leg,
            regions: regionSetFor(pair, regionSet),
            now: input.now,
          }),
          lookup,
          freshEdges,
        });
      }
    }
  }

  if (freshEdges.length > 0) {
    try {
      await persistEdges(freshEdges);
    } catch {
      // Cache persistence is opportunistic; planning can use in-memory edges.
    }
  }

  return buildTravelMatrix(nodes, lookup.listEdges(), input.modes, input.tuning);
}

function addFreshEdge(args: {
  edge: GraphEdge;
  lookup: ReturnType<typeof createEdgeLookup>;
  freshEdges: GraphEdge[];
}) {
  if (args.lookup.bestEdge(args.edge.from, args.edge.to, [args.edge.type])) return;
  args.lookup.add(args.edge);
  args.freshEdges.push(args.edge);
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
  now: () => number;
}): GraphEdge {
  return {
    id: `edge_resolved_${args.mode}_${args.from.id}__${args.to.id}`,
    from: args.from.id,
    to: args.to.id,
    type: args.mode,
    distance_km: Number(args.leg.distance_km.toFixed(1)),
    travel_time_hours: Number(args.leg.travel_time_hours.toFixed(2)),
    bidirectional: false,
    regions: args.regions.length > 0 ? args.regions : [args.from.region],
    metadata: {
      provider: "google_routes",
      resolved_at: args.now(),
      ...(args.leg.encoded_polyline
        ? { encoded_polyline: args.leg.encoded_polyline }
        : {}),
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
  return `${fromId}::${toId}`;
}
