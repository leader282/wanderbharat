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
export const TRANSPORT_MODES = ["road", "train", "flight"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/**
 * Travel style controls pacing. The engine translates this into concrete
 * per-day constraints via {@link TravelStyleConfig}. Add new values here and
 * in the config map; engine code never branches on a specific value.
 */
export const TRAVEL_STYLES = ["relaxed", "balanced", "adventurous"] as const;
export type TravelStyle = (typeof TRAVEL_STYLES)[number];

export const ACCOMMODATION_CATEGORIES = [
  "budget",
  "midrange",
  "premium",
  "hostel",
  "heritage",
  "resort",
] as const;
export type AccommodationCategory = (typeof ACCOMMODATION_CATEGORIES)[number];

export const ACCOMMODATION_PREFERENCES = [
  "auto",
  "budget",
  "midrange",
  "premium",
] as const;
export type AccommodationPreference =
  (typeof ACCOMMODATION_PREFERENCES)[number];

/**
 * Free-form preference tags that can match node tags (e.g. "heritage",
 * "food", "wildlife", "luxury", "spiritual"). Kept as `string` to allow the
 * UI and seed data to evolve independently of the engine.
 */
export type PreferenceTag = string;

// ============================================================================
// Real-world data provenance primitives (prototype v2)
// ============================================================================

export const DATA_SOURCE_TYPES = [
  "manual",
  "google_places",
  "liteapi",
  "official_website",
  "estimated",
  "mock",
  "system",
] as const;
export type DataSourceType = (typeof DATA_SOURCE_TYPES)[number];

export const DATA_CONFIDENCE_LEVELS = [
  "live",
  "verified",
  "cached",
  "estimated",
  "unknown",
] as const;
export type DataConfidence = (typeof DATA_CONFIDENCE_LEVELS)[number];

export const OPENING_HOURS_CONFIDENCE_LEVELS = [
  "live",
  "verified",
  "cached",
  "estimated",
  "unknown",
] as const;
export type OpeningHoursConfidence =
  (typeof OPENING_HOURS_CONFIDENCE_LEVELS)[number];

export const OPENING_HOURS_WEEKDAYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;
export type OpeningHoursWeekday = (typeof OPENING_HOURS_WEEKDAYS)[number];

/**
 * Single-day opening window. `opens`/`closes` are local-time `HH:MM`
 * strings on the same calendar day — i.e. `closes > opens`.
 *
 * Overnight venues (e.g. open Sun 22:00 and closing Mon 02:00) must be
 * ingested as two separate records, one per calendar day, until v2
 * introduces explicit cross-midnight resolution. Daytime attractions —
 * which is what the prototype targets — fit cleanly in this single-day
 * model and map directly to Google Places `regularOpeningHours.periods`
 * after splitting any midnight-crossing entries during ingestion.
 */
export interface OpeningPeriod {
  day: OpeningHoursWeekday;
  opens: string;
  closes: string;
}

export interface OpeningTimeRange {
  opens: string;
  closes: string;
}

export interface OpeningHoursException {
  /** Local date in YYYY-MM-DD format. */
  date: string;
  /** Optional hard closure override for the specific date. */
  closed?: boolean;
  opens?: string;
  closes?: string;
}

export interface AttractionOpeningHours {
  id: string;
  attraction_id: string;
  region: string;
  timezone?: string | null;
  weekly_periods: OpeningPeriod[];
  closed_days?: OpeningHoursWeekday[];
  /**
   * Optional placeholder for future one-off overrides. V1 keeps weekly periods
   * authoritative and does not fully resolve exceptions yet.
   */
  exceptions?: OpeningHoursException[];
  source_type: DataSourceType;
  confidence: OpeningHoursConfidence;
  fetched_at?: number | null;
  verified_at?: number | null;
  updated_at?: number;
}

/**
 * Pricing axes for attraction admissions. Modelled as orthogonal dimensions
 * so a single ticket variant (e.g. "foreign adult student") can be expressed
 * without combinatorial enums and without conflating age, citizenship, and
 * status.
 */
export const ATTRACTION_ADMISSION_AUDIENCES = [
  "adult",
  "child",
  "senior",
] as const;
export type AttractionAdmissionAudience =
  (typeof ATTRACTION_ADMISSION_AUDIENCES)[number];

export const ATTRACTION_ADMISSION_NATIONALITIES = [
  "any",
  "domestic",
  "foreigner",
] as const;
export type AttractionAdmissionNationality =
  (typeof ATTRACTION_ADMISSION_NATIONALITIES)[number];

export const ATTRACTION_ADMISSION_SOURCE_TYPES = [
  "official_website",
  "manual",
  "estimated",
  "google_places",
  "system",
] as const;
export type AttractionAdmissionSourceType =
  (typeof ATTRACTION_ADMISSION_SOURCE_TYPES)[number];

export const ATTRACTION_ADMISSION_CONFIDENCE_LEVELS = [
  "verified",
  "estimated",
  "unknown",
] as const;
export type AttractionAdmissionConfidence =
  (typeof ATTRACTION_ADMISSION_CONFIDENCE_LEVELS)[number];

export interface AttractionAdmissionRule {
  id: string;
  attraction_node_id: string;
  /** Optional denormalised region slug for admin filtering/purge jobs. */
  region?: string;
  currency: string;
  /** `null` means unknown (never silently treated as free/zero). */
  amount: number | null;
  /** Age bracket the price applies to. */
  audience: AttractionAdmissionAudience;
  /** Citizenship bracket the price applies to. `any` covers all visitors. */
  nationality: AttractionAdmissionNationality;
  /** True when the price is restricted to students (orthogonal to audience). */
  is_student?: boolean;
  source_type: AttractionAdmissionSourceType;
  confidence: AttractionAdmissionConfidence;
  source_url?: string | null;
  notes?: string | null;
  /** Local date in YYYY-MM-DD format. */
  valid_from?: string | null;
  /** Local date in YYYY-MM-DD format. */
  valid_until?: string | null;
  fetched_at?: number | null;
  verified_at?: number | null;
  verified_by?: string | null;
  data_version: number;
}

/** Bump when source-record schema contracts are intentionally versioned. */
export const CURRENT_DATA_VERSION = 2 as const;

export interface DataProvenance {
  data_version: number;
  source_type: DataSourceType;
  confidence: DataConfidence;
  source_url?: string | null;
  fetched_at?: number | null;
  verified_at?: number | null;
  verified_by?: string | null;
}

const REAL_DATA_CONFIDENCE = new Set<DataConfidence>([
  "live",
  "verified",
  "cached",
]);
const NON_REAL_DATA_SOURCES = new Set<DataSourceType>(["mock", "estimated"]);

/**
 * True when data is sourced from a non-mock provider and marked as
 * live/verified/cached. Estimated and unknown values remain non-real.
 */
export function isRealData(
  provenance: Pick<DataProvenance, "source_type" | "confidence">,
): boolean {
  if (NON_REAL_DATA_SOURCES.has(provenance.source_type)) {
    return false;
  }
  return REAL_DATA_CONFIDENCE.has(provenance.confidence);
}

export const DEFAULT_DATA_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Determines staleness without reading the clock implicitly.
 * Callers must provide `nowMs` to keep behavior deterministic in tests.
 */
export function isStaleData(
  provenance: Pick<DataProvenance, "confidence" | "fetched_at" | "verified_at">,
  nowMs: number,
  staleAfterMs = DEFAULT_DATA_STALE_AFTER_MS,
): boolean {
  if (provenance.confidence === "live") {
    return false;
  }

  const freshestTimestamp = provenance.verified_at ?? provenance.fetched_at;
  if (freshestTimestamp == null) {
    return provenance.confidence === "cached";
  }

  if (freshestTimestamp >= nowMs) {
    return false;
  }

  return nowMs - freshestTimestamp > staleAfterMs;
}

export interface MockDataAssertionOptions {
  nodeEnv?: string;
}

/**
 * Guards against accidentally serving mock-tagged payloads in production.
 * It also flags the legacy `source: "mock"` marker during transition periods.
 */
export function assertNoMockInProductionData(
  value: unknown,
  options: MockDataAssertionOptions = {},
): void {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv !== "production") {
    return;
  }

  const visited = new WeakSet<object>();

  const visit = (candidate: unknown, path: string): void => {
    if (candidate === null || candidate === undefined) {
      return;
    }
    if (typeof candidate !== "object") {
      return;
    }

    if (visited.has(candidate)) {
      return;
    }
    visited.add(candidate);

    if (Array.isArray(candidate)) {
      for (let index = 0; index < candidate.length; index += 1) {
        visit(candidate[index], `${path}[${index}]`);
      }
      return;
    }

    const record = candidate as Record<string, unknown>;
    if (record.source_type === "mock" || record.source === "mock") {
      throw new Error(`Mock data is not allowed in production at ${path}`);
    }

    for (const [key, nestedValue] of Object.entries(record)) {
      visit(nestedValue, `${path}.${key}`);
    }
  };

  visit(value, "$");
}

