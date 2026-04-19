import type { GraphEdge, GraphNode } from "@/types/domain";

import type { SeedDataset } from "./index";

/**
 * Gujarat seed dataset.
 *
 * Same shape as `rajasthan.ts` — pure data only, no engine/UI imports.
 * Distances/hours are approximate real-world road values; rerun
 * `seedEdges --use-google` to overwrite with live Routes API data.
 */

const REGION = "gujarat";
const COUNTRY = "india";
const CURRENCY = "INR";
const LOCALE = "en-IN";
const DEFAULT_TRANSPORT_MODES = ["road", "train"] as const;

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
    id: "node_ahmedabad",
    name: "Ahmedabad",
    lat: 23.0225,
    lng: 72.5714,
    tags: ["heritage", "food", "shopping", "culture"],
    avg_daily_cost: 2400,
    recommended_hours: 18,
    description:
      "UNESCO heritage city of pol houses, Sabarmati Ashram, and legendary street food.",
    places_query: "top tourist attractions in Ahmedabad Gujarat",
  },
  {
    id: "node_vadodara",
    name: "Vadodara",
    lat: 22.3072,
    lng: 73.1812,
    tags: ["heritage", "culture", "food"],
    avg_daily_cost: 2000,
    recommended_hours: 12,
    description:
      "Royal Baroda — Laxmi Vilas Palace, museums, and Sayaji Bagh.",
    places_query: "top tourist attractions in Vadodara Gujarat",
  },
  {
    id: "node_surat",
    name: "Surat",
    lat: 21.1702,
    lng: 72.8311,
    tags: ["food", "shopping", "culture"],
    avg_daily_cost: 2200,
    recommended_hours: 10,
    description:
      "Diamond and textile hub on the Tapi, famous for locho, undhiyu, and seafront promenades.",
    places_query: "top tourist attractions in Surat Gujarat",
  },
  {
    id: "node_rajkot",
    name: "Rajkot",
    lat: 22.3039,
    lng: 70.8022,
    tags: ["heritage", "food"],
    avg_daily_cost: 1800,
    recommended_hours: 8,
    description:
      "Saurashtra hub linked to Mahatma Gandhi's childhood and Kathiyawadi cuisine.",
    places_query: "top tourist attractions in Rajkot Gujarat",
  },
  {
    id: "node_bhuj",
    name: "Bhuj",
    lat: 23.253,
    lng: 69.6693,
    tags: ["heritage", "desert", "culture", "shopping"],
    avg_daily_cost: 2300,
    recommended_hours: 14,
    description:
      "Gateway to the white salt flats of the Rann of Kutch and exquisite Kutchi handicraft villages.",
    places_query: "top tourist attractions in Bhuj Kutch Gujarat",
  },
  {
    id: "node_dwarka",
    name: "Dwarka",
    lat: 22.2394,
    lng: 68.9678,
    tags: ["spiritual", "heritage", "beach"],
    avg_daily_cost: 1900,
    recommended_hours: 10,
    description:
      "Krishna's legendary city — Dwarkadhish Temple, Bet Dwarka, and the Arabian Sea.",
    places_query: "top tourist attractions in Dwarka Gujarat",
  },
  {
    id: "node_somnath",
    name: "Somnath",
    lat: 20.888,
    lng: 70.4017,
    tags: ["spiritual", "heritage", "beach"],
    avg_daily_cost: 1800,
    recommended_hours: 8,
    description:
      "First of the twelve Jyotirlingas, perched on the Saurashtra coast at Veraval.",
    places_query: "top tourist attractions in Somnath Gujarat",
  },
  {
    id: "node_junagadh",
    name: "Junagadh",
    lat: 21.5222,
    lng: 70.4579,
    tags: ["heritage", "spiritual", "history"],
    avg_daily_cost: 1700,
    recommended_hours: 8,
    description:
      "Ancient citadel below Mount Girnar — Uparkot Fort, Mahabat Maqbara, and the Ashokan edicts.",
    places_query: "top tourist attractions in Junagadh Gujarat",
  },
  {
    id: "node_sasan_gir",
    name: "Sasan Gir",
    lat: 21.1352,
    lng: 70.6066,
    tags: ["wildlife", "nature", "adventure"],
    avg_daily_cost: 3200,
    recommended_hours: 12,
    description:
      "Gir National Park — the last refuge of the Asiatic lion and dry-deciduous forest safaris.",
    places_query: "top tourist attractions near Gir National Park Gujarat",
  },
  {
    id: "node_kevadia",
    name: "Kevadia",
    lat: 21.838,
    lng: 73.7191,
    tags: ["culture", "nature", "adventure"],
    avg_daily_cost: 2500,
    recommended_hours: 12,
    description:
      "Home of the Statue of Unity, Sardar Sarovar Dam, jungle safari, and the Narmada riverfront.",
    places_query: "top tourist attractions near Statue of Unity Kevadia",
  },
];

