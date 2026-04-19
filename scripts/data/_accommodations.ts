import type {
  Accommodation,
  AccommodationCategory,
  AccommodationRoomType,
} from "@/types/domain";

export interface AccommodationSeedCity {
  nodeId: string;
  name: string;
  regionId: string;
  lat: number;
  lng: number;
  theme: string;
  baseNightlyRate: number;
}

interface AccommodationTemplate {
  key: string;
  category: AccommodationCategory;
  priceMultiplier: number;
  rating: number;
  reviewCount: number;
  amenities: string[];
  distanceFromCenterKm: number;
  latOffset: number;
  lngOffset: number;
  familyFriendly?: boolean;
  coupleFriendly?: boolean;
  breakfastIncluded?: boolean;
  buildName: (city: AccommodationSeedCity) => string;
}

const TEMPLATES: AccommodationTemplate[] = [
  {
    key: "budget_inn",
    category: "budget",
    priceMultiplier: 0.58,
    rating: 3.9,
    reviewCount: 640,
    amenities: ["wifi", "parking", "hot_water"],
    distanceFromCenterKm: 1.4,
    latOffset: 0.005,
    lngOffset: -0.004,
    familyFriendly: true,
    buildName: (city) => `${city.name} Transit Lodge`,
  },
  {
    key: "budget_residency",
    category: "budget",
    priceMultiplier: 0.68,
    rating: 4,
    reviewCount: 820,
    amenities: ["wifi", "breakfast", "parking", "air_conditioning"],
    distanceFromCenterKm: 0.9,
    latOffset: -0.004,
    lngOffset: 0.003,
    familyFriendly: true,
    breakfastIncluded: true,
    buildName: (city) => `${city.theme} Budget Inn`,
  },
  {
    key: "midrange_courtyard",
    category: "midrange",
    priceMultiplier: 0.92,
    rating: 4.2,
    reviewCount: 1180,
    amenities: ["wifi", "breakfast", "parking", "air_conditioning"],
    distanceFromCenterKm: 0.7,
    latOffset: 0.003,
    lngOffset: 0.005,
    familyFriendly: true,
    breakfastIncluded: true,
    buildName: (city) => `${city.name} Courtyard Residency`,
  },
  {
    key: "midrange_comfort",
    category: "midrange",
    priceMultiplier: 1.02,
    rating: 4.1,
    reviewCount: 960,
    amenities: ["wifi", "breakfast", "laundry", "air_conditioning"],
    distanceFromCenterKm: 1.1,
    latOffset: -0.006,
    lngOffset: -0.002,
    familyFriendly: true,
    coupleFriendly: true,
    breakfastIncluded: true,
    buildName: (city) => `${city.theme} Comfort House`,
  },
  {
    key: "premium_grand",
    category: "premium",
    priceMultiplier: 1.28,
    rating: 4.6,
    reviewCount: 2140,
    amenities: [
      "wifi",
      "breakfast",
      "pool",
      "parking",
      "room_service",
      "air_conditioning",
    ],
    distanceFromCenterKm: 2.4,
    latOffset: 0.008,
    lngOffset: 0.006,
    familyFriendly: true,
    coupleFriendly: true,
    breakfastIncluded: true,
    buildName: (city) => `The ${city.theme} Grand`,
  },
  {
    key: "premium_signature",
    category: "premium",
    priceMultiplier: 1.38,
    rating: 4.5,
    reviewCount: 1680,
    amenities: [
      "wifi",
      "breakfast",
      "spa",
      "parking",
      "air_conditioning",
      "room_service",
    ],
    distanceFromCenterKm: 1.8,
    latOffset: -0.007,
    lngOffset: 0.007,
    coupleFriendly: true,
    breakfastIncluded: true,
    buildName: (city) => `${city.name} Signature Suites`,
  },
  {
    key: "hostel",
    category: "hostel",
    priceMultiplier: 0.45,
    rating: 3.8,
    reviewCount: 530,
    amenities: ["wifi", "laundry", "hot_water", "common_lounge"],
    distanceFromCenterKm: 0.6,
    latOffset: 0.002,
    lngOffset: -0.006,
    buildName: (city) => `${city.name} Backpackers Hub`,
  },
  {
    key: "heritage_haveli",
    category: "heritage",
    priceMultiplier: 1.16,
    rating: 4.4,
    reviewCount: 1240,
    amenities: [
      "wifi",
      "breakfast",
      "courtyard",
      "parking",
      "cultural_programmes",
    ],
    distanceFromCenterKm: 0.8,
    latOffset: -0.003,
    lngOffset: -0.007,
    familyFriendly: true,
    coupleFriendly: true,
    breakfastIncluded: true,
    buildName: (city) => `${city.theme} Heritage Haveli`,
  },
  {
    key: "heritage_manor",
    category: "heritage",
    priceMultiplier: 1.3,
    rating: 4.3,
    reviewCount: 990,
    amenities: [
      "wifi",
      "breakfast",
      "courtyard",
      "air_conditioning",
      "library",
    ],
    distanceFromCenterKm: 1.3,
    latOffset: 0.006,
    lngOffset: 0.002,
    coupleFriendly: true,
    breakfastIncluded: true,
    buildName: (city) => `${city.name} Old Quarter Manor`,
  },
  {
    key: "resort",
    category: "resort",
    priceMultiplier: 1.56,
    rating: 4.7,
    reviewCount: 1890,
    amenities: [
      "wifi",
      "breakfast",
      "pool",
      "spa",
      "parking",
      "restaurant",
    ],
    distanceFromCenterKm: 4.8,
    latOffset: -0.009,
    lngOffset: 0.009,
    familyFriendly: true,
    coupleFriendly: true,
    breakfastIncluded: true,
    buildName: (city) => `${city.theme} Retreat & Spa`,
  },
];

