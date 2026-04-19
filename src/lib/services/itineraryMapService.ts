import { getAccommodations } from "@/lib/repositories/accommodationRepository";
import { findEdges, upsertEdges } from "@/lib/repositories/edgeRepository";
import { getNodes } from "@/lib/repositories/nodeRepository";
import { chunk } from "@/lib/utils/concurrency";
import {
  getTravelTime,
  supportsLiveTravelMode,
  type TravelLeg,
} from "@/lib/services/distanceService";
import type {
  Accommodation,
  GraphEdge,
  GraphNode,
  Itinerary,
  ItineraryMapData,
  ItineraryMapLeg,
  ItineraryMapMarker,
  TransportMode,
} from "@/types/domain";

interface TravelSpec {
  from: GraphNode;
  to: GraphNode;
  mode: TransportMode;
}

/**
 * Hard cap on a single live Google Routes call when backfilling map
 * geometry. The map renders fine without polylines (we fall back to
 * a direct line), so we never let an unhealthy upstream block the
 * whole itinerary page.
 */
const LIVE_ROUTE_FETCH_TIMEOUT_MS = 4000;

export interface ItineraryMapServiceDependencies {
  getNodes?: typeof getNodes;
  getAccommodations?: typeof getAccommodations;
  findEdges?: typeof findEdges;
  upsertEdges?: typeof upsertEdges;
  getTravelTime?: typeof getTravelTime;
  now?: () => number;
  /**
   * Per-call timeout in milliseconds for the live Routes API fallback.
   * Defaults to {@link LIVE_ROUTE_FETCH_TIMEOUT_MS}; tests override
   * to keep the suite snappy.
   */
  liveRouteTimeoutMs?: number;
}

/**
 * Pre-cache geometry for the actual travel legs used by a newly-generated
 * itinerary so the detail page usually renders from stored edge data only.
 */
export async function precacheItineraryRouteGeometry(
  itinerary: Itinerary,
  nodes: GraphNode[],
  deps: ItineraryMapServiceDependencies = {},
): Promise<GraphEdge[]> {
  const travelSpecs = collectTravelSpecs(itinerary, indexNodes(nodes));
  const cachedEdges = await loadCachedEdges(travelSpecs, deps);
  return ensureRouteGeometry(travelSpecs, cachedEdges, deps);
}

/**
 * Build a map-ready DTO for the itinerary page / GET detail API.
 * Loads the related entities, backfills any missing route geometry once,
 * then returns plain serializable data for a client map component.
 */
export async function getItineraryMapData(
  itinerary: Itinerary,
  deps: ItineraryMapServiceDependencies = {},
): Promise<ItineraryMapData> {
  const loadNodes = deps.getNodes ?? getNodes;
  const loadAccommodations = deps.getAccommodations ?? getAccommodations;
  const nodeIds = collectRelevantNodeIds(itinerary);
  const accommodationIds = itinerary.stays
    .map((stay) => stay.accommodationId)
    .filter((id): id is string => Boolean(id));

  const [nodes, accommodations] = await Promise.all([
    loadNodes(nodeIds),
    loadAccommodations(accommodationIds),
  ]);

  const nodesById = indexNodes(nodes);
  const travelSpecs = collectTravelSpecs(itinerary, nodesById);
  const cachedEdges = await loadCachedEdges(travelSpecs, deps);
  const resolvedEdges = await ensureRouteGeometry(
    travelSpecs,
    cachedEdges,
    deps,
  );

  return buildMapData({
    itinerary,
    nodesById,
    accommodations,
    edges: resolvedEdges,
  });
}

function buildMapData(args: {
  itinerary: Itinerary;
  nodesById: Map<string, GraphNode>;
  accommodations: Accommodation[];
  edges: GraphEdge[];
}): ItineraryMapData {
  const markers = [
    ...buildStopMarkers(args.itinerary, args.nodesById),
    ...buildStayMarkers(args.itinerary, args.accommodations),
    ...buildAttractionMarkers(args.itinerary, args.nodesById),
  ];
  const legs = buildLegs(args.itinerary, args.nodesById, args.edges);

  return {
    markers,
    legs,
    missing_geometry_count: legs.filter((leg) => !leg.has_geometry).length,
  };
}

