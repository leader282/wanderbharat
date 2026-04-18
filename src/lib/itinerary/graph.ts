import type {
  Coordinates,
  GraphEdge,
  GraphNode,
  TransportMode,
} from "@/types/domain";
import { averageSpeedKmH } from "@/lib/config/transportMode";
import { haversineKm } from "@/lib/services/distanceService";

/**
 * In-memory travel graph. Pure data structure — no Firestore, no network.
 *
 * The engine runs entirely against this structure so tests can construct a
 * `TravelGraph` with fake nodes/edges and exercise the planner without any
 * infrastructure.
 */
export class TravelGraph {
  private readonly nodesById = new Map<string, GraphNode>();
  /** adjacency[fromId] = [{ to, edge }, ...] */
  private readonly adjacency = new Map<
    string,
    Array<{ to: string; edge: GraphEdge }>
  >();

  constructor(nodes: GraphNode[], edges: GraphEdge[]) {
    for (const node of nodes) {
      this.nodesById.set(node.id, node);
    }
    for (const edge of edges) {
      this.addEdgeInternal(edge, false);
      if (edge.bidirectional !== false) {
        this.addEdgeInternal(edge, true);
      }
    }
  }

  private addEdgeInternal(edge: GraphEdge, reversed: boolean) {
    const from = reversed ? edge.to : edge.from;
    const to = reversed ? edge.from : edge.to;
    if (!this.nodesById.has(from) || !this.nodesById.has(to)) return;
    const list = this.adjacency.get(from) ?? [];
    list.push({ to, edge });
    this.adjacency.set(from, list);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodesById.get(id);
  }

  requireNode(id: string): GraphNode {
    const n = this.nodesById.get(id);
    if (!n) throw new Error(`Node not found in graph: ${id}`);
    return n;
  }

  allNodes(): GraphNode[] {
    return Array.from(this.nodesById.values());
  }

  neighbors(id: string): Array<{ to: string; edge: GraphEdge }> {
    return this.adjacency.get(id) ?? [];
  }

  /**
   * Best direct edge between two nodes, optionally restricted to a set of
   * transport modes. Returns undefined if no edge exists.
   */
  getEdge(
    fromId: string,
    toId: string,
    modes?: TransportMode[],
  ): GraphEdge | undefined {
    const options = (this.adjacency.get(fromId) ?? []).filter(
      (n) => n.to === toId,
    );
    const filtered = modes
      ? options.filter((n) => modes.includes(n.edge.type))
      : options;
    if (filtered.length === 0) return undefined;
    return filtered.reduce((best, cur) =>
      cur.edge.travel_time_hours < best.edge.travel_time_hours ? cur : best,
    ).edge;
  }

  /**
   * Returns travel time between two nodes. Uses a direct edge if present,
   * otherwise estimates using great-circle distance and a per-mode
   * average speed from {@link transportModeConfig}. This keeps the engine
   * deterministic even when the seed data is sparse.
   */
  estimateTravel(
    fromId: string,
    toId: string,
    modes: TransportMode[] = ["road"],
  ): { distance_km: number; travel_time_hours: number; mode: TransportMode } {
    const edge = this.getEdge(fromId, toId, modes);
    if (edge) {
      return {
        distance_km: edge.distance_km,
        travel_time_hours: edge.travel_time_hours,
        mode: edge.type,
      };
    }
    const a = this.requireNode(fromId).location;
    const b = this.requireNode(toId).location;
    const distance_km = haversineKm(a, b);
    const mode = modes[0] ?? "road";
    const speed = averageSpeedKmH(mode);
    return {
      distance_km,
      travel_time_hours: distance_km / speed,
      mode,
    };
  }
}

// Re-exports for call sites that imported these helpers from `graph.ts`.
export { averageSpeedKmH } from "@/lib/config/transportMode";

export function distanceBetween(a: Coordinates, b: Coordinates): number {
  return haversineKm(a, b);
}
