import { averageSpeedKmH } from "@/lib/config/transportMode";
import type { Coordinates, GraphNode } from "@/types/domain";

export const DISTANCE_UNAVAILABLE_TEXT = "Distance unavailable";

const EARTH_RADIUS_KM = 6371;
const DEFAULT_ROAD_DETOUR_FACTOR = 1.3;
const ROAD_DETOUR_FACTOR_BY_REGION: Partial<Record<string, number>> = {};
const ROAD_SPEED_KMH = averageSpeedKmH("road");

export type DistanceFitLabel =
  | "Nearby"
  | "Easy add-on"
  | "Comfortable"
  | "Long detour"
  | "Better for longer trips";

export interface OptionalCityDistanceInfo {
  cityId: string;
  cityName: string;
  distanceKm: number | null;
  driveTimeMinutes: number | null;
  fitLabel: DistanceFitLabel | null;
  isApproximate: boolean;
  source: "approx_haversine" | "unavailable";
}

export function getOptionalCityDistanceInfo(
  startCity: GraphNode | undefined,
  optionalCity: GraphNode,
  region?: string,
): OptionalCityDistanceInfo {
  if (!startCity) {
    return unavailableDistanceInfo(optionalCity);
  }

  const regionHint = region ?? startCity.region ?? optionalCity.region;
  const distanceKm = estimateRoadDistanceKm(
    startCity.location,
    optionalCity.location,
    regionHint,
  );

  if (distanceKm === null) {
    return unavailableDistanceInfo(optionalCity);
  }

  const driveTimeMinutes = estimateDriveTimeMinutes(distanceKm);

  return {
    cityId: optionalCity.id,
    cityName: optionalCity.name,
    distanceKm,
    driveTimeMinutes,
    fitLabel: getDistanceFitLabel(driveTimeMinutes),
    isApproximate: true,
    source: "approx_haversine",
  };
}

export function sortOptionalCitiesByDriveTime(
  items: OptionalCityDistanceInfo[],
): OptionalCityDistanceInfo[] {
  return [...items].sort((a, b) => {
    if (a.driveTimeMinutes === null && b.driveTimeMinutes === null) {
      return a.cityName.localeCompare(b.cityName);
    }
    if (a.driveTimeMinutes === null) return 1;
    if (b.driveTimeMinutes === null) return -1;
    if (a.driveTimeMinutes !== b.driveTimeMinutes) {
      return a.driveTimeMinutes - b.driveTimeMinutes;
    }
    return a.cityName.localeCompare(b.cityName);
  });
}

export function formatDistanceKm(
  distanceKm: number | null,
  isApproximate: boolean,
): string {
  if (distanceKm === null) return DISTANCE_UNAVAILABLE_TEXT;
  const roundedKm = Math.max(0, Math.round(distanceKm));
  const base = `${roundedKm.toLocaleString("en-IN")} km`;
  return isApproximate ? `~${base}` : base;
}

export function formatDriveTime(
  minutes: number | null,
  isApproximate: boolean,
): string {
  if (minutes === null) return DISTANCE_UNAVAILABLE_TEXT;

  const roundedMinutes = Math.max(0, Math.round(minutes / 5) * 5);
  const hours = Math.floor(roundedMinutes / 60);
  const mins = roundedMinutes % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (parts.length === 0) parts.push("0m");

  const base = parts.join(" ");
  return isApproximate ? `~${base}` : base;
}

export function getDistanceFitLabel(
  minutes: number | null,
): DistanceFitLabel | null {
  if (minutes === null) return null;
  if (minutes <= 75) return "Nearby";
  if (minutes <= 150) return "Easy add-on";
  if (minutes <= 270) return "Comfortable";
  if (minutes <= 390) return "Long detour";
  return "Better for longer trips";
}

function unavailableDistanceInfo(city: GraphNode): OptionalCityDistanceInfo {
  return {
    cityId: city.id,
    cityName: city.name,
    distanceKm: null,
    driveTimeMinutes: null,
    fitLabel: null,
    isApproximate: false,
    source: "unavailable",
  };
}

function estimateRoadDistanceKm(
  from: Coordinates,
  to: Coordinates,
  region: string | undefined,
): number | null {
  if (!isValidCoordinates(from) || !isValidCoordinates(to)) return null;
  const directDistanceKm = haversineKm(from, to);
  if (!Number.isFinite(directDistanceKm)) return null;
  const detourFactor = roadDetourFactor(region);
  const estimated = directDistanceKm * detourFactor;
  return Number(estimated.toFixed(1));
}

function estimateDriveTimeMinutes(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  const minutes = (distanceKm / ROAD_SPEED_KMH) * 60;
  return Number(minutes.toFixed(1));
}

function roadDetourFactor(region: string | undefined): number {
  if (!region) return DEFAULT_ROAD_DETOUR_FACTOR;
  return ROAD_DETOUR_FACTOR_BY_REGION[region.toLowerCase()] ?? DEFAULT_ROAD_DETOUR_FACTOR;
}

function isValidCoordinates(value: Coordinates): boolean {
  return (
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    Math.abs(value.lat) <= 90 &&
    Math.abs(value.lng) <= 180
  );
}

function haversineKm(a: Coordinates, b: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const startLat = toRadians(a.lat);
  const endLat = toRadians(b.lat);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(haversine)));
}
