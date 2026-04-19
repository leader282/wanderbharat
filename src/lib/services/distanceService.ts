import type { Coordinates, TransportMode } from "@/types/domain";
import {
  getTransportModeConfig,
  supportsLiveTravelMode as supportsLiveMode,
  type GoogleRoutesMode,
} from "@/lib/config/transportMode";
import { chunk } from "@/lib/utils/concurrency";

/**
 * Generic distance/travel-time service built on the Google Routes API.
 * Works for any two coordinates; not aware of regions.
 *
 * Exposes three entry points:
 * - {@link getTravelTime} — single origin→destination leg.
 * - {@link getTravelMatrix} — batched origin×destination matrix (up to
 *   25×25 per API call; this function tiles automatically).
 * - {@link haversineKm} — zero-dependency great-circle distance fallback.
 */

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const ROUTE_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

/** Google caps `computeRouteMatrix` to 25×25 elements per request. */
const ROUTE_MATRIX_TILE = 25;

export interface TravelLeg {
  distance_km: number;
  travel_time_hours: number;
  encoded_polyline?: string;
}

export interface GetTravelTimeOptions {
  origin: Coordinates;
  destination: Coordinates;
  mode?: TransportMode;
  apiKey?: string;
}

export interface GetTravelMatrixOptions {
  origins: Coordinates[];
  destinations: Coordinates[];
  mode: TransportMode;
  apiKey?: string;
}

/** Per-`origin,destination` result indexed by `origins[i]`, `destinations[j]`. */
export interface TravelMatrixCell {
  origin_index: number;
  destination_index: number;
  leg: TravelLeg | null;
}

export function supportsLiveTravelMode(mode: TransportMode): boolean {
  return supportsLiveMode(mode);
}

function requireKey(explicit?: string): string {
  const key = explicit ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY is not set. Add it to .env.local or pass it explicitly.",
    );
  }
  return key;
}

function googleMode(mode: TransportMode): GoogleRoutesMode | null {
  return getTransportModeConfig(mode).google_mode ?? null;
}

function routingPreference(mode: TransportMode): string | undefined {
  return mode === "road" ? "TRAFFIC_AWARE" : undefined;
}

function coordsToLatLng(c: Coordinates) {
  return { latLng: { latitude: c.lat, longitude: c.lng } };
}

/**
 * Ask Google Routes for a single origin→destination leg. Returns `null` if
 * Google has no route. Throws on non-2xx (so seeders can decide to retry).
 */