export function buildRegionAccommodations(args: {
  regionId: string;
  currency: string;
  cities: AccommodationSeedCity[];
}): Accommodation[] {
  return args.cities.flatMap((city) =>
    TEMPLATES.map((template) =>
      buildAccommodation({
        city,
        currency: args.currency,
        template,
      }),
    ),
  );
}

function buildAccommodation(args: {
  city: AccommodationSeedCity;
  currency: string;
  template: AccommodationTemplate;
}): Accommodation {
  const { city, currency, template } = args;
  const name = template.buildName(city);
  const baseRate = roundToNearestHundred(
    city.baseNightlyRate * template.priceMultiplier,
  );
  const roomTypes = buildRoomTypes(template, baseRate);

  return {
    id: `acc_${city.regionId}_${city.nodeId.replace(/^node_/, "")}_${template.key}`,
    regionId: city.regionId,
    nodeId: city.nodeId,
    name,
    category: template.category,
    pricePerNight: Math.min(...roomTypes.map((roomType) => roomType.pricePerNight)),
    currency,
    rating: template.rating,
    reviewCount: template.reviewCount,
    amenities: template.amenities,
    roomTypes,
    location: {
      lat: Number((city.lat + template.latOffset).toFixed(6)),
      lng: Number((city.lng + template.lngOffset).toFixed(6)),
    },
    distanceFromCenterKm: template.distanceFromCenterKm,
    ...(template.familyFriendly !== undefined
      ? { familyFriendly: template.familyFriendly }
      : {}),
    ...(template.coupleFriendly !== undefined
      ? { coupleFriendly: template.coupleFriendly }
      : {}),
    ...(template.breakfastIncluded !== undefined
      ? { breakfastIncluded: template.breakfastIncluded }
      : {}),
    active: true,
  };
}

function buildRoomTypes(
  template: AccommodationTemplate,
  baseRate: number,
): AccommodationRoomType[] {
  if (template.category === "hostel") {
    return [
      {
        id: `${template.key}_dorm_bed`,
        name: "Dorm Bed",
        pricePerNight: roundToNearestHundred(baseRate * 0.45),
        maxAdults: 1,
        maxChildren: 0,
        maxOccupancy: 1,
      },
      {
        id: `${template.key}_private_room`,
        name: "Private Room",
        pricePerNight: roundToNearestHundred(baseRate),
        maxAdults: 2,
        maxChildren: 0,
        maxOccupancy: 2,
      },
    ];
  }

  const roomTypes: AccommodationRoomType[] = [
    {
      id: `${template.key}_standard`,
      name: "Standard Room",
      pricePerNight: baseRate,
      maxAdults: 2,
      maxChildren: template.familyFriendly ? 1 : 0,
      maxOccupancy: template.familyFriendly ? 3 : 2,
    },
    {
      id: `${template.key}_deluxe`,
      name: "Deluxe Room",
      pricePerNight: roundToNearestHundred(baseRate * 1.15),
      maxAdults: 2,
      maxChildren: template.familyFriendly ? 1 : 0,
      maxOccupancy: template.familyFriendly ? 3 : 2,
    },
  ];

  if (template.familyFriendly) {
    roomTypes.push({
      id: `${template.key}_family`,
      name: "Family Room",
      pricePerNight: roundToNearestHundred(baseRate * 1.45),
      maxAdults: 2,
      maxChildren: 2,
      maxOccupancy: 4,
    });
  }

  if (
    template.category === "premium" ||
    template.category === "heritage" ||
    template.category === "resort"
  ) {
    roomTypes.push({
      id: `${template.key}_suite`,
      name: template.category === "heritage" ? "Heritage Suite" : "Suite",
      pricePerNight: roundToNearestHundred(baseRate * 1.75),
      maxAdults: 3,
      maxChildren: 2,
      maxOccupancy: 5,
    });
  }

  return roomTypes;
}

function roundToNearestHundred(value: number): number {
  return Math.round(Math.max(0, value) / 100) * 100;
}
