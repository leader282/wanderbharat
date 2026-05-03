import type {
  AttractionAdmissionRule,
  AttractionOpeningHours,
  GraphEdge,
  GraphNode,
  OpeningHoursWeekday,
  OpeningPeriod,
} from "@/types/domain";
import { CURRENT_DATA_VERSION } from "@/types/domain";

import type { SeedDataset } from "./index";

/**
 * Rajasthan v2 seed dataset.
 *
 * Narrow, deterministic prototype coverage focused on six high-signal cities.
 * The goal is stable planning quality plus explicit provenance/confidence
 * labels, not exhaustive statewide coverage.
 */
const REGION = "rajasthan";
const COUNTRY = "india";
const CURRENCY = "INR";
const LOCALE = "en-IN";
const REGION_TIMEZONE = "Asia/Kolkata";
// Only road edges are seeded for Rajasthan today. Advertising "train" here
// would let users toggle a transport mode that has no graph data, falling
// back to live Google Routes calls at plan time. Re-add "train" once
// curated rail edges land in ROAD_EDGES (or a sibling RAIL_EDGES).
const DEFAULT_TRANSPORT_MODES = ["road"] as const;

interface SeedCity {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tags: string[];
  avg_daily_cost: number;
  recommended_hours: number;
  description: string;
}

interface SeedAttraction {
  id: string;
  parent_node_id: string;
  name: string;
  lat: number;
  lng: number;
  tags: string[];
  recommended_hours: number;
  description: string;
  google_place_id?: string;
}

interface RawRoadEdge {
  from: string;
  to: string;
  distance_km: number;
  travel_time_hours: number;
  road_quality?: "poor" | "average" | "good" | "excellent";
}

const CITIES: SeedCity[] = [
  {
    id: "node_jaipur",
    name: "Jaipur",
    lat: 26.9124,
    lng: 75.7873,
    tags: ["heritage", "food", "shopping", "culture"],
    avg_daily_cost: 2900,
    recommended_hours: 18,
    description:
      "Pink City circuit with forts, palaces, bazaars, and dense old-city walks.",
  },
  {
    id: "node_udaipur",
    name: "Udaipur",
    lat: 24.5854,
    lng: 73.7125,
    tags: ["heritage", "lakes", "culture", "romance"],
    avg_daily_cost: 3200,
    recommended_hours: 14,
    description:
      "Lake city anchored by palace complexes, ghats, and sunset viewpoints.",
  },
  {
    id: "node_jodhpur",
    name: "Jodhpur",
    lat: 26.2389,
    lng: 73.0243,
    tags: ["heritage", "desert", "culture", "photography"],
    avg_daily_cost: 2700,
    recommended_hours: 12,
    description:
      "Blue City base with major fort heritage and old-town walking clusters.",
  },
  {
    id: "node_jaisalmer",
    name: "Jaisalmer",
    lat: 26.9157,
    lng: 70.9083,
    tags: ["desert", "heritage", "adventure", "culture"],
    avg_daily_cost: 2600,
    recommended_hours: 12,
    description:
      "Golden Fort city with havelis, desert-edge lakes, and dune excursions.",
  },
  {
    id: "node_pushkar",
    name: "Pushkar",
    lat: 26.4899,
    lng: 74.5511,
    tags: ["spiritual", "culture", "heritage"],
    avg_daily_cost: 2100,
    recommended_hours: 8,
    description:
      "Compact pilgrimage town centered on the sacred lake and temple belts.",
  },
  {
    id: "node_mount_abu",
    name: "Mount Abu",
    lat: 24.5926,
    lng: 72.7156,
    tags: ["nature", "hill-station", "spiritual"],
    avg_daily_cost: 2500,
    recommended_hours: 10,
    description:
      "Rajasthan hill station with Jain temple heritage and lake viewpoints.",
  },
];

