import type { Itinerary } from "@/types/domain";

export interface DisplayRouteStop {
  id: string;
  name: string;
}

export function getDisplayRouteStops(itinerary: Itinerary): DisplayRouteStop[] {
  const fromNodes = resolveRouteStopsFromNodeSequence(itinerary);
  if (fromNodes.length > 0) return fromNodes;

  return dedupeConsecutiveStops(
    itinerary.day_plan
      .filter((day) => day.base_node_id && day.base_node_name)
      .map((day) => ({
        id: day.base_node_id,
        name: day.base_node_name,
      })),
  );
}

export function getRouteEndpoints(itinerary: Itinerary): {
  startName: string;
  endName: string;
} {
  const stops = getDisplayRouteStops(itinerary);
  const fallbackStart = itinerary.day_plan[0]?.base_node_name ?? "your start";
  const startName = stops[0]?.name ?? fallbackStart;
  const endName = stops.at(-1)?.name ?? startName;
  return { startName, endName };
}

export function getDistinctDestinationCount(itinerary: Itinerary): number {
  const stops = getDisplayRouteStops(itinerary);
  if (stops.length === 0) return 0;
  return new Set(stops.map((stop) => stop.id)).size;
}

function resolveRouteStopsFromNodeSequence(
  itinerary: Itinerary,
): DisplayRouteStop[] {
  if (!Array.isArray(itinerary.nodes) || itinerary.nodes.length === 0) return [];

  const nameById = new Map<string, string>();
  for (const day of itinerary.day_plan) {
    if (!day.base_node_id || !day.base_node_name) continue;
    nameById.set(day.base_node_id, day.base_node_name);
  }

  const stops = itinerary.nodes.map((id) => ({
    id,
    name: nameById.get(id) ?? "",
  }));

  if (stops.some((stop) => stop.name.length === 0)) return [];
  return dedupeConsecutiveStops(stops);
}

function dedupeConsecutiveStops<T extends DisplayRouteStop>(stops: T[]): T[] {
  const out: T[] = [];
  for (const stop of stops) {
    if (out[out.length - 1]?.id === stop.id) continue;
    out.push(stop);
  }
  return out;
}