function buildStopMarkers(
  itinerary: Itinerary,
  nodesById: Map<string, GraphNode>,
): ItineraryMapMarker[] {
  const byNodeId = new Map<
    string,
    {
      node: GraphNode;
      firstIndex: number;
      stopOrders: number[];
      dayIndices: number[];
    }
  >();

  dedupeConsecutive(itinerary.nodes).forEach((nodeId, index) => {
    const node = nodesById.get(nodeId);
    if (!node) return;

    const existing = byNodeId.get(nodeId);
    if (existing) {
      existing.stopOrders.push(index);
      return;
    }

    byNodeId.set(nodeId, {
      node,
      firstIndex: index,
      stopOrders: [index],
      dayIndices: collectDayIndicesForStop(itinerary, nodeId),
    });
  });

  return Array.from(byNodeId.values())
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .map(({ node, firstIndex, stopOrders, dayIndices }) => ({
      id: `stop_${node.id}_${firstIndex}`,
      kind: "stop" as const,
      title: node.name,
      subtitle: formatStopSubtitle(stopOrders),
      position: node.location,
      day_indices: dayIndices,
      node_id: node.id,
      google_place_id:
        typeof node.metadata.google_place_id === "string"
          ? node.metadata.google_place_id
          : undefined,
      stop_order: firstIndex,
    }));
}

function buildStayMarkers(
  itinerary: Itinerary,
  accommodations: Accommodation[],
): ItineraryMapMarker[] {
  const accommodationById = new Map(
    accommodations.map((accommodation) => [accommodation.id, accommodation]),
  );

  return itinerary.stays.flatMap((stay, index) => {
    if (!stay.accommodationId) return [];
    const accommodation = accommodationById.get(stay.accommodationId);
    if (!accommodation) return [];

    return [
      {
        id: `stay_${stay.accommodationId}_${index}`,
        kind: "stay" as const,
        title: accommodation.name,
        subtitle: `${titleCase(accommodation.category)} stay · ${formatDayRange(
          stay.startDay,
          stay.endDay,
        )}`,
        position: accommodation.location,
        day_indices: range(stay.startDay, stay.endDay),
        node_id: stay.nodeId,
      },
    ];
  });
}

function buildAttractionMarkers(
  itinerary: Itinerary,
  nodesById: Map<string, GraphNode>,
): ItineraryMapMarker[] {
  const byNodeId = new Map<
    string,
    {
      node: GraphNode;
      dayIndices: Set<number>;
    }
  >();

  for (const day of itinerary.day_plan) {
    for (const activity of day.activities) {
      const node = nodesById.get(activity.node_id);
      if (!node || node.type !== "attraction") continue;

      const entry = byNodeId.get(node.id) ?? {
        node,
        dayIndices: new Set<number>(),
      };
      entry.dayIndices.add(day.day_index);
      byNodeId.set(node.id, entry);
    }
  }

  return Array.from(byNodeId.values()).map(({ node, dayIndices }) => ({
    id: `attraction_${node.id}`,
    kind: "attraction" as const,
    title: node.name,
    subtitle:
      dayIndices.size === 1 ? "Day highlight" : "Appears on multiple days",
    position: node.location,
    day_indices: Array.from(dayIndices).sort((left, right) => left - right),
    node_id: node.id,
    google_place_id:
      typeof node.metadata.google_place_id === "string"
        ? node.metadata.google_place_id
        : undefined,
  }));
}

function buildLegs(
  itinerary: Itinerary,
  nodesById: Map<string, GraphNode>,
  edges: GraphEdge[],
): ItineraryMapLeg[] {
  return itinerary.day_plan.flatMap((day) => {
    if (!day.travel) return [];

    const from = nodesById.get(day.travel.from_node_id);
    const to = nodesById.get(day.travel.to_node_id);
    if (!from || !to) return [];

    const edge = findMatchingEdge(
      edges,
      day.travel.from_node_id,
      day.travel.to_node_id,
      day.travel.transport_mode,
    );
    const encodedPolyline =
      typeof edge?.metadata?.encoded_polyline === "string"
        ? edge.metadata.encoded_polyline
        : undefined;

    return [
      {
        id: `leg_${day.day_index}_${day.travel.from_node_id}_${day.travel.to_node_id}_${day.travel.transport_mode}`,
        day_index: day.day_index,
        from_node_id: day.travel.from_node_id,
        to_node_id: day.travel.to_node_id,
        from_name: from.name,
        to_name: to.name,
        from_position: from.location,
        to_position: to.location,
        transport_mode: day.travel.transport_mode,
        distance_km: edge?.distance_km ?? day.travel.distance_km,
        travel_time_hours:
          edge?.travel_time_hours ?? day.travel.travel_time_hours,
        encoded_polyline: encodedPolyline,
        has_geometry: Boolean(encodedPolyline),
      },
    ];
  });
}