interface RawRoadEdge {
  from: string;
  to: string;
  distance_km: number;
  travel_time_hours: number;
  road_quality?: "poor" | "average" | "good" | "excellent";
}

const ROAD_EDGES: RawRoadEdge[] = [
  { from: "node_ahmedabad", to: "node_vadodara", distance_km: 110, travel_time_hours: 2.0, road_quality: "excellent" },
  { from: "node_ahmedabad", to: "node_rajkot", distance_km: 215, travel_time_hours: 3.5, road_quality: "good" },
  { from: "node_ahmedabad", to: "node_surat", distance_km: 270, travel_time_hours: 4.0, road_quality: "good" },
  { from: "node_ahmedabad", to: "node_bhuj", distance_km: 325, travel_time_hours: 6.0, road_quality: "good" },
  { from: "node_ahmedabad", to: "node_kevadia", distance_km: 200, travel_time_hours: 3.5, road_quality: "good" },
  { from: "node_ahmedabad", to: "node_junagadh", distance_km: 320, travel_time_hours: 5.5, road_quality: "good" },

  { from: "node_vadodara", to: "node_surat", distance_km: 150, travel_time_hours: 2.5, road_quality: "good" },
  { from: "node_vadodara", to: "node_kevadia", distance_km: 90, travel_time_hours: 2.0, road_quality: "good" },

  { from: "node_surat", to: "node_kevadia", distance_km: 170, travel_time_hours: 3.0, road_quality: "good" },

  { from: "node_rajkot", to: "node_bhuj", distance_km: 250, travel_time_hours: 4.5, road_quality: "good" },
  { from: "node_rajkot", to: "node_junagadh", distance_km: 100, travel_time_hours: 2.0, road_quality: "good" },
  { from: "node_rajkot", to: "node_dwarka", distance_km: 230, travel_time_hours: 4.0, road_quality: "good" },
  { from: "node_rajkot", to: "node_somnath", distance_km: 190, travel_time_hours: 3.5, road_quality: "good" },

  { from: "node_junagadh", to: "node_somnath", distance_km: 85, travel_time_hours: 2.0, road_quality: "good" },
  { from: "node_junagadh", to: "node_sasan_gir", distance_km: 60, travel_time_hours: 1.5, road_quality: "good" },
  { from: "node_junagadh", to: "node_dwarka", distance_km: 220, travel_time_hours: 4.0, road_quality: "good" },

  { from: "node_sasan_gir", to: "node_somnath", distance_km: 45, travel_time_hours: 1.0, road_quality: "good" },

  { from: "node_dwarka", to: "node_somnath", distance_km: 230, travel_time_hours: 4.5, road_quality: "good" },
  { from: "node_dwarka", to: "node_bhuj", distance_km: 380, travel_time_hours: 6.5, road_quality: "average" },
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
      road_quality: e.road_quality ?? "good",
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
