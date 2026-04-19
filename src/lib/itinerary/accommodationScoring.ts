import type {
  Accommodation,
  AccommodationPreference,
  PreferenceTag,
  TravelStyle,
} from "@/types/domain";
import type { NightlyBudgetRange } from "@/lib/itinerary/accommodationConstraints";

export interface AccommodationScoreContext {
  travelStyle: TravelStyle;
  accommodationPreference?: AccommodationPreference;
  nightlyBudget?: NightlyBudgetRange;
  interests?: PreferenceTag[];
}

export interface ScoredAccommodation {
  accommodation: Accommodation;
  score: number;
  factors: {
    rating: number;
    value: number;
    location: number;
    amenities: number;
    travelStyle: number;
  };
}

const STYLE_CATEGORY_SCORES: Record<
  TravelStyle,
  Record<Accommodation["category"], number>
> = {
  relaxed: {
    budget: 0.55,
    midrange: 0.8,
    premium: 0.92,
    hostel: 0.15,
    heritage: 0.95,
    resort: 1,
  },
  balanced: {
    budget: 0.72,
    midrange: 1,
    premium: 0.76,
    hostel: 0.55,
    heritage: 0.9,
    resort: 0.68,
  },
  adventurous: {
    budget: 0.9,
    midrange: 0.68,
    premium: 0.48,
    hostel: 1,
    heritage: 0.72,
    resort: 0.52,
  },
};

const STYLE_AMENITIES: Record<TravelStyle, string[]> = {
  relaxed: ["wifi", "breakfast", "parking", "pool"],
  balanced: ["wifi", "breakfast", "air_conditioning", "parking"],
  adventurous: ["wifi", "breakfast", "laundry", "hot_water"],
};

export function scoreAccommodation(
  accommodation: Accommodation,
  context: AccommodationScoreContext,
): ScoredAccommodation {
  const rating = scoreRating(accommodation.rating, accommodation.reviewCount);
  const value = scoreValue(
    accommodation.pricePerNight,
    context.nightlyBudget,
    context.accommodationPreference ?? "auto",
  );
  const location = clamp01(1 - accommodation.distanceFromCenterKm / 12);
  const amenities = scoreAmenities(accommodation.amenities, context.travelStyle);
  const travelStyle = scoreTravelStyleFit(
    accommodation,
    context.travelStyle,
    context.accommodationPreference ?? "auto",
    context.interests ?? [],
  );

  const score =
    0.34 * rating +
    0.24 * value +
    0.16 * location +
    0.14 * amenities +
    0.12 * travelStyle;

  return {
    accommodation,
    score,
    factors: {
      rating,
      value,
      location,
      amenities,
      travelStyle,
    },
  };
}

export function sortScoredAccommodations(
  scored: ScoredAccommodation[],
): ScoredAccommodation[] {
  return [...scored].sort((left, right) => {
    const scoreDiff = right.score - left.score;
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;

    const priceDiff =
      left.accommodation.pricePerNight - right.accommodation.pricePerNight;
    if (priceDiff !== 0) return priceDiff;

    return left.accommodation.id.localeCompare(right.accommodation.id);
  });
}

function scoreRating(rating: number, reviewCount: number): number {
  const ratingFactor = clamp01((rating - 3) / 2);
  const confidence = clamp(reviewCount / 500, 0.25, 1);
  return clamp01(ratingFactor * 0.85 + confidence * 0.15);
}

function scoreValue(
  pricePerNight: number,
  nightlyBudget: NightlyBudgetRange | undefined,
  preference: AccommodationPreference,
): number {
  if (!nightlyBudget || nightlyBudget.max <= 0) return 0.5;

  const target = resolveTargetNightlyRate(nightlyBudget, preference);
  if (pricePerNight <= target) {
    const slack = Math.max(1, target);
    return clamp01(1 - (target - pricePerNight) / (slack * 2));
  }

  const overBy = pricePerNight - target;
  const span = Math.max(1, nightlyBudget.max - target, target * 0.5);
  return clamp01(1 - overBy / span);
}

function resolveTargetNightlyRate(
  nightlyBudget: NightlyBudgetRange,
  preference: AccommodationPreference,
): number {
  const min = Math.max(0, nightlyBudget.min);
  const max = Math.max(1, nightlyBudget.max);

  switch (preference) {
    case "budget":
      return Math.max(1, min + (max - min) * 0.3);
    case "premium":
      return Math.max(1, min + (max - min) * 0.85);
    default:
      return Math.max(1, min + (max - min) * 0.6);
  }
}

function scoreAmenities(amenities: string[], travelStyle: TravelStyle): number {
  const preferred = STYLE_AMENITIES[travelStyle];
  if (preferred.length === 0) return 0.5;

  const set = new Set(amenities.map((amenity) => amenity.toLowerCase()));
  let hits = 0;
  for (const amenity of preferred) {
    if (set.has(amenity.toLowerCase())) hits += 1;
  }

  return hits / preferred.length;
}

function scoreTravelStyleFit(
  accommodation: Accommodation,
  travelStyle: TravelStyle,
  preference: AccommodationPreference,
  interests: PreferenceTag[],
): number {
  let score =
    STYLE_CATEGORY_SCORES[travelStyle][accommodation.category] ??
    STYLE_CATEGORY_SCORES.balanced.midrange;

  switch (preference) {
    case "budget":
      if (
        accommodation.category === "budget" ||
        accommodation.category === "hostel"
      ) {
        score += 0.12;
      } else if (
        accommodation.category === "premium" ||
        accommodation.category === "resort"
      ) {
        score -= 0.18;
      }
      break;
    case "midrange":
      if (
        accommodation.category === "midrange" ||
        accommodation.category === "heritage"
      ) {
        score += 0.1;
      }
      break;
    case "premium":
      if (
        accommodation.category === "premium" ||
        accommodation.category === "resort" ||
        accommodation.category === "heritage"
      ) {
        score += 0.14;
      } else if (
        accommodation.category === "budget" ||
        accommodation.category === "hostel"
      ) {
        score -= 0.2;
      }
      break;
    default:
      break;
  }

  const interestSet = new Set(interests.map((interest) => interest.toLowerCase()));
  if (
    interestSet.has("luxury") &&
    (accommodation.category === "premium" ||
      accommodation.category === "resort")
  ) {
    score += 0.08;
  }
  if (
    interestSet.has("heritage") &&
    accommodation.category === "heritage"
  ) {
    score += 0.08;
  }

  return clamp01(score);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