const ATTRACTIONS: SeedAttraction[] = [
  {
    id: "attr_amber_fort",
    parent_node_id: "node_jaipur",
    name: "Amber Fort",
    lat: 26.9855,
    lng: 75.8513,
    tags: ["heritage", "architecture", "history"],
    recommended_hours: 3.5,
    description:
      "Hilltop fort-palace complex with courtyards, gateways, and ramparts.",
  },
  {
    id: "attr_hawa_mahal",
    parent_node_id: "node_jaipur",
    name: "Hawa Mahal",
    lat: 26.9239,
    lng: 75.8267,
    tags: ["heritage", "architecture", "photography"],
    recommended_hours: 1.5,
    description:
      "Iconic pink sandstone facade overlooking Jaipur old-city bazaars.",
  },
  {
    id: "attr_city_palace_jaipur",
    parent_node_id: "node_jaipur",
    name: "City Palace Jaipur",
    lat: 26.9258,
    lng: 75.8237,
    tags: ["heritage", "museum", "culture"],
    recommended_hours: 2.5,
    description:
      "Royal complex with museum galleries and ceremonial courtyards.",
  },
  {
    id: "attr_jantar_mantar",
    parent_node_id: "node_jaipur",
    name: "Jantar Mantar Jaipur",
    lat: 26.9247,
    lng: 75.8243,
    tags: ["heritage", "science", "architecture"],
    recommended_hours: 1.5,
    description:
      "UNESCO astronomical observatory with large masonry instruments.",
  },
  {
    id: "attr_nahargarh_fort",
    parent_node_id: "node_jaipur",
    name: "Nahargarh Fort",
    lat: 26.9361,
    lng: 75.8151,
    tags: ["heritage", "viewpoint", "architecture"],
    recommended_hours: 2,
    description:
      "Hilltop fort overlooking Jaipur with ramparts, courtyards, and sunset views.",
  },
  {
    id: "attr_city_palace_udaipur",
    parent_node_id: "node_udaipur",
    name: "City Palace Udaipur",
    lat: 24.576,
    lng: 73.6835,
    tags: ["heritage", "museum", "architecture"],
    recommended_hours: 3,
    description:
      "Lake-facing palace complex with museum wings and panoramic terraces.",
  },
  {
    id: "attr_lake_pichola",
    parent_node_id: "node_udaipur",
    name: "Lake Pichola",
    lat: 24.5763,
    lng: 73.6794,
    tags: ["lakes", "nature", "photography"],
    recommended_hours: 2,
    description:
      "Central Udaipur lake area used for ghat walks and boat experiences.",
  },
  {
    id: "attr_sajjangarh_monsoon_palace",
    parent_node_id: "node_udaipur",
    name: "Sajjangarh Monsoon Palace",
    lat: 24.6008,
    lng: 73.6678,
    tags: ["heritage", "viewpoint", "nature"],
    recommended_hours: 2,
    description:
      "Hilltop palace and sunset viewpoint above Udaipur's lake basin.",
  },
  {
    id: "attr_jagdish_temple",
    parent_node_id: "node_udaipur",
    name: "Jagdish Temple",
    lat: 24.5797,
    lng: 73.685,
    tags: ["spiritual", "heritage", "architecture"],
    recommended_hours: 0.75,
    description:
      "Active 17th-century Vishnu temple near the City Palace precinct.",
  },
  {
    id: "attr_saheliyon_ki_bari",
    parent_node_id: "node_udaipur",
    name: "Saheliyon Ki Bari",
    lat: 24.6017,
    lng: 73.6931,
    tags: ["heritage", "nature", "culture"],
    recommended_hours: 1.25,
    description:
      "Historic royal garden with lotus pools, fountains, and pavilions.",
  },
  {
    id: "attr_mehrangarh_fort",
    parent_node_id: "node_jodhpur",
    name: "Mehrangarh Fort",
    lat: 26.2988,
    lng: 73.018,
    tags: ["heritage", "history", "museum"],
    recommended_hours: 3,
    description:
      "Major fort museum complex with bastions, galleries, and city views.",
  },
  {
    id: "attr_jaswant_thada",
    parent_node_id: "node_jodhpur",
    name: "Jaswant Thada",
    lat: 26.305,
    lng: 73.0337,
    tags: ["heritage", "architecture", "culture"],
    recommended_hours: 1.25,
    description:
      "Marble cenotaph complex near Mehrangarh with gardens and lake views.",
  },
  {
    id: "attr_umaid_bhawan_museum",
    parent_node_id: "node_jodhpur",
    name: "Umaid Bhawan Palace Museum",
    lat: 26.2816,
    lng: 73.045,
    tags: ["heritage", "museum", "architecture"],
    recommended_hours: 1.75,
    description:
      "Palace museum section documenting Jodhpur royal history and objects.",
  },
  {
    id: "attr_mandore_gardens",
    parent_node_id: "node_jodhpur",
    name: "Mandore Gardens",
    lat: 26.3213,
    lng: 73.0393,
    tags: ["heritage", "nature", "culture"],
    recommended_hours: 1.5,
    description:
      "Historic garden complex with royal cenotaphs, temples, and shaded walks.",
  },
  {
    id: "attr_jaisalmer_fort",
    parent_node_id: "node_jaisalmer",
    name: "Jaisalmer Fort",
    lat: 26.9124,
    lng: 70.912,
    tags: ["heritage", "history", "culture"],
    recommended_hours: 2.5,
    description:
      "Living sandstone fort district with temples, gateways, and lanes.",
  },
  {
    id: "attr_patwon_ki_haveli",
    parent_node_id: "node_jaisalmer",
    name: "Patwon Ki Haveli",
    lat: 26.9153,
    lng: 70.908,
    tags: ["heritage", "architecture", "museum"],
    recommended_hours: 1.5,
    description:
      "Cluster of ornate merchant havelis with carved facades and interiors.",
  },
  {
    id: "attr_gadisar_lake",
    parent_node_id: "node_jaisalmer",
    name: "Gadisar Lake",
    lat: 26.9026,
    lng: 70.9115,
    tags: ["nature", "lakes", "culture"],
    recommended_hours: 1.5,
    description: "Historic tank-lake precinct with gateways, ghats, and boating.",
  },
  {
    id: "attr_bada_bagh",
    parent_node_id: "node_jaisalmer",
    name: "Bada Bagh",
    lat: 26.9477,
    lng: 70.9333,
    tags: ["heritage", "architecture", "viewpoint"],
    recommended_hours: 1.25,
    description:
      "Royal cenotaph complex on a ridge north of Jaisalmer with desert views.",
  },
  {
    id: "attr_brahma_temple_pushkar",
    parent_node_id: "node_pushkar",
    name: "Brahma Temple Pushkar",
    lat: 26.488,
    lng: 74.5513,
    tags: ["spiritual", "heritage", "culture"],
    recommended_hours: 1.25,
    description:
      "Pilgrimage temple complex associated with Pushkar's sacred circuit.",
  },
  {
    id: "attr_pushkar_lake",
    parent_node_id: "node_pushkar",
    name: "Pushkar Lake",
    lat: 26.4903,
    lng: 74.5521,
    tags: ["spiritual", "lakes", "culture"],
    recommended_hours: 1.75,
    description: "Sacred lake and ghat network at the center of Pushkar town.",
  },
  {
    id: "attr_savitri_mata_temple",
    parent_node_id: "node_pushkar",
    name: "Savitri Mata Temple",
    lat: 26.5014,
    lng: 74.5454,
    tags: ["spiritual", "viewpoint", "adventure"],
    recommended_hours: 2,
    description:
      "Hilltop temple accessed by ropeway/trek with town and lake views.",
  },
  {
    id: "attr_dilwara_temples",
    parent_node_id: "node_mount_abu",
    name: "Dilwara Temples",
    lat: 24.6073,
    lng: 72.7197,
    tags: ["spiritual", "heritage", "architecture"],
    recommended_hours: 2,
    description:
      "Jain temple complex known for marble carvings and interior detailing.",
  },
  {
    id: "attr_nakki_lake",
    parent_node_id: "node_mount_abu",
    name: "Nakki Lake",
    lat: 24.5939,
    lng: 72.7083,
    tags: ["nature", "lakes", "family"],
    recommended_hours: 1.5,
    description:
      "Mount Abu town lakefront used for boating, walks, and sunset points.",
  },
  {
    id: "attr_guru_shikhar",
    parent_node_id: "node_mount_abu",
    name: "Guru Shikhar",
    lat: 24.6507,
    lng: 72.7794,
    tags: ["nature", "viewpoint", "spiritual"],
    recommended_hours: 2,
    description: "Highest peak in the Aravalli range with temple and lookout.",
  },
  {
    id: "attr_achalgarh_fort",
    parent_node_id: "node_mount_abu",
    name: "Achalgarh Fort",
    lat: 24.6528,
    lng: 72.7511,
    tags: ["heritage", "spiritual", "history"],
    recommended_hours: 2,
    description:
      "Ruined hill fort cluster with the Achaleshwar Mahadev temple complex.",
  },
];