export const DATA_CONFIDENCE_LABELS: Record<DataConfidence, string> = {
  live: "Live",
  verified: "Verified",
  cached: "Cached",
  estimated: "Estimated",
  unknown: "Unknown",
};

export function formatDataConfidenceLabel(confidence: DataConfidence): string {
  return DATA_CONFIDENCE_LABELS[confidence];
}

export const DATA_QUALITY_ENTITY_TYPES = [
  "region",
  "city",
  "attraction",
  "hotel",
  "route_edge",
  "itinerary",
  "provider_call",
] as const;
export type DataQualityEntityType = (typeof DATA_QUALITY_ENTITY_TYPES)[number];

export const DATA_QUALITY_ISSUE_SEVERITIES = [
  "info",
  "warning",
  "critical",
] as const;
export type DataQualityIssueSeverity =
  (typeof DATA_QUALITY_ISSUE_SEVERITIES)[number];

export const DATA_QUALITY_ISSUE_CODES = [
  "missing_google_place_id",
  "missing_opening_hours",
  "missing_admission_cost",
  "stale_place_data",
  "mock_data_present",
  "duplicate_place",
  "liteapi_error",
  "no_hotel_rates",
  "route_edge_missing",
  "itinerary_warning",
] as const;
export type DataQualityIssueCode = (typeof DATA_QUALITY_ISSUE_CODES)[number];

