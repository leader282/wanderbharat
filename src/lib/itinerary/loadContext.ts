import type { EngineContext } from "@/lib/itinerary/engine";
import type { GraphNode, TransportMode } from "@/types/domain";
import { getTravelStyleConfig } from "@/lib/config/travelStyle";
import { averageSpeedKmH } from "@/lib/config/transportMode";
import { findEdges } from "@/lib/repositories/edgeRepository";
import { findNodes, getNodes } from "@/lib/repositories/nodeRepository";
import { getAttractionOpeningHoursByAttractionIds } from "@/lib/repositories/attractionHoursRepository";
import { listByAttractionIds } from "@/lib/repositories/attractionAdmissionRepository";
import { haversineKm } from "@/lib/services/distanceService";

/**
 * Fetch everything the engine needs for a planning run.
 *
 * The loader is planning-aware: it takes the request's start/end/days/modes
 * and prunes candidates to nodes reachable within a radius derived from
 * the trip envelope, so it scales to large regions without buffering the
 * whole graph in memory.
 */

export interface PlanContextRequest {
  regions: string[];
  start_node_id: string;
  end_node_id?: string;
  requested_city_ids?: string[];
  days: number;
  modes: TransportMode[];
  travel_style: "relaxed" | "balanced" | "adventurous";
  /** Node-count cap per planning run; protects the DFS + matrix. */
  maxCandidateNodes?: number;
}

const DEFAULT_MAX_CANDIDATES = 60;

export async function loadEngineContextForPlan(
  req: PlanContextRequest,
): Promise<EngineContext> {
  const regions = Array.from(new Set(req.regions));
  if (regions.length === 0) {
    throw new Error("At least one region is required.");
  }

  // 1. Resolve start/end first so we can derive a planning radius.
  const endId = req.end_node_id ?? req.start_node_id;
  const pinnedIds = Array.from(
    new Set([
      req.start_node_id,
      endId,
      ...(req.requested_city_ids ?? []),
    ]),
  );
  const pinned = await getNodes(
    pinnedIds,
  );
  if (pinned.length === 0) {
    throw new Error(`Start node "${req.start_node_id}" not found.`);
  }
  const start = pinned.find((n) => n.id === req.start_node_id);
  if (!start) {
    throw new Error(`Start node "${req.start_node_id}" not found.`);
  }

  const cfg = getTravelStyleConfig(req.travel_style);
  const radius_km = computePlanningRadiusKm(cfg, req.days, req.modes);

  // 2. Stream cities in the allowed regions; bbox-prune client-side.
  //    (Real scale wants a geohash field; until then we rely on the
  //    region filter + haversine pruning which is still O(N) reads.)
  const cityLimit = req.maxCandidateNodes ?? DEFAULT_MAX_CANDIDATES;
  const cities = await findNodes({ regions, type: "city" });
  const inRange = cities
    .map((city) => ({ city, d: haversineKm(start.location, city.location) }))
    .filter((entry) => entry.d <= radius_km)
    .sort((a, b) => a.d - b.d)
    .slice(0, cityLimit)
    .map((entry) => entry.city);

  const cityIds = new Set<string>(inRange.map((c) => c.id));
  const explicitlyRequestedCities = pinned.filter(
    (node) => node.type === "city" && regions.includes(node.region),
  );
  for (const city of explicitlyRequestedCities) {
    cityIds.add(city.id);
  }
  cityIds.add(start.id);
  cityIds.add(endId);

  // 3. Attractions — only for the cities we actually care about. Firestore
  //    lacks a direct "parent in [...]" cheap query, so fan out in batches
  //    of 10 via the repo's multi-get pattern.
  const attractions: GraphNode[] = [];
  const selectedCities = dedupeById([...inRange, ...explicitlyRequestedCities]);
  for (const city of selectedCities) {
    attractions.push(
      ...(await findNodes({
        regions,
        type: "attraction",
        parent_node_id: city.id,
      })),
    );
  }

  const attractionIds = attractions.map((attraction) => attraction.id);
  const [attractionHours, attractionAdmissions] = await Promise.all([
    getAttractionOpeningHoursByAttractionIds(attractionIds),
    listByAttractionIds(attractionIds),
  ]);
  const openingHoursByAttractionId = new Map(
    attractionHours.map((entry) => [entry.attraction_id, entry]),
  );
  const admissionRulesByAttractionId = new Map<string, typeof attractionAdmissions>();
  for (const rule of attractionAdmissions) {
    const list = admissionRulesByAttractionId.get(rule.attraction_node_id) ?? [];
    list.push(rule);
    admissionRulesByAttractionId.set(rule.attraction_node_id, list);
  }
  const attractionsWithHours = attractions.map((attraction) => {
    const openingHours = openingHoursByAttractionId.get(attraction.id);
    const admissionRules = admissionRulesByAttractionId.get(attraction.id) ?? [];
    if (!openingHours && admissionRules.length === 0) return attraction;
    // Build the metadata patch as a spread instead of explicit `undefined`
    // assignments so we never clobber pre-existing fields with `undefined`
    // (which would otherwise be persisted as a real undefined value and
    // confuse downstream consumers).
    const metadata: typeof attraction.metadata = { ...attraction.metadata };
    if (openingHours) {
      metadata.opening_hours = openingHours;
    }
    if (admissionRules.length > 0) {
      metadata.admission_rules = admissionRules;
    }
    return { ...attraction, metadata };
  });

  const attractionsByCity = new Map<string, GraphNode[]>();
  for (const a of attractionsWithHours) {
    const parent = a.parent_node_id;
    if (!parent) continue;
    const list = attractionsByCity.get(parent) ?? [];
    list.push(a);
    attractionsByCity.set(parent, list);
  }

  // 4. Edges — only those touching at least one selected city. Firestore
  //    limits `in` to 10 ids so we fan out in batches.
  const edges = await loadEdgesForCities(Array.from(cityIds), regions);

  const nodes = dedupeById([...pinned, ...selectedCities, ...attractionsWithHours]);

  return {
    nodes,
    edges,
    attractionsByCity,
  };
}

async function loadEdgesForCities(
  cityIds: string[],
  regions: string[],
): Promise<EngineContext["edges"]> {
  if (cityIds.length === 0) return [];
  const seen = new Set<string>();
  const out: EngineContext["edges"] = [];

  // 10 ids per `from in [...]` call — Firestore's cap.
  for (let i = 0; i < cityIds.length; i += 10) {
    const slice = cityIds.slice(i, i + 10);
    const chunk = await findEdges({ regions, fromIds: slice });
    for (const edge of chunk) {
      if (seen.has(edge.id)) continue;
      seen.add(edge.id);
      out.push(edge);
    }
  }
  return out;
}

function computePlanningRadiusKm(
  cfg: { maxTravelHoursPerDay: number },
  days: number,
  modes: TransportMode[],
): number {
  // Estimate how far the fastest allowed mode could plausibly take a user
  // over the trip. Multiply by 1.5 for slack and a minimum floor so tiny
  // round-trips don't prune out everything interesting.
  const fastest = modes.reduce(
    (max, mode) => Math.max(max, averageSpeedKmH(mode)),
    0,
  );
  const reach = fastest * cfg.maxTravelHoursPerDay * Math.max(1, days) * 1.5;
  return Math.max(150, reach);
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