async function loadCachedEdges(
  specs: TravelSpec[],
  deps: ItineraryMapServiceDependencies,
): Promise<GraphEdge[]> {
  if (specs.length === 0) return [];

  const loadEdges = deps.findEdges ?? findEdges;
  const fromIds = uniqueStrings([
    ...specs.map((spec) => spec.from.id),
    ...specs.map((spec) => spec.to.id),
  ]);
  const modes = uniqueStrings(
    specs.map((spec) => spec.mode),
  ) as TransportMode[];
  const out: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const slice of chunk(fromIds, 10)) {
    const edges = await loadEdges({
      fromIds: slice,
      transport_modes: modes,
    });

    for (const edge of edges) {
      if (seen.has(edge.id)) continue;
      if (!matchesAnySpec(edge, specs)) continue;
      seen.add(edge.id);
      out.push(edge);
    }
  }

  return out;
}

async function ensureRouteGeometry(
  specs: TravelSpec[],
  cachedEdges: GraphEdge[],
  deps: ItineraryMapServiceDependencies,
): Promise<GraphEdge[]> {
  if (specs.length === 0) return cachedEdges;

  const fetchTravelTime = deps.getTravelTime ?? getTravelTime;
  const persistEdges = deps.upsertEdges ?? upsertEdges;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.liveRouteTimeoutMs ?? LIVE_ROUTE_FETCH_TIMEOUT_MS;
  const resolvedEdges = [...cachedEdges];
  const upserts: GraphEdge[] = [];

  for (const spec of uniqueSpecs(specs)) {
    const existing = findMatchingEdge(
      resolvedEdges,
      spec.from.id,
      spec.to.id,
      spec.mode,
    );
    if (existing?.metadata?.encoded_polyline) continue;
    if (!supportsLiveTravelMode(spec.mode)) continue;

    const liveLeg = await fetchLiveLegWithTimeout({
      fetchTravelTime,
      spec,
      timeoutMs,
    });
    if (!liveLeg) continue;

    const refreshed = mergeResolvedEdge({
      spec,
      existing,
      liveLeg,
      resolvedAt: now(),
    });
    replaceEdge(resolvedEdges, refreshed);
    replaceEdge(upserts, refreshed);
  }

  if (upserts.length > 0) {
    try {
      await persistEdges(upserts);
    } catch {
      // Map data still renders with the in-memory result even if the cache write
      // fails; a later request can retry the persistence.
    }
  }

  return resolvedEdges;
}