export const DATA_QUALITY_ISSUE_STATUSES = [
  "open",
  "ignored",
  "resolved",
] as const;
export type DataQualityIssueStatus =
  (typeof DATA_QUALITY_ISSUE_STATUSES)[number];

export interface DataQualityIssue {
  id: string;
  entity_type: DataQualityEntityType;
  entity_id?: string;
  severity: DataQualityIssueSeverity;
  code: DataQualityIssueCode;
  message: string;
  details?: Record<string, unknown>;
  status: DataQualityIssueStatus;
  created_at: number;
  resolved_at?: number;
  resolved_by?: string;
}

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
  /**
   * Average daily variable cost for a single traveller while spending time at
   * this node. The planner multiplies by the party size when estimating total
   * trip cost.
   */
  avg_daily_cost?: number;
  /** Recommended total hours to experience this node. */
  recommended_hours?: number;
  /** Short human-readable description for UI. */
  description?: string;
  /** Optional image URL for UI. */
  image_url?: string;
  /** Google Places `place_id` if derived from Google. */
  google_place_id?: string;
  /** Optional local opening time ("HH:MM"). */
  opening_time?: string;
  /** Optional local closing time ("HH:MM"). */
  closing_time?: string;
  /** Optional structured opening-hours schedule loaded from attraction_hours. */
  opening_hours?: AttractionOpeningHours;
  /** Optional admission rules loaded from attraction_admissions. */
  admission_rules?: AttractionAdmissionRule[];
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
  metadata: EdgeMetadata;
}

export interface EdgeMetadata {
  road_quality?: "poor" | "average" | "good" | "excellent";
  /** Base price per person for train/flight; future dynamic pricing hook. */
  base_price?: number;
  /** Upstream provider used to resolve this edge (e.g. Google Routes). */
  provider?: string;
  /** Unix epoch millis when live routing last refreshed this edge. */
  resolved_at?: number;
  /** Encoded polyline suitable for map rendering without another API call. */
  encoded_polyline?: string;
  /** Derived travel cost cached by the matrix resolver for scoring/UI. */
  estimated_cost?: number;
  /** Per-mode fatigue multiplier cached by the matrix resolver. */
  fatigue_factor?: number;
  /** Free-form extras. */
  [key: string]: unknown;
}

// ============================================================================
// Preferences + itinerary request
// ============================================================================

export interface BudgetRange {
  min: number;
  max: number;
  /**
   * Total trip budget window in the itinerary currency. The planner treats
   * `max` as the hard ceiling and `min` as an optional floor when callers
   * want to rule out under-spending.
   */
  /** ISO 4217 code, e.g. "INR". Optional for MVP. */
  currency?: string;
}

/** Default itinerary currency for regions that don't provide one. */
export const DEFAULT_CURRENCY = "INR" as const;
/** Default guest nationality used for domestic pricing assumptions. */
export const DEFAULT_GUEST_NATIONALITY = "IN" as const;
/** Calendar date in local `YYYY-MM-DD` format. */
export type LocalDateString = string;