const ROAD_EDGES: RawRoadEdge[] = [
  {
    from: "node_jaipur",
    to: "node_udaipur",
    distance_km: 393,
    travel_time_hours: 7.0,
    road_quality: "good",
  },
  {
    from: "node_jaipur",
    to: "node_jodhpur",
    distance_km: 336,
    travel_time_hours: 6.0,
    road_quality: "good",
  },
  {
    from: "node_jaipur",
    to: "node_jaisalmer",
    distance_km: 565,
    travel_time_hours: 10.0,
    road_quality: "good",
  },
  {
    from: "node_jaipur",
    to: "node_pushkar",
    distance_km: 144,
    travel_time_hours: 3.0,
    road_quality: "good",
  },
  {
    from: "node_jaipur",
    to: "node_mount_abu",
    distance_km: 493,
    travel_time_hours: 8.5,
    road_quality: "average",
  },
  {
    from: "node_udaipur",
    to: "node_jodhpur",
    distance_km: 253,
    travel_time_hours: 5.0,
    road_quality: "good",
  },
  {
    from: "node_udaipur",
    to: "node_mount_abu",
    distance_km: 164,
    travel_time_hours: 3.0,
    road_quality: "good",
  },
  {
    from: "node_udaipur",
    to: "node_pushkar",
    distance_km: 286,
    travel_time_hours: 5.5,
    road_quality: "good",
  },
  {
    from: "node_jodhpur",
    to: "node_jaisalmer",
    distance_km: 284,
    travel_time_hours: 5.0,
    road_quality: "good",
  },
  {
    from: "node_jodhpur",
    to: "node_pushkar",
    distance_km: 189,
    travel_time_hours: 3.5,
    road_quality: "good",
  },
  {
    from: "node_jodhpur",
    to: "node_mount_abu",
    distance_km: 264,
    travel_time_hours: 5.0,
    road_quality: "good",
  },
  {
    from: "node_pushkar",
    to: "node_mount_abu",
    distance_km: 372,
    travel_time_hours: 7.0,
    road_quality: "average",
  },
  {
    from: "node_jaisalmer",
    to: "node_udaipur",
    distance_km: 497,
    travel_time_hours: 8.0,
    road_quality: "good",
  },
  {
    from: "node_jaisalmer",
    to: "node_pushkar",
    distance_km: 478,
    travel_time_hours: 8.5,
    road_quality: "good",
  },
  {
    from: "node_jaisalmer",
    to: "node_mount_abu",
    distance_km: 605,
    travel_time_hours: 10.5,
    road_quality: "average",
  },
];