async function fetchLiveLegWithTimeout(args: {
  fetchTravelTime: NonNullable<ItineraryMapServiceDependencies["getTravelTime"]>;
  spec: TravelSpec;
  timeoutMs: number;
}): Promise<TravelLeg | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), args.timeoutMs);
  });

  try {
    return await Promise.race([
      args.fetchTravelTime({
        origin: args.spec.from.location,
        destination: args.spec.to.location,
        mode: args.spec.mode,
      }).catch(() => null),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function collectRelevantNodeIds(itinerary: Itinerary): string[] {
  const ids = new Set<string>(itinerary.nodes);

  for (const day of itinerary.day_plan) {
    ids.add(day.base_node_id);
    if (day.travel) {
      ids.add(day.travel.from_node_id);
      ids.add(day.travel.to_node_id);
    }
    for (const activity of day.activities) {
      ids.add(activity.node_id);
    }
  }

  for (const stay of itinerary.stays) {
    ids.add(stay.nodeId);
  }

  return Array.from(ids);
}

function collectTravelSpecs(
  itinerary: Itinerary,
  nodesById: Map<string, GraphNode>,
): TravelSpec[] {
  const out: TravelSpec[] = [];

  for (const day of itinerary.day_plan) {
    if (!day.travel) continue;

    const from = nodesById.get(day.travel.from_node_id);
    const to = nodesById.get(day.travel.to_node_id);
    if (!from || !to) continue;

    out.push({
      from,
      to,
      mode: day.travel.transport_mode,
    });
  }

  return out;
}

function collectDayIndicesForStop(
  itinerary: Itinerary,
  nodeId: string,
): number[] {
  const indices = new Set<number>();

  for (const day of itinerary.day_plan) {
    if (day.base_node_id === nodeId) indices.add(day.day_index);
    if (day.travel?.from_node_id === nodeId) indices.add(day.day_index);
    if (day.travel?.to_node_id === nodeId) indices.add(day.day_index);
  }

  return Array.from(indices).sort((left, right) => left - right);
}

function mergeResolvedEdge(args: {
  spec: TravelSpec;
  existing?: GraphEdge;
  liveLeg: TravelLeg;
  resolvedAt: number;
}): GraphEdge {
  const metadata = {
    ...(args.existing?.metadata ?? {}),
    provider: "google_routes",
    resolved_at: args.resolvedAt,
    ...(args.liveLeg.encoded_polyline
      ? { encoded_polyline: args.liveLeg.encoded_polyline }
      : {}),
  };

  if (args.existing) {
    // Keep the engine's distance/travel_time the planner already used so the
    // map and the day-by-day timeline never disagree. We only enrich the edge
    // with the freshly-fetched polyline + provider metadata.
    return {
      ...args.existing,
      metadata,
    };
  }

  const [left, right] = [args.spec.from.id, args.spec.to.id].sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    id: `edge_resolved_${args.spec.mode}_${left}__${right}`,
    from: left,
    to: right,
    type: args.spec.mode,
    distance_km: Number(args.liveLeg.distance_km.toFixed(1)),
    travel_time_hours: Number(args.liveLeg.travel_time_hours.toFixed(2)),
    bidirectional: true,
    regions: uniqueStrings([args.spec.from.region, args.spec.to.region]),
    metadata,
  };
}

function matchesAnySpec(edge: GraphEdge, specs: TravelSpec[]): boolean {
  return specs.some((spec) =>
    edgeMatches(edge, spec.from.id, spec.to.id, spec.mode),
  );
}

function findMatchingEdge(
  edges: GraphEdge[],
  fromId: string,
  toId: string,
  mode: TransportMode,
): GraphEdge | undefined {
  return edges.find((edge) => edgeMatches(edge, fromId, toId, mode));
}

function edgeMatches(
  edge: GraphEdge,
  fromId: string,
  toId: string,
  mode: TransportMode,
): boolean {
  if (edge.type !== mode) return false;
  if (edge.from === fromId && edge.to === toId) return true;
  return (
    edge.bidirectional !== false && edge.from === toId && edge.to === fromId
  );
}

function uniqueSpecs(specs: TravelSpec[]): TravelSpec[] {
  const seen = new Set<string>();
  const out: TravelSpec[] = [];

  for (const spec of specs) {
    const key = [
      spec.mode,
      ...[spec.from.id, spec.to.id].sort((left, right) =>
        left.localeCompare(right),
      ),
    ].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(spec);
  }

  return out;
}

function replaceEdge(edges: GraphEdge[], next: GraphEdge) {
  const index = edges.findIndex((edge) => edge.id === next.id);
  if (index >= 0) {
    edges[index] = next;
    return;
  }
  edges.push(next);
}

function indexNodes(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function dedupeConsecutive(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (out[out.length - 1] === value) continue;
    out.push(value);
  }
  return out;
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let value = start; value <= end; value += 1) out.push(value);
  return out;
}

function formatDayRange(startDay: number, endDay: number): string {
  const start = startDay + 1;
  const end = endDay + 1;
  return start === end ? `Day ${start}` : `Days ${start}-${end}`;
}

function formatStopSubtitle(stopOrders: number[]): string {
  const labels = stopOrders.map((stopOrder) => String(stopOrder + 1));
  return labels.length === 1 ? `Stop ${labels[0]}` : `Stops ${labels.join(", ")}`;
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