export interface TravellerComposition {
  adults: number;
  children: number;
  /**
   * Child ages in completed years. Optional for legacy itineraries that only
   * stored a children count.
   */
  children_ages?: number[];
  /** Number of rooms requested for accommodation discovery. */
  rooms?: number;
  /** ISO 3166-1 alpha-2 country code (uppercase), e.g. "IN". */
  guest_nationality?: string;
}

export interface ItineraryBudgetLineItemProvenance {
  source_type?: DataSourceType;
  confidence?: DataConfidence;
  /** Source rule/document id (e.g. `attraction_admissions/{id}`). */
  rule_id?: string;
  /** ISO 4217 currency the original source quoted. */
  currency?: string;
  fetched_at?: number | null;
  verified_at?: number | null;
}

export interface ItineraryBudgetLineItem {
  id: string;
  day_index: number;
  kind: "stay" | "travel" | "attraction";
  label: string;
  amount: number;
  /**
   * Optional structured provenance snapshot. Present for line items derived
   * from typed source records (e.g. attraction admission rules) so downstream
   * UIs can display confidence/source without parsing the human label.
   */
  provenance?: ItineraryBudgetLineItemProvenance;
}

export interface ItineraryBudgetBreakdown {
  line_items: ItineraryBudgetLineItem[];
  lodgingSubtotal?: number;
  lodgingRateState?: LodgingRateState;
  lodgingLastCheckedAt?: number | null;
  unknownLodgingStaysCount?: number;
  travelSubtotal?: number;
  attractionSubtotal?: number;
  verifiedAttractionCostsCount?: number;
  estimatedAttractionCostsCount?: number;
  unknownAttractionCostsCount?: number;
  nightlyAverage?: number;
  totalTripCost?: number;
  requestedBudget?: BudgetRange;
  recommendedBudget?: BudgetRange;
  warnings?: string[];
}

export interface ItineraryPreferences {
  travel_style: TravelStyle;
  budget: BudgetRange;
  travellers: TravellerComposition;
  /**
   * Local trip start date ("YYYY-MM-DD"). Required for new itinerary generation
   * requests via API validation, optional here to preserve legacy reads/tests.
   */
  trip_start_date?: LocalDateString;
  /**
   * Optional explicit end date ("YYYY-MM-DD"). When omitted it is derived as
   * `trip_start_date + days - 1`.
   */
  trip_end_date?: LocalDateString;
  /** Optional preference tags to prioritise (e.g. ["heritage", "food"]). */
  interests?: PreferenceTag[];
  /** Optional preferred transport modes. Defaults to ["road"]. */
  transport_modes?: TransportMode[];
  /**
   * When true, the planner should prefer covering more cities even if that
   * means spending less time within each one.
   */
  prioritize_city_coverage?: boolean;
  /** Preferred lodging band for the deterministic accommodation planner. */
  accommodation_preference?: AccommodationPreference;
  /**
   * Preferred local start time for each day, formatted "HH:MM" (24-hour).
   * Used purely for presentation: the renderer lays out travel, activities,
   * meals, and buffers along a real clock starting at this time. Defaults
   * to "09:00" when absent. Engine logic ignores it.
   */
  preferred_start_time?: string;
}

