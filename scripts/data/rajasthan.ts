import type { GraphEdge, GraphNode } from "@/types/domain";

/**
 * Rajasthan seed dataset.
 *
 * IMPORTANT: this file is **data only**. The engine, API, repositories, and
 * UI do not import it — they only see the values once they've been written
 * to Firestore. Rajasthan exists here purely as an example region; swap in
 * another file for any other region with zero code changes elsewhere.
 *
 * Distances / hours below are approximate real-world road values. They're
 * fine for MVP planning; the `seedEdges` script can replace them with
 * Google-Routes values via `--use-google`.
 */

export const RAJASTHAN_REGION = "rajasthan";
export const RAJASTHAN_COUNTRY = "india";
export const RAJASTHAN_CURRENCY = "INR";
export const RAJASTHAN_LOCALE = "en-IN";
export const RAJASTHAN_DEFAULT_TRANSPORT_MODES = ["road", "train"] as const;

export interface SeedCity {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tags: string[];
  avg_daily_cost: number;
  recommended_hours: number;
  description: string;
  /** Optional keyword for Places Text Search seeding. */
  places_query?: string;
}

export const RAJASTHAN_CITIES: SeedCity[] = [
  {
    id: "node_jaipur",
    name: "Jaipur",
    lat: 26.9124,
    lng: 75.7873,
    tags: ["heritage", "food", "shopping", "culture"],
    avg_daily_cost: 2800,
    recommended_hours: 20,
    description:
      "The Pink City — palaces, bazaars, and the mighty Amber Fort.",
    places_query: "top tourist attractions in Jaipur Rajasthan",
  },
  {
    id: "node_udaipur",
    name: "Udaipur",
    lat: 24.5854,
    lng: 73.7125,
    tags: ["heritage", "lakes", "luxury", "romance"],
    avg_daily_cost: 3200,
    recommended_hours: 18,
    description:
      "Lake city of white palaces, sunset ghats, and classical music.",
    places_query: "top tourist attractions in Udaipur Rajasthan",
  },
  {
    id: "node_jodhpur",
    name: "Jodhpur",
    lat: 26.2389,
    lng: 73.0243,
    tags: ["heritage", "desert", "photography"],
    avg_daily_cost: 2600,
    recommended_hours: 14,
    description:
      "The Blue City at the edge of the Thar, crowned by Mehrangarh Fort.",
    places_query: "top tourist attractions in Jodhpur Rajasthan",
  },
  {
    id: "node_jaisalmer",
    name: "Jaisalmer",
    lat: 26.9157,
    lng: 70.9083,
    tags: ["desert", "heritage", "adventure"],
    avg_daily_cost: 2400,
    recommended_hours: 14,
    description:
      "Golden sandstone city, camel safaris, and Sam Sand Dunes camps.",
    places_query: "top tourist attractions in Jaisalmer Rajasthan",
  },
  {
    id: "node_pushkar",
    name: "Pushkar",
    lat: 26.4899,
    lng: 74.5511,
    tags: ["spiritual", "heritage", "culture"],
    avg_daily_cost: 1800,
    recommended_hours: 8,
    description:
      "Holy lake town famed for the Brahma Temple and annual camel fair.",
    places_query: "top tourist attractions in Pushkar Rajasthan",
  },
  {
    id: "node_ajmer",
    name: "Ajmer",
    lat: 26.4499,
    lng: 74.6399,
    tags: ["spiritual", "heritage"],
    avg_daily_cost: 1600,
    recommended_hours: 6,
    description:
      "Home of the Dargah Sharif of Khwaja Moinuddin Chishti.",
    places_query: "top tourist attractions in Ajmer Rajasthan",
  },
  {
    id: "node_mount_abu",
    name: "Mount Abu",
    lat: 24.5926,
    lng: 72.7156,
    tags: ["nature", "spiritual", "hill-station"],
    avg_daily_cost: 2200,
    recommended_hours: 10,
    description:
      "Rajasthan's only hill station, with Dilwara Jain temples and Nakki Lake.",
    places_query: "top tourist attractions in Mount Abu Rajasthan",
  },
  {
    id: "node_bikaner",
    name: "Bikaner",
    lat: 28.0229,
    lng: 73.3119,
    tags: ["heritage", "desert", "food"],
    avg_daily_cost: 2000,
    recommended_hours: 10,
    description:
      "Fort city famed for Junagarh Fort, camel research, and bhujia.",
    places_query: "top tourist attractions in Bikaner Rajasthan",
  },
  {
    id: "node_chittorgarh",
    name: "Chittorgarh",
    lat: 24.8887,
    lng: 74.6269,
    tags: ["heritage", "history"],
    avg_daily_cost: 1700,
    recommended_hours: 7,
    description:
      "Largest fort in India, setting of the Rani Padmini legends.",
    places_query: "top tourist attractions in Chittorgarh Rajasthan",
  },
  {
    id: "node_ranthambore",
    name: "Ranthambore",
    lat: 26.0173,
    lng: 76.5026,
    tags: ["wildlife", "nature", "adventure"],
    avg_daily_cost: 3000,
    recommended_hours: 12,
    description:
      "Tiger reserve built around a 10th-century hilltop fort.",
    places_query: "top tourist attractions near Ranthambore National Park Rajasthan",
  },
];

