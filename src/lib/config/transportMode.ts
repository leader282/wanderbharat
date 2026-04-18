import { TRANSPORT_MODES, type TransportMode } from "@/types/domain";

/**
 * Single source of truth for per-mode travel physics, cost, fatigue, and
 * third-party routing hooks. The engine, graph fallback, distance service,
 * and cost estimator all read from here — adding a new value to
 * {@link TRANSPORT_MODES} plus a matching entry below is the complete
 * change-set for a new mode.
 */
export type GoogleRoutesMode =
  | "DRIVE"
  | "BICYCLE"
  | "WALK"
  | "TWO_WHEELER"
  | "TRANSIT";

export interface TransportModeConfig {
  /** Average speed used to fall back when no edge / live leg exists. */
  avg_speed_kmh: number;
  /**
   * Default per-km cost in the engine's base currency (engine pipes
   * `region.default_currency` through; absolute number only used when a
   * region override is absent).
   */
  per_km_cost: number;
  /**
   * Multiplier on in-seat hours for the fatigue computation.
   * 1.0 = equivalent to an hour of driving. 0.3 = pressurised airliner.
   */
  fatigue_factor: number;
  /**
   * Ideal radius for the proximity-scoring Gaussian. Road-trips peak at a
   * few hundred km; flights should peak at a thousand-plus km.
   */
  ideal_radius_km: number;
  /**
   * True when the {@link getTravelTime} live-routing call can resolve this
   * mode via Google Routes. False for modes we have no live provider for
   * (e.g. `flight` without a flight aggregator).
   */
  supports_live_routing: boolean;
  /** Corresponding `travelMode` value on the Routes API. */
  google_mode?: GoogleRoutesMode;
  /** Maximum travel-time cap per day as a multiplier of the style config. */
  max_daily_hours_factor: number;
}

export const transportModeConfig: Record<TransportMode, TransportModeConfig> = {
  road: {
    avg_speed_kmh: 55,
    per_km_cost: 12,
    fatigue_factor: 1.0,
    ideal_radius_km: 400,
    supports_live_routing: true,
    google_mode: "DRIVE",
    max_daily_hours_factor: 1.0,
  },
  train: {
    avg_speed_kmh: 70,
    per_km_cost: 2,
    fatigue_factor: 0.5,
    ideal_radius_km: 600,
    supports_live_routing: true,
    google_mode: "TRANSIT",
    max_daily_hours_factor: 1.4,
  },
  flight: {
    avg_speed_kmh: 600,
    per_km_cost: 8,
    fatigue_factor: 0.3,
    ideal_radius_km: 1500,
    supports_live_routing: false,
    max_daily_hours_factor: 0.8,
  },
};

/** Accessor; throws if a mode is missing its config (programming error). */
export function getTransportModeConfig(mode: TransportMode): TransportModeConfig {
  const cfg = transportModeConfig[mode];
  if (!cfg) {
    throw new Error(
      `No TransportModeConfig registered for "${mode}". Add it to transportModeConfig.`,
    );
  }
  return cfg;
}

/** True if the live-routing API supports this mode. */
export function supportsLiveTravelMode(mode: TransportMode): boolean {
  return getTransportModeConfig(mode).supports_live_routing;
}

/** Average travel speed in km/h, config-driven. */
export function averageSpeedKmH(mode: TransportMode): number {
  return getTransportModeConfig(mode).avg_speed_kmh;
}

/** Default cost per km for a mode; callers can override from edge metadata. */
export function defaultPerKmCost(mode: TransportMode): number {
  return getTransportModeConfig(mode).per_km_cost;
}

/** Per-mode fatigue weight used when penalising heavy travel days. */
export function fatigueFactor(mode: TransportMode): number {
  return getTransportModeConfig(mode).fatigue_factor;
}

/** Per-mode "ideal distance" used by the proximity scoring Gaussian. */
export function idealRadiusKm(mode: TransportMode): number {
  return getTransportModeConfig(mode).ideal_radius_km;
}

/** Max travel-hours-per-day cap for a given mode, derived from style. */
export function maxDailyHoursFor(
  mode: TransportMode,
  baseHours: number,
): number {
  return baseHours * getTransportModeConfig(mode).max_daily_hours_factor;
}

/** All modes known at compile time. Handy for UIs that need defaults. */
export function allTransportModes(): readonly TransportMode[] {
  return TRANSPORT_MODES;
}