export interface GenerateItineraryInput {
  /**
   * Region slugs the planner may draw candidates from. The first entry
   * is the primary region — persisted on the resulting itinerary doc
   * and used for trip-list filtering. Additional entries widen the
   * candidate pool for cross-region trips. Must be non-empty.
   */
  regions: string[];
  start_node: string;
  /** Optional — defaults to the same as start_node (round-trip). */
  end_node?: string;
  /**
   * Optional extra cities the user wants the route to cover. When present,
   * the planner tries to include every requested city; otherwise it returns
   * a structured feasibility error that explains what would need to change.
   */
  requested_city_ids?: string[];
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
  /** Optional local opening time ("HH:MM"). */
  opening_time?: string;
  /** Optional local closing time ("HH:MM"). */
  closing_time?: string;
  /** Optional resolved windows for the specific itinerary day. */
  opening_periods?: OpeningTimeRange[];
  /** `unknown` allows scheduling but should surface a warning. */
  opening_hours_state?: "known" | "closed" | "unknown";
  opening_hours_confidence?: OpeningHoursConfidence;
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

export interface Accommodation {
  id: string;
  regionId: string;
  nodeId: string;
  name: string;
  category: AccommodationCategory;
  /**
   * Lowest bookable nightly rate retained for legacy sorting / display. Real
   * stay selection is driven by `roomTypes`.
   */
  pricePerNight: number;
  currency: string;
  rating: number;
  reviewCount: number;
  amenities: string[];
  roomTypes?: AccommodationRoomType[];
  location: Coordinates;
  distanceFromCenterKm: number;
  familyFriendly?: boolean;
  coupleFriendly?: boolean;
  breakfastIncluded?: boolean;
  active: boolean;
}

export interface AccommodationRoomType {
  id: string;
  name: string;
  pricePerNight: number;
  maxAdults?: number;
  maxChildren?: number;
  maxOccupancy?: number;
  amenities?: string[];
}

export interface StayRoomSelection {
  roomTypeId: string;
  roomTypeName: string;
  roomCount: number;
  unitPricePerNight: number;
  nightlyCost: number;
  totalCost: number;
  maxAdults?: number;
  maxChildren?: number;
  maxOccupancy?: number;
}

export interface StayRoomAllocationSummary {
  adults: number;
  children: number;
  totalRooms: number;
  rooms: StayRoomSelection[];
}

export const LODGING_RATE_STATES = [
  "lodging_live",
  "lodging_cached",
  "lodging_unknown",
] as const;
export type LodgingRateState = (typeof LODGING_RATE_STATES)[number];

export interface StayHotelRateOption {
  provider: "liteapi";
  provider_hotel_id: string;
  hotel_name: string;
  room_type_id: string;
  room_name: string;
  board_name?: string | null;
  refundable_tag?: string | null;
  currency: string;
  nightly_amount: number | null;
  total_amount: number | null;
  source_type: "liteapi";
  confidence: DataConfidence;
  fetched_at?: number | null;
  expires_at?: number | null;
  search_snapshot_id?: string | null;
  offer_snapshot_id?: string | null;
  address?: string | null;
  star_rating?: number | null;
  guest_rating?: number | null;
  review_count?: number | null;
  distance_from_anchor_km?: number | null;
}

export interface StayAssignment {
  nodeId: string;
  startDay: number;
  endDay: number;
  nights: number;
  accommodationId: string | null;
  nightlyCost: number | null;
  totalCost: number | null;
  roomAllocation?: StayRoomAllocationSummary;
  hotelRateStatus?: "live" | "cached" | "unknown";
  hotelRateUnavailableReason?:
    | "provider_disabled"
    | "provider_timeout"
    | "provider_error"
    | "no_rates"
    | "no_hotels"
    | "call_limit_exceeded"
    | "missing_anchor"
    | "missing_trip_start_date";
  hotelRateLastCheckedAt?: number | null;
  hotelSearchSnapshotId?: string | null;
  hotelOfferSnapshotId?: string | null;
  hotelRateOptions?: StayHotelRateOption[];
  selectedHotelRateOptionIndex?: number | null;
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
  /** Deterministic stay assignments layered on top of the routed days. */
  stays: StayAssignment[];
  /** Total estimated cost across the whole trip. */
  estimated_cost: number;
  /** Human-readable budget drivers used by the itinerary UI. */
  budget_breakdown?: ItineraryBudgetBreakdown;
  /** Normalised 0..1 score from the scoring function. */
  score: number;
  created_at: number;
  /** Optional warnings surfaced by the constraint engine. */
  warnings?: string[];
}

export const ITINERARY_MAP_MARKER_KINDS = [
  "stop",
  "stay",
  "attraction",
] as const;
export type ItineraryMapMarkerKind =
  (typeof ITINERARY_MAP_MARKER_KINDS)[number];

export interface ItineraryMapMarker {
  id: string;
  kind: ItineraryMapMarkerKind;
  title: string;
  subtitle?: string;
  position: Coordinates;
  /** Zero-based day indexes this marker should appear for. */
  day_indices: number[];
  node_id?: string;
  google_place_id?: string;
  /** Stable ordering for stop markers along the route. */
  stop_order?: number;
}

export interface ItineraryMapLeg {
  id: string;
  day_index: number;
  from_node_id: string;
  to_node_id: string;
  from_name: string;
  to_name: string;
  from_position: Coordinates;
  to_position: Coordinates;
  transport_mode: TransportMode;
  distance_km: number;
  travel_time_hours: number;
  encoded_polyline?: string;
  has_geometry: boolean;
}

export interface ItineraryMapData {
  markers: ItineraryMapMarker[];
  legs: ItineraryMapLeg[];
  missing_geometry_count: number;
}

export interface ItineraryDetail {
  itinerary: Itinerary;
  map: ItineraryMapData;
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
  | "requested_cities_uncovered"
  | "invalid_input";

export interface ConstraintError {
  error: "constraint_violation";
  reason: ConstraintErrorReason;
  message: string;
  suggestion?: string;
  details?: Record<string, unknown>;
}
