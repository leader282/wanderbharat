/**
 * wanderbharat — core domain types.
 *
 * Everything here is deliberately generic. Nothing in this file should
 * reference Rajasthan, India, "city vs state", or any specific region.
 * Regions exist only as string slugs persisted in the database.
 */

// ============================================================================
// Extensible enums — implemented as string-literal unions + runtime arrays so
// new values can be added in one place and they remain open for extension
// without breaking existing data.
// ============================================================================

/** Graph node categories. Future: "restaurant", "activity", etc. */
export const NODE_TYPES = [
  "city",
  "attraction",
  "hotel",
  "transport_hub",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Edge transport modes. Future: "bus", "ferry", "metro", etc. */
export const TRANSPORT_MODES = [
  "road",
  "train",
  "flight",
] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/**
 * Travel style controls pacing. The engine translates this into concrete
 * per-day constraints via {@link TravelStyleConfig}. Add new values here and
 * in the config map; engine code never branches on a specific value.
 */
export const TRAVEL_STYLES = [
  "relaxed",
  "balanced",
  "adventurous",
] as const;
export type TravelStyle = (typeof TRAVEL_STYLES)[number];

/**
 * Free-form preference tags that can match node tags (e.g. "heritage",
 * "food", "wildlife", "luxury", "spiritual"). Kept as `string` to allow the
 * UI and seed data to evolve independently of the engine.
 */
export type PreferenceTag = string;

// ============================================================================
// Geo primitives
// ============================================================================

export interface Coordinates {
  lat: number;
  lng: number;
}

// ============================================================================
// Graph primitives
// ============================================================================

/**
 * Generic graph node. Concrete subtypes (city, attraction, ...) refine
 * {@link GraphNode.metadata} but share this shape so the engine can treat
 * them uniformly.
 */
export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  /** Lowercase region slug, e.g. "rajasthan". Comes from DB, never hardcoded. */
  region: string;
  /** Lowercase country slug, e.g. "india". */
  country: string;
  tags: PreferenceTag[];
  metadata: NodeMetadata;
  location: Coordinates;
  /** Optional parent node id (e.g. attraction belongs to a city). */
  parent_node_id?: string;
  /** Free-form flag for seed data provenance. */
  source?: "seed" | "google_places" | "manual";
}

export interface NodeMetadata {
  /** Average daily cost for a traveller while spending time at this node. */
  avg_daily_cost?: number;
  /** Recommended total hours to experience this node. */
  recommended_hours?: number;
  /** Short human-readable description for UI. */
  description?: string;
  /** Optional image URL for UI. */
  image_url?: string;
  /** Google Places `place_id` if derived from Google. */
  google_place_id?: string;
  /** Allow any forward-compatible extras without breaking typing. */
  [key: string]: unknown;
}

/**
 * Generic edge between two nodes. The engine reads `travel_time_hours` and
 * `distance_km`; mode-specific details live in `metadata`.
 */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: TransportMode;
  distance_km: number;
  travel_time_hours: number;
  /** True if the edge is valid in the reverse direction. Defaults to true. */
  bidirectional?: boolean;
  /**
   * Denormalised region slugs of both endpoints. A same-region edge has
   * a single-element array; a cross-region edge (e.g. Jaipur→Delhi
   * flight, Udaipur→Ahmedabad road) carries both. Indexed with
   * `array-contains-any` for fast scoped graph loads.
   */
  regions: string[];
  /**
   * @deprecated kept only for backwards-compatibility with documents
   * written before `regions: string[]` was introduced. New writes should
   * set {@link regions}. Reads coerce legacy docs at the repository layer.
   */
  region?: string;
  metadata: EdgeMetadata;
}

export interface EdgeMetadata {
  road_quality?: "poor" | "average" | "good" | "excellent";
  /** Base price per person for train/flight; future dynamic pricing hook. */
  base_price?: number;
  /** Free-form extras. */
  [key: string]: unknown;
}

// ============================================================================
// Preferences + itinerary request
// ============================================================================

export interface BudgetRange {
  min: number;
  max: number;
  /** ISO 4217 code, e.g. "INR". Optional for MVP. */
  currency?: string;
}

export interface ItineraryPreferences {
  travel_style: TravelStyle;
  budget: BudgetRange;
  /** Optional preference tags to prioritise (e.g. ["heritage", "food"]). */
  interests?: PreferenceTag[];
  /** Optional preferred transport modes. Defaults to ["road"]. */
  transport_modes?: TransportMode[];
}

export interface GenerateItineraryInput {
  /** Primary region; used for persistence + default scoping. */
  region: string;
  /**
   * Optional additional regions to consider as candidates. Lets a trip
   * cross region borders without requiring cross-region edges up front
   * (the engine falls back to live-routing / haversine between regions).
   */
  regions?: string[];
  start_node: string;
  /** Optional — defaults to the same as start_node (round-trip). */
  end_node?: string;
  days: number;
  preferences: ItineraryPreferences;
  /** Optional user id for persistence. */
  user_id?: string;
}

// ============================================================================
// Region catalogue (consumed by /api/regions + the UI)
// ============================================================================

export interface RegionSummary {
  region: string;
  country: string;
  /** Number of `city` nodes in this region. */
  count: number;
  /** ISO 4217 code used for budgets in this region's currency. */
  default_currency?: string;
  /** BCP-47 locale used for number/date formatting in the UI. */
  default_locale?: string;
  /** Transport modes the region has data for; used as UI defaults. */
  default_transport_modes?: TransportMode[];
  /** Axis-aligned bounding box of the region's cities. */
  bbox?: { min_lat: number; min_lng: number; max_lat: number; max_lng: number };
}

// ============================================================================
// Itinerary output shape
// ============================================================================

/** A single activity / experience within a day. */
export interface ItineraryActivity {
  node_id: string;
  name: string;
  type: NodeType;
  /** Estimated hours to spend on this activity. */
  duration_hours: number;
  tags: PreferenceTag[];
  description?: string;
}

/** A contiguous day within an itinerary. */
export interface ItineraryDay {
  day_index: number;
  base_node_id: string;
  base_node_name: string;
  /** Optional travel leg consumed during this day (null on arrival days). */
  travel?: {
    from_node_id: string;
    to_node_id: string;
    transport_mode: TransportMode;
    distance_km: number;
    travel_time_hours: number;
  };
  activities: ItineraryActivity[];
  total_activity_hours: number;
  total_travel_hours: number;
}

/** Full itinerary — persisted to Firestore as-is. */
export interface Itinerary {
  id: string;
  user_id: string | null;
  region: string;
  start_node: string;
  end_node: string;
  days: number;
  preferences: ItineraryPreferences;
  /** Ordered list of city/node ids the itinerary visits. */
  nodes: string[];
  /** Per-day breakdown built by the engine. */
  day_plan: ItineraryDay[];
  /** Total estimated cost across the whole trip. */
  estimated_cost: number;
  /** Normalised 0..1 score from the scoring function. */
  score: number;
  created_at: number;
  /** Optional warnings surfaced by the constraint engine. */
  warnings?: string[];
}

// ============================================================================
// Errors
// ============================================================================

export type ConstraintErrorReason =
  | "travel_time_exceeded"
  | "total_time_exceeded"
  | "budget_too_low"
  | "budget_exceeded"
  | "no_feasible_route"
  | "insufficient_nodes"
  | "invalid_input";

export interface ConstraintError {
  error: "constraint_violation";
  reason: ConstraintErrorReason;
  message: string;
  suggestion?: string;
  details?: Record<string, unknown>;
}
