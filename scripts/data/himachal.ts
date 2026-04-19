import type { GraphEdge, GraphNode } from "@/types/domain";

import type { SeedDataset } from "./index";

/**
 * Himachal Pradesh seed dataset.
 *
 * Roads here are mountain roads — average speeds are intentionally lower
 * than the plains. Default transport mode is `road` only because rail
 * coverage in HP is limited to narrow-gauge lines that aren't part of the
 * planning graph yet.
 */

const REGION = "himachal";
const COUNTRY = "india";
const CURRENCY = "INR";
const LOCALE = "en-IN";
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
  places_query?: string;
}

const CITIES: SeedCity[] = [
  {
    id: "node_shimla",
    name: "Shimla",
    lat: 31.1048,
    lng: 77.1734,
    tags: ["hill-station", "heritage", "nature"],
    avg_daily_cost: 2800,
    recommended_hours: 14,
    description:
      "Colonial-era summer capital — the Mall, Christ Church, and the Kalka–Shimla toy train.",
    places_query: "top tourist attractions in Shimla Himachal Pradesh",
  },
  {
    id: "node_manali",
    name: "Manali",
    lat: 32.2432,
    lng: 77.1892,
    tags: ["hill-station", "adventure", "nature"],
    avg_daily_cost: 3000,
    recommended_hours: 18,
    description:
      "Apple-orchard mountain town — Solang Valley, Hadimba Temple, and the gateway to Lahaul–Spiti.",
    places_query: "top tourist attractions in Manali Himachal Pradesh",
  },
  {
    id: "node_dharamshala",
    name: "Dharamshala",
    lat: 32.219,
    lng: 76.3234,
    tags: ["spiritual", "culture", "nature", "hill-station"],
    avg_daily_cost: 2400,
    recommended_hours: 14,
    description:
      "Home of the Dalai Lama — McLeod Ganj, Tsuglagkhang Complex, and Dhauladhar trekking.",
    places_query: "top tourist attractions in Dharamshala McLeod Ganj",
  },
  {
    id: "node_dalhousie",
    name: "Dalhousie",
    lat: 32.5448,
    lng: 75.9712,
    tags: ["hill-station", "nature", "heritage"],
    avg_daily_cost: 2200,
    recommended_hours: 10,
    description:
      "Quiet British-era hill town strung across five hills with deodar forests and colonial churches.",
    places_query: "top tourist attractions in Dalhousie Himachal Pradesh",
  },
  {
    id: "node_kullu",
    name: "Kullu",
    lat: 31.9578,
    lng: 77.1093,
    tags: ["nature", "adventure", "culture"],
    avg_daily_cost: 2200,
    recommended_hours: 8,
    description:
      "Beas-river valley town famed for Dussehra, river rafting, and apple orchards.",
    places_query: "top tourist attractions in Kullu Himachal Pradesh",
  },
  {
    id: "node_kasol",
    name: "Kasol",
    lat: 32.0098,
    lng: 77.3149,
    tags: ["nature", "adventure", "spiritual"],
    avg_daily_cost: 2000,
    recommended_hours: 10,
    description:
      "Riverside village in Parvati Valley — base for Kheerganga, Tosh, and Manikaran.",
    places_query: "top tourist attractions in Kasol Parvati Valley",
  },
  {
    id: "node_khajjiar",
    name: "Khajjiar",
    lat: 32.5478,
    lng: 76.0566,
    tags: ["nature", "hill-station"],
    avg_daily_cost: 1800,
    recommended_hours: 6,
    description:
      "Saucer-shaped meadow ringed by deodar forest, billed as 'Mini Switzerland'.",
    places_query: "top tourist attractions in Khajjiar Himachal Pradesh",
  },
  {
    id: "node_bir",
    name: "Bir",
    lat: 32.029,
    lng: 76.725,
    tags: ["adventure", "nature", "spiritual"],
    avg_daily_cost: 2000,
    recommended_hours: 10,
    description:
      "Paragliding capital of India — Bir-Billing flights, Tibetan colony, and forest cafés.",
    places_query: "top tourist attractions in Bir Billing Himachal Pradesh",
  },
  {
    id: "node_mandi",
    name: "Mandi",
    lat: 31.708,
    lng: 76.9322,
    tags: ["heritage", "spiritual", "culture"],
    avg_daily_cost: 1700,
    recommended_hours: 6,
    description:
      "Old temple town on the Beas — Bhutnath shrines and the Mandi Shivratri fair.",
    places_query: "top tourist attractions in Mandi Himachal Pradesh",
  },
  {
    id: "node_kaza",
    name: "Kaza",
    lat: 32.227,
    lng: 78.005,
    tags: ["adventure", "nature", "spiritual", "culture"],
    avg_daily_cost: 2600,
    recommended_hours: 16,
    description:
      "High-altitude headquarters of Spiti Valley — Key Monastery, Chandratal, and lunar landscapes.",
    places_query: "top tourist attractions in Kaza Spiti Valley",
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
 * Mountain roads — speeds reflect real-world drive times rather than
 * straight-line distances. Some legs (e.g. Manali↔Kaza via Kunzum Pass)
 * are seasonal; the planner treats them as always-available for now.
 */
const ROAD_EDGES: RawRoadEdge[] = [
  { from: "node_shimla", to: "node_manali", distance_km: 250, travel_time_hours: 7.0, road_quality: "average" },
  { from: "node_shimla", to: "node_mandi", distance_km: 160, travel_time_hours: 4.0, road_quality: "average" },
  { from: "node_shimla", to: "node_kullu", distance_km: 220, travel_time_hours: 6.0, road_quality: "average" },
  { from: "node_shimla", to: "node_kaza", distance_km: 410, travel_time_hours: 13.0, road_quality: "average" },

  { from: "node_manali", to: "node_kullu", distance_km: 40, travel_time_hours: 1.5, road_quality: "good" },
  { from: "node_manali", to: "node_kasol", distance_km: 75, travel_time_hours: 2.5, road_quality: "average" },
  { from: "node_manali", to: "node_mandi", distance_km: 110, travel_time_hours: 3.0, road_quality: "good" },
  { from: "node_manali", to: "node_kaza", distance_km: 200, travel_time_hours: 8.0, road_quality: "average" },
  { from: "node_manali", to: "node_dharamshala", distance_km: 235, travel_time_hours: 7.0, road_quality: "average" },
  { from: "node_manali", to: "node_bir", distance_km: 230, travel_time_hours: 7.0, road_quality: "average" },

  { from: "node_kullu", to: "node_kasol", distance_km: 35, travel_time_hours: 1.0, road_quality: "good" },
  { from: "node_kullu", to: "node_mandi", distance_km: 70, travel_time_hours: 2.0, road_quality: "good" },

  { from: "node_mandi", to: "node_dharamshala", distance_km: 145, travel_time_hours: 4.0, road_quality: "good" },
  { from: "node_mandi", to: "node_bir", distance_km: 110, travel_time_hours: 3.0, road_quality: "good" },

  { from: "node_dharamshala", to: "node_dalhousie", distance_km: 130, travel_time_hours: 3.5, road_quality: "good" },
  { from: "node_dharamshala", to: "node_bir", distance_km: 65, travel_time_hours: 2.0, road_quality: "good" },
  { from: "node_dharamshala", to: "node_khajjiar", distance_km: 140, travel_time_hours: 4.0, road_quality: "average" },

  { from: "node_dalhousie", to: "node_khajjiar", distance_km: 25, travel_time_hours: 1.0, road_quality: "good" },
];

function toCityNodes(): GraphNode[] {
  return CITIES.map((c) => ({
    id: c.id,
    type: "city",
    name: c.name,
    region: REGION,
    country: COUNTRY,
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

function toRoadEdges(): GraphEdge[] {
  return ROAD_EDGES.map((e) => ({
    id: `edge_${e.from}__${e.to}`,
    from: e.from,
    to: e.to,
    type: "road",
    distance_km: e.distance_km,
    travel_time_hours: e.travel_time_hours,
    bidirectional: true,
    regions: [REGION],
    metadata: {
      road_quality: e.road_quality ?? "average",
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
  edges: toRoadEdges,
  placesQueries: () =>
    CITIES.map((c) => ({
      city_id: c.id,
      query: c.places_query ?? `top tourist attractions in ${c.name}`,
      center: { lat: c.lat, lng: c.lng },
      city_tags: c.tags,
    })),
};

export default dataset;