const WEEKDAYS: OpeningHoursWeekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

function buildWeeklyPeriods(
  opens: string,
  closes: string,
  closedDays: OpeningHoursWeekday[] = [],
): OpeningPeriod[] {
  const closed = new Set(closedDays);
  return WEEKDAYS.filter((day) => !closed.has(day)).map((day) => ({
    day,
    opens,
    closes,
  }));
}

function estimatedHours(
  attractionId: string,
  opens: string,
  closes: string,
  closedDays: OpeningHoursWeekday[] = [],
): AttractionOpeningHours {
  return {
    id: attractionId,
    attraction_id: attractionId,
    region: REGION,
    timezone: REGION_TIMEZONE,
    weekly_periods: buildWeeklyPeriods(opens, closes, closedDays),
    closed_days: closedDays.length > 0 ? closedDays : undefined,
    source_type: "manual",
    confidence: "estimated",
    fetched_at: null,
    verified_at: null,
  };
}

function unknownHours(attractionId: string): AttractionOpeningHours {
  return {
    id: attractionId,
    attraction_id: attractionId,
    region: REGION,
    timezone: REGION_TIMEZONE,
    weekly_periods: [],
    closed_days: undefined,
    source_type: "manual",
    confidence: "unknown",
    fetched_at: null,
    verified_at: null,
  };
}