export async function getTravelTime(
  opts: GetTravelTimeOptions,
): Promise<TravelLeg | null> {
  const mode = opts.mode ?? "road";
  if (!supportsLiveTravelMode(mode)) return null;
  const google = googleMode(mode);
  if (!google) return null;

  const apiKey = requireKey(opts.apiKey);

  const body = {
    origin: { location: coordsToLatLng(opts.origin) },
    destination: { location: coordsToLatLng(opts.destination) },
    travelMode: google,
    routingPreference: routingPreference(mode),
  };

  const res = await fetch(ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Routes computeRoutes failed (${res.status}): ${text || res.statusText}`,
    );
  }

  const json = (await res.json()) as {
    routes?: Array<{
      distanceMeters?: number;
      duration?: string;
      polyline?: { encodedPolyline?: string };
    }>;
  };
  const route = json.routes?.[0];
  if (!route?.distanceMeters || !route.duration) return null;

  const seconds = parseDurationSeconds(route.duration);
  return {
    distance_km: route.distanceMeters / 1000,
    travel_time_hours: seconds / 3600,
    encoded_polyline: route.polyline?.encodedPolyline,
  };
}

/**
 * Resolve an O×D matrix of travel legs for a single mode. Tiles into
 * 25×25 requests (Google's cap) and issues them in parallel. The result
 * array contains one entry per `(origin_index, destination_index)` pair
 * plus a `null` leg when the pair is unreachable.
 */
export async function getTravelMatrix(
  opts: GetTravelMatrixOptions,
): Promise<TravelMatrixCell[]> {
  if (opts.origins.length === 0 || opts.destinations.length === 0) return [];
  if (!supportsLiveTravelMode(opts.mode)) {
    return [];
  }
  const google = googleMode(opts.mode);
  if (!google) return [];

  const apiKey = requireKey(opts.apiKey);
  const originTiles = chunk(opts.origins, ROUTE_MATRIX_TILE);
  const destinationTiles = chunk(opts.destinations, ROUTE_MATRIX_TILE);

  const jobs: Array<{
    oOffset: number;
    dOffset: number;
    originTile: Coordinates[];
    destinationTile: Coordinates[];
  }> = [];

  let oOffset = 0;
  for (const originTile of originTiles) {
    let dOffset = 0;
    for (const destinationTile of destinationTiles) {
      jobs.push({ oOffset, dOffset, originTile, destinationTile });
      dOffset += destinationTile.length;
    }
    oOffset += originTile.length;
  }

  const results = await Promise.all(
    jobs.map((job) =>
      fetchMatrixTile({
        apiKey,
        travelMode: google,
        routingPreference: routingPreference(opts.mode),
        origins: job.originTile,
        destinations: job.destinationTile,
      }).then((cells) =>
        cells.map((cell) => ({
          origin_index: cell.origin_index + job.oOffset,
          destination_index: cell.destination_index + job.dOffset,
          leg: cell.leg,
        })),
      ),
    ),
  );

  return results.flat();
}

async function fetchMatrixTile(args: {
  apiKey: string;
  travelMode: GoogleRoutesMode;
  routingPreference?: string;
  origins: Coordinates[];
  destinations: Coordinates[];
}): Promise<TravelMatrixCell[]> {
  const body = {
    origins: args.origins.map((c) => ({
      waypoint: { location: coordsToLatLng(c) },
    })),
    destinations: args.destinations.map((c) => ({
      waypoint: { location: coordsToLatLng(c) },
    })),
    travelMode: args.travelMode,
    routingPreference: args.routingPreference,
  };

  const res = await fetch(ROUTE_MATRIX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": args.apiKey,
      "X-Goog-FieldMask":
        "originIndex,destinationIndex,distanceMeters,duration,condition",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Routes computeRouteMatrix failed (${res.status}): ${text || res.statusText}`,
    );
  }

  type MatrixRow = {
    originIndex?: number;
    destinationIndex?: number;
    distanceMeters?: number;
    duration?: string;
    condition?: string;
  };

  // computeRouteMatrix returns either a single JSON array or a newline-
  // delimited stream depending on streaming preferences. Handle both.
  const raw = await res.text();
  const rows: MatrixRow[] = raw.trim().startsWith("[")
    ? (JSON.parse(raw) as MatrixRow[])
    : raw
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as MatrixRow);

  const out: TravelMatrixCell[] = [];
  for (const row of rows) {
    if (row.originIndex === undefined || row.destinationIndex === undefined) {
      continue;
    }
    const reachable =
      row.condition === "ROUTE_EXISTS" &&
      row.distanceMeters !== undefined &&
      row.duration !== undefined;
    out.push({
      origin_index: row.originIndex,
      destination_index: row.destinationIndex,
      leg: reachable
        ? {
            distance_km: (row.distanceMeters ?? 0) / 1000,
            travel_time_hours:
              parseDurationSeconds(row.duration ?? "0s") / 3600,
          }
        : null,
    });
  }
  return out;
}

/** Duration arrives as "1234s" per the proto3 wire format. */
function parseDurationSeconds(d: string): number {
  const m = /^(-?\d+(?:\.\d+)?)s$/.exec(d);
  if (!m) return 0;
  return Number(m[1]);
}

/**
 * Great-circle distance in kilometres. Pure, no network, deterministic —
 * ideal for unit tests and the engine's "proximity" scoring.
 */
export function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