interface RawRoadEdge {
  from: string;
  to: string;
  distance_km: number;
  travel_time_hours: number;
  road_quality?: "poor" | "average" | "good" | "excellent";
}

/**
 * Curated road network. Approximate distances/times along well-travelled
 * routes; `seedEdges --use-google` can overwrite with live Routes data.
 */
export const RAJASTHAN_ROAD_EDGES: RawRoadEdge[] = [
  { from: "node_jaipur", to: "node_udaipur", distance_km: 393, travel_time_hours: 7.0, road_quality: "good" },
  { from: "node_jaipur", to: "node_jodhpur", distance_km: 336, travel_time_hours: 6.0, road_quality: "good" },
  { from: "node_jaipur", to: "node_jaisalmer", distance_km: 565, travel_time_hours: 10.0, road_quality: "good" },
  { from: "node_jaipur", to: "node_pushkar", distance_km: 144, travel_time_hours: 3.0, road_quality: "good" },
  { from: "node_jaipur", to: "node_ajmer", distance_km: 132, travel_time_hours: 2.5, road_quality: "excellent" },
  { from: "node_jaipur", to: "node_bikaner", distance_km: 335, travel_time_hours: 6.0, road_quality: "good" },
  { from: "node_jaipur", to: "node_chittorgarh", distance_km: 307, travel_time_hours: 5.5, road_quality: "good" },
  { from: "node_jaipur", to: "node_ranthambore", distance_km: 180, travel_time_hours: 3.5, road_quality: "average" },

  { from: "node_udaipur", to: "node_jodhpur", distance_km: 253, travel_time_hours: 5.0, road_quality: "good" },
  { from: "node_udaipur", to: "node_chittorgarh", distance_km: 112, travel_time_hours: 2.0, road_quality: "good" },
  { from: "node_udaipur", to: "node_mount_abu", distance_km: 164, travel_time_hours: 3.0, road_quality: "good" },
  { from: "node_udaipur", to: "node_ajmer", distance_km: 275, travel_time_hours: 5.0, road_quality: "good" },

  { from: "node_jodhpur", to: "node_jaisalmer", distance_km: 284, travel_time_hours: 5.0, road_quality: "good" },
  { from: "node_jodhpur", to: "node_bikaner", distance_km: 247, travel_time_hours: 4.5, road_quality: "good" },
  { from: "node_jodhpur", to: "node_mount_abu", distance_km: 264, travel_time_hours: 5.0, road_quality: "good" },
  { from: "node_jodhpur", to: "node_pushkar", distance_km: 189, travel_time_hours: 3.5, road_quality: "good" },

  { from: "node_pushkar", to: "node_ajmer", distance_km: 15, travel_time_hours: 0.5, road_quality: "excellent" },
  { from: "node_pushkar", to: "node_bikaner", distance_km: 229, travel_time_hours: 4.5, road_quality: "good" },

  { from: "node_bikaner", to: "node_jaisalmer", distance_km: 333, travel_time_hours: 6.0, road_quality: "good" },

  { from: "node_chittorgarh", to: "node_ajmer", distance_km: 186, travel_time_hours: 3.5, road_quality: "good" },

  { from: "node_ranthambore", to: "node_ajmer", distance_km: 242, travel_time_hours: 4.5, road_quality: "average" },
  { from: "node_ranthambore", to: "node_chittorgarh", distance_km: 279, travel_time_hours: 5.5, road_quality: "average" },
];

/**
 * Projects the seed data into the shape the DB expects. Kept here so the
 * seed scripts stay short and data-focused.
 */
export function toCityNodes(
  cities: SeedCity[] = RAJASTHAN_CITIES,
  region = RAJASTHAN_REGION,
  country = RAJASTHAN_COUNTRY,
): GraphNode[] {
  return cities.map((c) => ({
    id: c.id,
    type: "city",
    name: c.name,
    region,
    country,
    tags: c.tags,
    metadata: {
      avg_daily_cost: c.avg_daily_cost,
      recommended_hours: c.recommended_hours,
      description: c.description,
    },
    location: { lat: c.lat, lng: c.lng },
    source: "seed",
  }));
}

export function toRoadEdges(
  edges: RawRoadEdge[] = RAJASTHAN_ROAD_EDGES,
  region = RAJASTHAN_REGION,
): GraphEdge[] {
  return edges.map((e) => ({
    id: `edge_${e.from}__${e.to}`,
    from: e.from,
    to: e.to,
    type: "road",
    distance_km: e.distance_km,
    travel_time_hours: e.travel_time_hours,
    bidirectional: true,
    regions: [region],
    metadata: {
      road_quality: e.road_quality ?? "good",
    },
  }));
}
