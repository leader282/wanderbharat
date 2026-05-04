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
const REGION_TIMEZONE = "Asia/Kolkata";
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

const ATTRACTIONS: SeedAttraction[] = [
  {
    id: "attr_the_ridge_shimla",
    parent_node_id: "node_shimla",
    name: "The Ridge Shimla",
    lat: 31.1049,
    lng: 77.1734,
    tags: ["heritage", "culture", "viewpoint"],
    recommended_hours: 1.5,
    description:
      "Open promenade beside Mall Road with colonial landmarks, cafes, and mountain views.",
  },
  {
    id: "attr_christ_church_shimla",
    parent_node_id: "node_shimla",
    name: "Christ Church Shimla",
    lat: 31.1042,
    lng: 77.1726,
    tags: ["heritage", "architecture", "spiritual"],
    recommended_hours: 0.75,
    description:
      "Neo-Gothic church on the Ridge, one of Shimla's most recognisable colonial landmarks.",
  },
  {
    id: "attr_jakhu_temple",
    parent_node_id: "node_shimla",
    name: "Jakhu Temple",
    lat: 31.1036,
    lng: 77.185,
    tags: ["spiritual", "viewpoint", "nature"],
    recommended_hours: 2,
    description:
      "Hilltop Hanuman temple reached by road, ropeway, or steep forest walk above Shimla.",
  },
  {
    id: "attr_hadimba_devi_temple",
    parent_node_id: "node_manali",
    name: "Hadimba Devi Temple",
    lat: 32.2485,
    lng: 77.1805,
    tags: ["spiritual", "heritage", "nature"],
    recommended_hours: 1,
    description:
      "Cedar-forest temple with distinctive wooden architecture near Old Manali.",
  },
  {
    id: "attr_solang_valley",
    parent_node_id: "node_manali",
    name: "Solang Valley",
    lat: 32.316,
    lng: 77.1571,
    tags: ["adventure", "nature", "family"],
    recommended_hours: 4,
    description:
      "Adventure valley for snow play, paragliding, ropeway rides, and mountain scenery.",
  },
  {
    id: "attr_manu_temple",
    parent_node_id: "node_manali",
    name: "Manu Temple",
    lat: 32.2576,
    lng: 77.175,
    tags: ["spiritual", "heritage", "culture"],
    recommended_hours: 1,
    description:
      "Old Manali temple with village lanes, cafes, and a quieter heritage circuit.",
  },
  {
    id: "attr_tsuglagkhang_complex",
    parent_node_id: "node_dharamshala",
    name: "Tsuglagkhang Complex",
    lat: 32.2326,
    lng: 76.3242,
    tags: ["spiritual", "culture", "heritage"],
    recommended_hours: 2,
    description:
      "Dalai Lama temple complex in McLeod Ganj with monastery spaces and Tibetan culture.",
  },
  {
    id: "attr_bhagsunag_waterfall",
    parent_node_id: "node_dharamshala",
    name: "Bhagsunag Waterfall",
    lat: 32.2463,
    lng: 76.3357,
    tags: ["nature", "adventure", "spiritual"],
    recommended_hours: 2,
    description:
      "Short uphill walk from Bhagsu village to a seasonal waterfall and temple area.",
  },
  {
    id: "attr_hpca_stadium",
    parent_node_id: "node_dharamshala",
    name: "HPCA Stadium",
    lat: 32.1976,
    lng: 76.3256,
    tags: ["culture", "photography", "viewpoint"],
    recommended_hours: 1,
    description:
      "Cricket stadium known for Dhauladhar mountain backdrops and photo stops.",
  },
  {
    id: "attr_st_johns_church_dalhousie",
    parent_node_id: "node_dalhousie",
    name: "St John's Church Dalhousie",
    lat: 32.5387,
    lng: 75.9704,
    tags: ["heritage", "architecture", "spiritual"],
    recommended_hours: 0.75,
    description:
      "Colonial-era church near Gandhi Chowk, useful for a short Dalhousie heritage walk.",
  },
  {
    id: "attr_panchpula",
    parent_node_id: "node_dalhousie",
    name: "Panchpula",
    lat: 32.5546,
    lng: 75.9869,
    tags: ["nature", "family", "viewpoint"],
    recommended_hours: 1.5,
    description:
      "Waterfall and picnic stop close to Dalhousie with small eateries and short walks.",
  },
  {
    id: "attr_kalatop_wildlife_sanctuary",
    parent_node_id: "node_dalhousie",
    name: "Kalatop Wildlife Sanctuary",
    lat: 32.5524,
    lng: 76.0358,
    tags: ["wildlife", "nature", "adventure"],
    recommended_hours: 3,
    description:
      "Deodar forest sanctuary between Dalhousie and Khajjiar with hikes and valley views.",
  },
  {
    id: "attr_raghunath_temple_kullu",
    parent_node_id: "node_kullu",
    name: "Raghunath Temple Kullu",
    lat: 31.957,
    lng: 77.1095,
    tags: ["spiritual", "heritage", "culture"],
    recommended_hours: 0.75,
    description:
      "Central Kullu temple linked to the town's Dussehra traditions and bazaar walks.",
  },
  {
    id: "attr_bijli_mahadev_temple",
    parent_node_id: "node_kullu",
    name: "Bijli Mahadev Temple",
    lat: 31.9921,
    lng: 77.1314,
    tags: ["spiritual", "adventure", "viewpoint"],
    recommended_hours: 3,
    description:
      "Hilltop temple reached by a climb, with sweeping Beas and Parvati valley views.",
  },
  {
    id: "attr_great_himalayan_national_park_gate",
    parent_node_id: "node_kullu",
    name: "Great Himalayan National Park Gate",
    lat: 31.7385,
    lng: 77.3867,
    tags: ["nature", "wildlife", "adventure"],
    recommended_hours: 4,
    description:
      "Tirthan-side gateway for forest walks and park interpretation around GHNP.",
  },
  {
    id: "attr_manikaran_sahib",
    parent_node_id: "node_kasol",
    name: "Manikaran Sahib",
    lat: 32.0279,
    lng: 77.3487,
    tags: ["spiritual", "culture", "nature"],
    recommended_hours: 2,
    description:
      "Hot-spring gurudwara and temple complex in the Parvati Valley pilgrimage circuit.",
  },
  {
    id: "attr_parvati_riverfront_kasol",
    parent_node_id: "node_kasol",
    name: "Parvati Riverfront Kasol",
    lat: 32.0102,
    lng: 77.3151,
    tags: ["nature", "food", "culture"],
    recommended_hours: 1.5,
    description:
      "Riverside cafe and walking belt through Kasol village along the Parvati River.",
  },
  {
    id: "attr_chalal_trek_trail",
    parent_node_id: "node_kasol",
    name: "Chalal Trek Trail",
    lat: 32.0134,
    lng: 77.3229,
    tags: ["adventure", "nature", "culture"],
    recommended_hours: 2.5,
    description:
      "Easy village trail from Kasol across the bridge toward Chalal and forest cafes.",
  },
  {
    id: "attr_khajjiar_lake",
    parent_node_id: "node_khajjiar",
    name: "Khajjiar Lake",
    lat: 32.5477,
    lng: 76.0594,
    tags: ["nature", "hill-station", "family"],
    recommended_hours: 2,
    description:
      "Meadow and lake bowl ringed by deodar forest, the core Khajjiar experience.",
  },
  {
    id: "attr_khajji_nag_temple",
    parent_node_id: "node_khajjiar",
    name: "Khajji Nag Temple",
    lat: 32.5472,
    lng: 76.059,
    tags: ["spiritual", "heritage", "culture"],
    recommended_hours: 0.75,
    description:
      "Old wooden temple beside the meadow, dedicated to Khajji Nag.",
  },
  {
    id: "attr_dainkund_peak",
    parent_node_id: "node_khajjiar",
    name: "Dainkund Peak",
    lat: 32.5252,
    lng: 75.9948,
    tags: ["nature", "viewpoint", "adventure"],
    recommended_hours: 3,
    description:
      "Ridge walk near Dalhousie-Khajjiar with open views and a hilltop temple.",
  },
  {
    id: "attr_bir_billing_takeoff",
    parent_node_id: "node_bir",
    name: "Bir Billing Paragliding Takeoff",
    lat: 32.0456,
    lng: 76.7101,
    tags: ["adventure", "nature", "viewpoint"],
    recommended_hours: 3,
    description:
      "Billing takeoff and landing circuit for tandem paragliding over the Kangra valley.",
  },
  {
    id: "attr_chokling_monastery",
    parent_node_id: "node_bir",
    name: "Chokling Monastery",
    lat: 32.0449,
    lng: 76.7259,
    tags: ["spiritual", "culture", "architecture"],
    recommended_hours: 1,
    description:
      "Tibetan monastery in Bir's colony area with prayer halls and mountain views.",
  },
  {
    id: "attr_deer_park_institute",
    parent_node_id: "node_bir",
    name: "Deer Park Institute",
    lat: 32.0436,
    lng: 76.721,
    tags: ["culture", "spiritual", "learning"],
    recommended_hours: 1,
    description:
      "Buddhist learning campus and cultural hub often paired with Bir monastery walks.",
  },
  {
    id: "attr_bhutnath_temple_mandi",
    parent_node_id: "node_mandi",
    name: "Bhutnath Temple Mandi",
    lat: 31.7087,
    lng: 76.9318,
    tags: ["spiritual", "heritage", "culture"],
    recommended_hours: 0.75,
    description:
      "Historic Shiva temple at the heart of old Mandi's temple-town circuit.",
  },
  {
    id: "attr_rewalsar_lake",
    parent_node_id: "node_mandi",
    name: "Rewalsar Lake",
    lat: 31.6336,
    lng: 76.8333,
    tags: ["spiritual", "nature", "culture"],
    recommended_hours: 2,
    description:
      "Sacred lake with Buddhist, Hindu, and Sikh shrines in the Mandi district.",
  },
  {
    id: "attr_prashar_lake",
    parent_node_id: "node_mandi",
    name: "Prashar Lake",
    lat: 31.7543,
    lng: 77.1012,
    tags: ["nature", "spiritual", "adventure"],
    recommended_hours: 5,
    description:
      "High-altitude lake and temple excursion above Mandi, popular for day hikes.",
  },
  {
    id: "attr_key_monastery",
    parent_node_id: "node_kaza",
    name: "Key Monastery",
    lat: 32.2977,
    lng: 78.0117,
    tags: ["spiritual", "heritage", "culture"],
    recommended_hours: 2,
    description:
      "Iconic hilltop Gelugpa monastery above Kaza with Spiti valley panoramas.",
  },
  {
    id: "attr_kibber_village",
    parent_node_id: "node_kaza",
    name: "Kibber Village",
    lat: 32.3315,
    lng: 78.0103,
    tags: ["culture", "nature", "adventure"],
    recommended_hours: 2.5,
    description:
      "High-altitude village near Key, used for short walks, wildlife spotting, and homestay culture.",
  },
  {
    id: "attr_hikkim_post_office",
    parent_node_id: "node_kaza",
    name: "Hikkim Post Office",
    lat: 32.2469,
    lng: 78.0877,
    tags: ["culture", "photography", "adventure"],
    recommended_hours: 1.5,
    description:
      "High-altitude post office stop in Spiti, often combined with Langza and Komic.",
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
  {
    from: "node_shimla",
    to: "node_manali",
    distance_km: 250,
    travel_time_hours: 7.0,
    road_quality: "average",
  },
  {
    from: "node_shimla",
    to: "node_mandi",
    distance_km: 160,
    travel_time_hours: 4.0,
    road_quality: "average",
  },
  {
    from: "node_shimla",
    to: "node_kullu",
    distance_km: 220,
    travel_time_hours: 6.0,
    road_quality: "average",
  },
  {
    from: "node_shimla",
    to: "node_kaza",
    distance_km: 410,
    travel_time_hours: 13.0,
    road_quality: "average",
  },

  {
    from: "node_manali",
    to: "node_kullu",
    distance_km: 40,
    travel_time_hours: 1.5,
    road_quality: "good",
  },
  {
    from: "node_manali",
    to: "node_kasol",
    distance_km: 75,
    travel_time_hours: 2.5,
    road_quality: "average",
  },
  {
    from: "node_manali",
    to: "node_mandi",
    distance_km: 110,
    travel_time_hours: 3.0,
    road_quality: "good",
  },
  {
    from: "node_manali",
    to: "node_kaza",
    distance_km: 200,
    travel_time_hours: 8.0,
    road_quality: "average",
  },
  {
    from: "node_manali",
    to: "node_dharamshala",
    distance_km: 235,
    travel_time_hours: 7.0,
    road_quality: "average",
  },
  {
    from: "node_manali",
    to: "node_bir",
    distance_km: 230,
    travel_time_hours: 7.0,
    road_quality: "average",
  },

  {
    from: "node_kullu",
    to: "node_kasol",
    distance_km: 35,
    travel_time_hours: 1.0,
    road_quality: "good",
  },
  {
    from: "node_kullu",
    to: "node_mandi",
    distance_km: 70,
    travel_time_hours: 2.0,
    road_quality: "good",
  },

  {
    from: "node_mandi",
    to: "node_dharamshala",
    distance_km: 145,
    travel_time_hours: 4.0,
    road_quality: "good",
  },
  {
    from: "node_mandi",
    to: "node_bir",
    distance_km: 110,
    travel_time_hours: 3.0,
    road_quality: "good",
  },

  {
    from: "node_dharamshala",
    to: "node_dalhousie",
    distance_km: 130,
    travel_time_hours: 3.5,
    road_quality: "good",
  },
  {
    from: "node_dharamshala",
    to: "node_bir",
    distance_km: 65,
    travel_time_hours: 2.0,
    road_quality: "good",
  },
  {
    from: "node_dharamshala",
    to: "node_khajjiar",
    distance_km: 140,
    travel_time_hours: 4.0,
    road_quality: "average",
  },

  {
    from: "node_dalhousie",
    to: "node_khajjiar",
    distance_km: 25,
    travel_time_hours: 1.0,
    road_quality: "good",
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
  estimatedHours("attr_the_ridge_shimla", "06:00", "22:00"),
  estimatedHours("attr_christ_church_shimla", "08:00", "18:00"),
  estimatedHours("attr_jakhu_temple", "06:00", "20:00"),
  estimatedHours("attr_hadimba_devi_temple", "08:00", "18:00"),
  estimatedHours("attr_solang_valley", "08:00", "18:00"),
  estimatedHours("attr_manu_temple", "06:00", "18:00"),
  estimatedHours("attr_tsuglagkhang_complex", "06:00", "19:00"),
  estimatedHours("attr_bhagsunag_waterfall", "07:00", "18:00"),
  unknownHours("attr_hpca_stadium"),
  estimatedHours("attr_st_johns_church_dalhousie", "09:00", "18:00"),
  estimatedHours("attr_panchpula", "07:00", "18:00"),
  estimatedHours("attr_kalatop_wildlife_sanctuary", "07:00", "18:00"),
  estimatedHours("attr_raghunath_temple_kullu", "06:00", "20:00"),
  estimatedHours("attr_bijli_mahadev_temple", "06:00", "18:00"),
  estimatedHours("attr_great_himalayan_national_park_gate", "08:00", "17:00"),
  estimatedHours("attr_manikaran_sahib", "05:00", "22:00"),
  estimatedHours("attr_parvati_riverfront_kasol", "06:00", "20:00"),
  estimatedHours("attr_chalal_trek_trail", "07:00", "18:00"),
  estimatedHours("attr_khajjiar_lake", "07:00", "18:00"),
  estimatedHours("attr_khajji_nag_temple", "07:00", "18:00"),
  estimatedHours("attr_dainkund_peak", "07:00", "17:00"),
  estimatedHours("attr_bir_billing_takeoff", "07:00", "18:00"),
  estimatedHours("attr_chokling_monastery", "06:00", "18:00"),
  estimatedHours("attr_deer_park_institute", "09:00", "17:00"),
  estimatedHours("attr_bhutnath_temple_mandi", "06:00", "20:00"),
  estimatedHours("attr_rewalsar_lake", "06:00", "19:00"),
  estimatedHours("attr_prashar_lake", "07:00", "18:00"),
  estimatedHours("attr_key_monastery", "06:00", "18:00"),
  estimatedHours("attr_kibber_village", "07:00", "18:00"),
  estimatedHours("attr_hikkim_post_office", "09:00", "17:00"),
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
  unknownAdmission("attr_the_ridge_shimla"),
  unknownAdmission("attr_christ_church_shimla"),
  unknownAdmission(
    "attr_jakhu_temple",
    "Temple entry and ropeway/activity costs are separate; keep admission unknown until verified.",
  ),
  unknownAdmission("attr_hadimba_devi_temple"),
  unknownAdmission(
    "attr_solang_valley",
    "Adventure activities vary by vendor and are not modelled as site admission.",
  ),
  unknownAdmission("attr_manu_temple"),
  unknownAdmission("attr_tsuglagkhang_complex"),
  unknownAdmission("attr_bhagsunag_waterfall"),
  unknownAdmission("attr_hpca_stadium"),
  unknownAdmission("attr_st_johns_church_dalhousie"),
  unknownAdmission("attr_panchpula"),
  estimatedAdmission("attr_kalatop_wildlife_sanctuary", 250),
  unknownAdmission("attr_raghunath_temple_kullu"),
  unknownAdmission("attr_bijli_mahadev_temple"),
  estimatedAdmission("attr_great_himalayan_national_park_gate", 100),
  unknownAdmission("attr_manikaran_sahib"),
  unknownAdmission("attr_parvati_riverfront_kasol"),
  unknownAdmission("attr_chalal_trek_trail"),
  unknownAdmission("attr_khajjiar_lake"),
  unknownAdmission("attr_khajji_nag_temple"),
  unknownAdmission("attr_dainkund_peak"),
  unknownAdmission(
    "attr_bir_billing_takeoff",
    "Tandem flight costs are activity prices, not attraction admission.",
  ),
  unknownAdmission("attr_chokling_monastery"),
  unknownAdmission("attr_deer_park_institute"),
  unknownAdmission("attr_bhutnath_temple_mandi"),
  unknownAdmission("attr_rewalsar_lake"),
  unknownAdmission("attr_prashar_lake"),
  unknownAdmission("attr_key_monastery"),
  unknownAdmission("attr_kibber_village"),
  unknownAdmission("attr_hikkim_post_office"),
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
  attractions: toAttractionNodes,
  attractionHours: () => ATTRACTION_HOURS,
  attractionAdmissions: () => ATTRACTION_ADMISSIONS,
  edges: toRoadEdges,
};

export default dataset;
