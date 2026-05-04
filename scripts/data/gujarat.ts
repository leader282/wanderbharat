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
const REGION_TIMEZONE = "Asia/Kolkata";
// Curated Gujarat edges are road-only today. Do not advertise train until
// train graph data is seeded as first-class edges.
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

interface SeedAttraction {
  id: string;
  parent_node_id: string;
  name: string;
  lat: number;
  lng: number;
  tags: string[];
  recommended_hours: number;
  description: string;
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
    description: "Royal Baroda — Laxmi Vilas Palace, museums, and Sayaji Bagh.",
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

const ATTRACTIONS: SeedAttraction[] = [
  {
    id: "attr_sabarmati_ashram",
    parent_node_id: "node_ahmedabad",
    name: "Sabarmati Ashram",
    lat: 23.0608,
    lng: 72.5808,
    tags: ["heritage", "history", "culture"],
    recommended_hours: 2,
    description:
      "Gandhi ashram museum on the Sabarmati riverfront with archives, galleries, and quiet courtyards.",
  },
  {
    id: "attr_adalaj_stepwell",
    parent_node_id: "node_ahmedabad",
    name: "Adalaj Stepwell",
    lat: 23.1667,
    lng: 72.58,
    tags: ["heritage", "architecture", "history"],
    recommended_hours: 1.5,
    description:
      "Five-storey carved stepwell north of Ahmedabad, used for architecture and photo stops.",
  },
  {
    id: "attr_sidi_saiyyed_mosque",
    parent_node_id: "node_ahmedabad",
    name: "Sidi Saiyyed Mosque",
    lat: 23.0273,
    lng: 72.5818,
    tags: ["heritage", "architecture", "spiritual"],
    recommended_hours: 0.75,
    description:
      "Historic mosque famed for its stone latticework and the Tree of Life jali.",
  },
  {
    id: "attr_laxmi_vilas_palace",
    parent_node_id: "node_vadodara",
    name: "Laxmi Vilas Palace",
    lat: 22.2936,
    lng: 73.1911,
    tags: ["heritage", "architecture", "culture"],
    recommended_hours: 2.5,
    description:
      "Gaekwad royal palace complex with Indo-Saracenic architecture and museum rooms.",
  },
  {
    id: "attr_sayaji_baug",
    parent_node_id: "node_vadodara",
    name: "Sayaji Baug",
    lat: 22.3115,
    lng: 73.1908,
    tags: ["nature", "family", "culture"],
    recommended_hours: 2,
    description:
      "Large city garden precinct with museum, zoo, toy train, and shaded walks.",
  },
  {
    id: "attr_baroda_museum",
    parent_node_id: "node_vadodara",
    name: "Baroda Museum & Picture Gallery",
    lat: 22.3142,
    lng: 73.1887,
    tags: ["museum", "heritage", "culture"],
    recommended_hours: 1.75,
    description:
      "Museum and picture gallery inside Sayaji Baug with art, archaeology, and natural history collections.",
  },
  {
    id: "attr_dutch_garden_surat",
    parent_node_id: "node_surat",
    name: "Dutch Garden Surat",
    lat: 21.186,
    lng: 72.8143,
    tags: ["heritage", "nature", "culture"],
    recommended_hours: 1,
    description:
      "Colonial cemetery garden near the Tapi river, useful for a short heritage break.",
  },
  {
    id: "attr_dumas_beach",
    parent_node_id: "node_surat",
    name: "Dumas Beach",
    lat: 21.0917,
    lng: 72.7147,
    tags: ["beach", "food", "nature"],
    recommended_hours: 2,
    description:
      "Black-sand beach outside Surat with snack stalls and sunset walks.",
  },
  {
    id: "attr_sarthana_nature_park",
    parent_node_id: "node_surat",
    name: "Sarthana Nature Park",
    lat: 21.2351,
    lng: 72.8944,
    tags: ["wildlife", "family", "nature"],
    recommended_hours: 2.5,
    description:
      "Urban zoo and nature park with family-friendly animal enclosures and walking paths.",
  },
  {
    id: "attr_kaba_gandhi_no_delo",
    parent_node_id: "node_rajkot",
    name: "Kaba Gandhi No Delo",
    lat: 22.3006,
    lng: 70.8026,
    tags: ["heritage", "history", "culture"],
    recommended_hours: 1.25,
    description:
      "Mahatma Gandhi's childhood home, now a compact museum in old Rajkot.",
  },
  {
    id: "attr_rotary_dolls_museum",
    parent_node_id: "node_rajkot",
    name: "Rotary Dolls Museum",
    lat: 22.2919,
    lng: 70.7919,
    tags: ["museum", "family", "culture"],
    recommended_hours: 1.5,
    description:
      "Family-oriented museum with dolls and cultural costumes from around the world.",
  },
  {
    id: "attr_watson_museum",
    parent_node_id: "node_rajkot",
    name: "Watson Museum",
    lat: 22.3039,
    lng: 70.8009,
    tags: ["museum", "heritage", "history"],
    recommended_hours: 1.5,
    description:
      "Jubilee Garden museum covering Saurashtra history, textiles, sculptures, and colonial-era objects.",
  },
  {
    id: "attr_aina_mahal",
    parent_node_id: "node_bhuj",
    name: "Aina Mahal",
    lat: 23.2532,
    lng: 69.6697,
    tags: ["heritage", "architecture", "museum"],
    recommended_hours: 1.5,
    description:
      "Mirror palace museum in Bhuj with royal interiors, craftwork, and earthquake-scarred heritage.",
  },
  {
    id: "attr_prag_mahal",
    parent_node_id: "node_bhuj",
    name: "Prag Mahal",
    lat: 23.2535,
    lng: 69.669,
    tags: ["heritage", "architecture", "photography"],
    recommended_hours: 1.25,
    description:
      "Gothic-style palace complex with clock tower views and ornate durbar halls.",
  },
  {
    id: "attr_kutch_museum",
    parent_node_id: "node_bhuj",
    name: "Kutch Museum",
    lat: 23.2526,
    lng: 69.6669,
    tags: ["museum", "heritage", "culture"],
    recommended_hours: 1.5,
    description:
      "Regional museum documenting Kutchi tribes, crafts, inscriptions, and natural history.",
  },
  {
    id: "attr_dwarkadhish_temple",
    parent_node_id: "node_dwarka",
    name: "Dwarkadhish Temple",
    lat: 22.2376,
    lng: 68.9674,
    tags: ["spiritual", "heritage", "architecture"],
    recommended_hours: 1.5,
    description:
      "Major Krishna temple and pilgrimage anchor in Dwarka's old town.",
  },
  {
    id: "attr_bet_dwarka",
    parent_node_id: "node_dwarka",
    name: "Bet Dwarka",
    lat: 22.4497,
    lng: 69.0889,
    tags: ["spiritual", "beach", "culture"],
    recommended_hours: 3,
    description:
      "Island pilgrimage excursion reached by road and ferry from the Okha side.",
  },
  {
    id: "attr_rukmini_devi_temple",
    parent_node_id: "node_dwarka",
    name: "Rukmini Devi Temple",
    lat: 22.2437,
    lng: 68.9829,
    tags: ["spiritual", "heritage", "architecture"],
    recommended_hours: 0.75,
    description:
      "Carved temple dedicated to Rukmini, commonly paired with the Dwarka temple circuit.",
  },
  {
    id: "attr_somnath_temple",
    parent_node_id: "node_somnath",
    name: "Somnath Temple",
    lat: 20.888,
    lng: 70.4012,
    tags: ["spiritual", "heritage", "architecture"],
    recommended_hours: 1.5,
    description:
      "Seafront Jyotirlinga temple and evening aarti anchor on the Saurashtra coast.",
  },
  {
    id: "attr_triveni_sangam_somnath",
    parent_node_id: "node_somnath",
    name: "Triveni Sangam Somnath",
    lat: 20.8918,
    lng: 70.4081,
    tags: ["spiritual", "nature", "culture"],
    recommended_hours: 1,
    description:
      "Pilgrimage ghat where three sacred rivers are believed to meet near Somnath.",
  },
  {
    id: "attr_bhalka_tirth",
    parent_node_id: "node_somnath",
    name: "Bhalka Tirth",
    lat: 20.9083,
    lng: 70.3819,
    tags: ["spiritual", "heritage", "culture"],
    recommended_hours: 0.75,
    description:
      "Krishna pilgrimage site usually visited with Somnath and Triveni Sangam.",
  },
  {
    id: "attr_uparkot_fort",
    parent_node_id: "node_junagadh",
    name: "Uparkot Fort",
    lat: 21.5227,
    lng: 70.4708,
    tags: ["heritage", "history", "architecture"],
    recommended_hours: 2.5,
    description:
      "Ancient citadel with ramparts, stepwells, caves, and views toward Girnar.",
  },
  {
    id: "attr_mahabat_maqbara",
    parent_node_id: "node_junagadh",
    name: "Mahabat Maqbara",
    lat: 21.5191,
    lng: 70.4646,
    tags: ["heritage", "architecture", "photography"],
    recommended_hours: 0.75,
    description:
      "Ornate mausoleum complex known for spiral minarets and Indo-Islamic detailing.",
  },
  {
    id: "attr_girnar_steps",
    parent_node_id: "node_junagadh",
    name: "Girnar Steps",
    lat: 21.5154,
    lng: 70.5235,
    tags: ["spiritual", "adventure", "nature"],
    recommended_hours: 5,
    description:
      "Pilgrimage climb and ropeway approach to temples and viewpoints on Mount Girnar.",
  },
  {
    id: "attr_gir_national_park_safari",
    parent_node_id: "node_sasan_gir",
    name: "Gir National Park Safari",
    lat: 21.1333,
    lng: 70.7833,
    tags: ["wildlife", "adventure", "nature"],
    recommended_hours: 4,
    description:
      "Permit-based jeep safari zone for Asiatic lion habitat around Sasan Gir.",
  },
  {
    id: "attr_devalia_safari_park",
    parent_node_id: "node_sasan_gir",
    name: "Devalia Safari Park",
    lat: 21.1796,
    lng: 70.6417,
    tags: ["wildlife", "family", "nature"],
    recommended_hours: 2.5,
    description:
      "Interpretation zone offering a shorter, more predictable wildlife-viewing circuit.",
  },
  {
    id: "attr_kankai_mata_temple",
    parent_node_id: "node_sasan_gir",
    name: "Kankai Mata Temple",
    lat: 21.1032,
    lng: 70.7951,
    tags: ["spiritual", "wildlife", "nature"],
    recommended_hours: 2,
    description:
      "Forest-side temple excursion inside the broader Gir landscape, subject to access controls.",
  },
  {
    id: "attr_statue_of_unity",
    parent_node_id: "node_kevadia",
    name: "Statue of Unity",
    lat: 21.838,
    lng: 73.7191,
    tags: ["culture", "architecture", "family"],
    recommended_hours: 3,
    description:
      "Sardar Patel monument complex with museum, viewing gallery, and river-valley views.",
  },
  {
    id: "attr_valley_of_flowers_kevadia",
    parent_node_id: "node_kevadia",
    name: "Valley of Flowers Kevadia",
    lat: 21.8412,
    lng: 73.7236,
    tags: ["nature", "family", "photography"],
    recommended_hours: 1.5,
    description:
      "Landscaped garden trail near the Statue of Unity with seasonal planting and viewpoints.",
  },
  {
    id: "attr_sardar_sarovar_dam_viewpoint",
    parent_node_id: "node_kevadia",
    name: "Sardar Sarovar Dam Viewpoint",
    lat: 21.8307,
    lng: 73.7474,
    tags: ["nature", "viewpoint", "culture"],
    recommended_hours: 1.25,
    description:
      "Narmada dam viewpoint commonly paired with the Kevadia monument circuit.",
  },
];

const ROAD_EDGES: RawRoadEdge[] = [
  {
    from: "node_ahmedabad",
    to: "node_vadodara",
    distance_km: 110,
    travel_time_hours: 2.0,
    road_quality: "excellent",
  },
  {
    from: "node_ahmedabad",
    to: "node_rajkot",
    distance_km: 215,
    travel_time_hours: 3.5,
    road_quality: "good",
  },
  {
    from: "node_ahmedabad",
    to: "node_surat",
    distance_km: 270,
    travel_time_hours: 4.0,
    road_quality: "good",
  },
  {
    from: "node_ahmedabad",
    to: "node_bhuj",
    distance_km: 325,
    travel_time_hours: 6.0,
    road_quality: "good",
  },
  {
    from: "node_ahmedabad",
    to: "node_kevadia",
    distance_km: 200,
    travel_time_hours: 3.5,
    road_quality: "good",
  },
  {
    from: "node_ahmedabad",
    to: "node_junagadh",
    distance_km: 320,
    travel_time_hours: 5.5,
    road_quality: "good",
  },

  {
    from: "node_vadodara",
    to: "node_surat",
    distance_km: 150,
    travel_time_hours: 2.5,
    road_quality: "good",
  },
  {
    from: "node_vadodara",
    to: "node_kevadia",
    distance_km: 90,
    travel_time_hours: 2.0,
    road_quality: "good",
  },

  {
    from: "node_surat",
    to: "node_kevadia",
    distance_km: 170,
    travel_time_hours: 3.0,
    road_quality: "good",
  },

  {
    from: "node_rajkot",
    to: "node_bhuj",
    distance_km: 250,
    travel_time_hours: 4.5,
    road_quality: "good",
  },
  {
    from: "node_rajkot",
    to: "node_junagadh",
    distance_km: 100,
    travel_time_hours: 2.0,
    road_quality: "good",
  },
  {
    from: "node_rajkot",
    to: "node_dwarka",
    distance_km: 230,
    travel_time_hours: 4.0,
    road_quality: "good",
  },
  {
    from: "node_rajkot",
    to: "node_somnath",
    distance_km: 190,
    travel_time_hours: 3.5,
    road_quality: "good",
  },

  {
    from: "node_junagadh",
    to: "node_somnath",
    distance_km: 85,
    travel_time_hours: 2.0,
    road_quality: "good",
  },
  {
    from: "node_junagadh",
    to: "node_sasan_gir",
    distance_km: 60,
    travel_time_hours: 1.5,
    road_quality: "good",
  },
  {
    from: "node_junagadh",
    to: "node_dwarka",
    distance_km: 220,
    travel_time_hours: 4.0,
    road_quality: "good",
  },

  {
    from: "node_sasan_gir",
    to: "node_somnath",
    distance_km: 45,
    travel_time_hours: 1.0,
    road_quality: "good",
  },

  {
    from: "node_dwarka",
    to: "node_somnath",
    distance_km: 230,
    travel_time_hours: 4.5,
    road_quality: "good",
  },
  {
    from: "node_dwarka",
    to: "node_bhuj",
    distance_km: 380,
    travel_time_hours: 6.5,
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
  estimatedHours("attr_sabarmati_ashram", "10:00", "18:00"),
  estimatedHours("attr_adalaj_stepwell", "08:00", "18:00"),
  estimatedHours("attr_sidi_saiyyed_mosque", "07:00", "19:00"),
  estimatedHours("attr_laxmi_vilas_palace", "09:30", "17:00", ["mon"]),
  estimatedHours("attr_sayaji_baug", "05:00", "22:00"),
  estimatedHours("attr_baroda_museum", "10:30", "17:00", ["thu"]),
  estimatedHours("attr_dutch_garden_surat", "08:00", "19:00"),
  estimatedHours("attr_dumas_beach", "06:00", "20:00"),
  estimatedHours("attr_sarthana_nature_park", "10:00", "17:00", ["mon"]),
  estimatedHours("attr_kaba_gandhi_no_delo", "09:00", "18:00"),
  estimatedHours("attr_rotary_dolls_museum", "09:30", "19:00"),
  estimatedHours("attr_watson_museum", "09:00", "13:00", ["wed"]),
  estimatedHours("attr_aina_mahal", "09:00", "17:30"),
  estimatedHours("attr_prag_mahal", "09:00", "17:30"),
  estimatedHours("attr_kutch_museum", "10:00", "17:00", ["wed"]),
  estimatedHours("attr_dwarkadhish_temple", "06:00", "21:30"),
  unknownHours("attr_bet_dwarka"),
  estimatedHours("attr_rukmini_devi_temple", "06:00", "20:00"),
  estimatedHours("attr_somnath_temple", "06:00", "21:30"),
  estimatedHours("attr_triveni_sangam_somnath", "06:00", "19:00"),
  estimatedHours("attr_bhalka_tirth", "06:00", "20:00"),
  estimatedHours("attr_uparkot_fort", "08:00", "18:00"),
  estimatedHours("attr_mahabat_maqbara", "09:00", "18:00"),
  estimatedHours("attr_girnar_steps", "04:00", "18:00"),
  estimatedHours("attr_gir_national_park_safari", "06:00", "18:00"),
  estimatedHours("attr_devalia_safari_park", "08:00", "17:00", ["wed"]),
  unknownHours("attr_kankai_mata_temple"),
  estimatedHours("attr_statue_of_unity", "08:00", "18:00", ["mon"]),
  estimatedHours("attr_valley_of_flowers_kevadia", "08:00", "18:00", ["mon"]),
  estimatedHours("attr_sardar_sarovar_dam_viewpoint", "08:00", "18:00"),
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
  unknownAdmission(
    "attr_sabarmati_ashram",
    "Ashram entry is commonly free, but the seed keeps this unknown until verified.",
  ),
  unknownAdmission("attr_adalaj_stepwell"),
  unknownAdmission("attr_sidi_saiyyed_mosque"),
  estimatedAdmission("attr_laxmi_vilas_palace", 150),
  unknownAdmission("attr_sayaji_baug"),
  estimatedAdmission("attr_baroda_museum", 20),
  unknownAdmission("attr_dutch_garden_surat"),
  unknownAdmission("attr_dumas_beach"),
  estimatedAdmission("attr_sarthana_nature_park", 50),
  unknownAdmission("attr_kaba_gandhi_no_delo"),
  estimatedAdmission("attr_rotary_dolls_museum", 25),
  estimatedAdmission("attr_watson_museum", 10),
  estimatedAdmission("attr_aina_mahal", 30),
  estimatedAdmission("attr_prag_mahal", 40),
  estimatedAdmission("attr_kutch_museum", 5),
  unknownAdmission(
    "attr_dwarkadhish_temple",
    "Temple entry is typically free; ancillary charges are not modelled as admission.",
  ),
  unknownAdmission("attr_bet_dwarka"),
  unknownAdmission("attr_rukmini_devi_temple"),
  unknownAdmission("attr_somnath_temple"),
  unknownAdmission("attr_triveni_sangam_somnath"),
  unknownAdmission("attr_bhalka_tirth"),
  estimatedAdmission("attr_uparkot_fort", 100),
  unknownAdmission("attr_mahabat_maqbara"),
  unknownAdmission("attr_girnar_steps"),
  estimatedAdmission("attr_gir_national_park_safari", 800),
  estimatedAdmission("attr_devalia_safari_park", 150),
  unknownAdmission("attr_kankai_mata_temple"),
  estimatedAdmission("attr_statue_of_unity", 150),
  unknownAdmission("attr_valley_of_flowers_kevadia"),
  unknownAdmission("attr_sardar_sarovar_dam_viewpoint"),
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
      timezone: REGION_TIMEZONE,
      data_version: CURRENT_DATA_VERSION,
      source_type: "manual",
      confidence: "estimated",
    },
    location: { lat: c.lat, lng: c.lng },
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
    },
    location: { lat: attraction.lat, lng: attraction.lng },
    parent_node_id: attraction.parent_node_id,
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
  attractions: toAttractionNodes,
  attractionHours: () => ATTRACTION_HOURS,
  attractionAdmissions: () => ATTRACTION_ADMISSIONS,
  edges: toRoadEdges,
};

export default dataset;