const ATTRACTION_HOURS: AttractionOpeningHours[] = [
  estimatedHours("attr_amber_fort", "08:00", "17:30"),
  estimatedHours("attr_hawa_mahal", "09:00", "16:30"),
  estimatedHours("attr_city_palace_jaipur", "09:30", "17:00"),
  estimatedHours("attr_jantar_mantar", "09:00", "16:30"),
  estimatedHours("attr_nahargarh_fort", "10:00", "17:30"),
  estimatedHours("attr_city_palace_udaipur", "09:30", "17:30"),
  unknownHours("attr_lake_pichola"),
  estimatedHours("attr_sajjangarh_monsoon_palace", "09:00", "18:00"),
  estimatedHours("attr_jagdish_temple", "05:00", "22:00"),
  estimatedHours("attr_saheliyon_ki_bari", "09:00", "19:00"),
  estimatedHours("attr_mehrangarh_fort", "09:00", "17:00"),
  estimatedHours("attr_jaswant_thada", "09:00", "17:00"),
  estimatedHours("attr_umaid_bhawan_museum", "10:00", "16:30", ["mon"]),
  estimatedHours("attr_mandore_gardens", "08:00", "20:00"),
  estimatedHours("attr_jaisalmer_fort", "08:00", "18:00"),
  estimatedHours("attr_patwon_ki_haveli", "09:00", "17:00"),
  unknownHours("attr_gadisar_lake"),
  estimatedHours("attr_bada_bagh", "08:00", "18:00"),
  estimatedHours("attr_brahma_temple_pushkar", "06:00", "20:00"),
  unknownHours("attr_pushkar_lake"),
  estimatedHours("attr_savitri_mata_temple", "05:30", "20:00"),
  estimatedHours("attr_dilwara_temples", "12:00", "17:00"),
  unknownHours("attr_nakki_lake"),
  estimatedHours("attr_guru_shikhar", "08:00", "19:00"),
  estimatedHours("attr_achalgarh_fort", "06:00", "19:00"),
];

function estimatedAdmission(
  attractionNodeId: string,
  amount: number,
  note?: string,
): AttractionAdmissionRule {
  return {
    id: `${attractionNodeId}__adult__any`,
    attraction_node_id: attractionNodeId,
    region: REGION,
    currency: CURRENCY,
    amount,
    audience: "adult",
    nationality: "any",
    source_type: "estimated",
    confidence: "estimated",
    source_url: null,
    notes:
      note ??
      "Prototype v2 baseline estimate. Verify in /admin/attraction-costs.",
    fetched_at: null,
    verified_at: null,
    verified_by: null,
    data_version: CURRENT_DATA_VERSION,
  };
}

function unknownAdmission(
  attractionNodeId: string,
  note?: string,
): AttractionAdmissionRule {
  return {
    id: `${attractionNodeId}__adult__any`,
    attraction_node_id: attractionNodeId,
    region: REGION,
    currency: CURRENCY,
    amount: null,
    audience: "adult",
    nationality: "any",
    source_type: "manual",
    confidence: "unknown",
    source_url: null,
    notes:
      note ?? "Unknown in seed; keep null until manually verified in admin.",
    fetched_at: null,
    verified_at: null,
    verified_by: null,
    data_version: CURRENT_DATA_VERSION,
  };
}

const ATTRACTION_ADMISSIONS: AttractionAdmissionRule[] = [
  estimatedAdmission("attr_amber_fort", 200),
  estimatedAdmission("attr_hawa_mahal", 50),
  estimatedAdmission("attr_city_palace_jaipur", 300),
  estimatedAdmission("attr_jantar_mantar", 200),
  estimatedAdmission("attr_nahargarh_fort", 100),
  estimatedAdmission("attr_city_palace_udaipur", 300),
  unknownAdmission("attr_lake_pichola"),
  estimatedAdmission("attr_sajjangarh_monsoon_palace", 130),
  unknownAdmission(
    "attr_jagdish_temple",
    "Active temple; entry is typically free but unconfirmed in repo.",
  ),
  estimatedAdmission("attr_saheliyon_ki_bari", 10),
  estimatedAdmission("attr_mehrangarh_fort", 200),
  estimatedAdmission("attr_jaswant_thada", 50),
  estimatedAdmission("attr_umaid_bhawan_museum", 60),
  unknownAdmission(
    "attr_mandore_gardens",
    "Public garden complex; admission typically unrequired but unconfirmed.",
  ),
  estimatedAdmission("attr_jaisalmer_fort", 100),
  estimatedAdmission("attr_patwon_ki_haveli", 120),
  unknownAdmission("attr_gadisar_lake"),
  estimatedAdmission("attr_bada_bagh", 100),
  unknownAdmission(
    "attr_brahma_temple_pushkar",
    "Temple entry is typically free; any ancillary charges (camera, shoes) modelled separately if needed.",
  ),
  unknownAdmission("attr_pushkar_lake"),
  unknownAdmission(
    "attr_savitri_mata_temple",
    "Temple entry is typically free; ropeway/trek is a separate optional activity, not admission.",
  ),
  unknownAdmission(
    "attr_dilwara_temples",
    "Temple entry is typically free; camera/shoe charges are not temple admission.",
  ),
  unknownAdmission("attr_nakki_lake"),
  unknownAdmission(
    "attr_guru_shikhar",
    "Hilltop viewpoint/temple with no documented admission fee in repo.",
  ),
  unknownAdmission(
    "attr_achalgarh_fort",
    "Hill fort ruins and temple; no documented admission fee in repo.",
  ),
];

function toCityNodes(): GraphNode[] {
  return CITIES.map((city) => ({
    id: city.id,
    type: "city",
    name: city.name,
    region: REGION,
    country: COUNTRY,
    tags: city.tags,
    metadata: {
      avg_daily_cost: city.avg_daily_cost,
      recommended_hours: city.recommended_hours,
      description: city.description,
      timezone: REGION_TIMEZONE,
      data_version: CURRENT_DATA_VERSION,
      source_type: "manual",
      confidence: "estimated",
    },
    location: { lat: city.lat, lng: city.lng },
  }));
}

function toAttractionNodes(): GraphNode[] {
  return ATTRACTIONS.map((attraction) => ({
    id: attraction.id,
    type: "attraction",
    name: attraction.name,
    region: REGION,
    country: COUNTRY,
    tags: attraction.tags,
    metadata: {
      recommended_hours: attraction.recommended_hours,
      description: attraction.description,
      timezone: REGION_TIMEZONE,
      data_version: CURRENT_DATA_VERSION,
      source_type: "manual",
      confidence: "estimated",
      ...(attraction.google_place_id
        ? { google_place_id: attraction.google_place_id }
        : {}),
    },
    location: { lat: attraction.lat, lng: attraction.lng },
    parent_node_id: attraction.parent_node_id,
  }));
}

function toRoadEdges(): GraphEdge[] {
  return ROAD_EDGES.map((edge) => ({
    id: `edge_${edge.from}__${edge.to}`,
    from: edge.from,
    to: edge.to,
    type: "road",
    distance_km: edge.distance_km,
    travel_time_hours: edge.travel_time_hours,
    bidirectional: true,
    regions: [REGION],
    metadata: {
      road_quality: edge.road_quality ?? "good",
    },
  }));
}

const dataset: SeedDataset = {
  region: REGION,
  country: COUNTRY,
  summary: {
    default_currency: CURRENCY,
    default_locale: LOCALE,
    default_transport_modes: [...DEFAULT_TRANSPORT_MODES],
  },
  cities: toCityNodes,
  attractions: toAttractionNodes,
  attractionHours: () => ATTRACTION_HOURS,
  attractionAdmissions: () => ATTRACTION_ADMISSIONS,
  edges: toRoadEdges,
};

export default dataset;
