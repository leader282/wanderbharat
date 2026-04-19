import type {
  Accommodation,
  AccommodationCategory,
  AccommodationPreference,
  BudgetRange,
  TravelStyle,
} from "@/types/domain";

export interface NightlyBudgetRange {
  min: number;
  max: number;
}

export interface AccommodationSelectionConstraints {
  nodeId: string;
  activeOnly?: boolean;
  allowedCategories?: AccommodationCategory[];
  nightlyBudget?: NightlyBudgetRange;
  minRating?: number;
}

const ALL_CATEGORIES: AccommodationCategory[] = [
  "budget",
  "midrange",
  "premium",
  "hostel",
  "heritage",
  "resort",
];

const STYLE_ALLOWED_CATEGORIES: Record<TravelStyle, AccommodationCategory[]> = {
  relaxed: ["budget", "midrange", "premium", "heritage", "resort"],
  balanced: [...ALL_CATEGORIES],
  adventurous: [...ALL_CATEGORIES],
};

const PREFERENCE_ALLOWED_CATEGORIES: Record<
  AccommodationPreference,
  AccommodationCategory[]
> = {
  auto: [...ALL_CATEGORIES],
  budget: ["budget", "hostel", "midrange"],
  midrange: ["budget", "midrange", "heritage"],
  premium: ["premium", "heritage", "resort", "midrange"],
};

const STYLE_LODGING_SHARE: Record<TravelStyle, number> = {
  relaxed: 0.52,
  balanced: 0.45,
  adventurous: 0.38,
};

const PREFERENCE_SHARE_MULTIPLIER: Record<AccommodationPreference, number> = {
  auto: 1,
  budget: 0.72,
  midrange: 1,
  premium: 1.35,
};

export function deriveAllowedAccommodationCategories(args: {
  travelStyle: TravelStyle;
  accommodationPreference?: AccommodationPreference;
}): AccommodationCategory[] {
  const styleAllowed = new Set(STYLE_ALLOWED_CATEGORIES[args.travelStyle]);
  const preference =
    args.accommodationPreference ?? ("auto" as AccommodationPreference);
  const preferredAllowed = PREFERENCE_ALLOWED_CATEGORIES[preference];

  const allowed = preferredAllowed.filter((category) =>
    styleAllowed.has(category),
  );

  return allowed.length > 0 ? allowed : preferredAllowed;
}

export function deriveNightlyBudgetRange(args: {
  budget: BudgetRange;
  totalNights: number;
  travelStyle: TravelStyle;
  accommodationPreference?: AccommodationPreference;
}): NightlyBudgetRange {
  const nights = Math.max(1, Math.round(args.totalNights));
  const preference =
    args.accommodationPreference ?? ("auto" as AccommodationPreference);
  const lodgingShare = clamp(
    STYLE_LODGING_SHARE[args.travelStyle] *
      PREFERENCE_SHARE_MULTIPLIER[preference],
    0.2,
    0.8,
  );

  return {
    min: roundMoney((args.budget.min * lodgingShare) / nights),
    max: roundMoney((args.budget.max * lodgingShare) / nights),
  };
}

export function defaultAccommodationRatingThreshold(
  preference: AccommodationPreference = "auto",
): number | undefined {
  switch (preference) {
    case "budget":
      return 3.2;
    case "midrange":
      return 3.8;
    case "premium":
      return 4.2;
    default:
      return undefined;
  }
}

export function filterAccommodationsForStay(
  accommodations: Accommodation[],
  constraints: AccommodationSelectionConstraints,
): Accommodation[] {
  return accommodations.filter((accommodation) =>
    matchesAccommodationConstraints(accommodation, constraints),
  );
}

export function matchesAccommodationConstraints(
  accommodation: Accommodation,
  constraints: AccommodationSelectionConstraints,
): boolean {
  if (accommodation.nodeId !== constraints.nodeId) {
    return false;
  }
  if ((constraints.activeOnly ?? true) && !accommodation.active) {
    return false;
  }
  if (
    constraints.allowedCategories &&
    constraints.allowedCategories.length > 0 &&
    !constraints.allowedCategories.includes(accommodation.category)
  ) {
    return false;
  }
  if (
    constraints.nightlyBudget &&
    accommodation.pricePerNight > constraints.nightlyBudget.max
  ) {
    return false;
  }
  if (
    constraints.minRating !== undefined &&
    accommodation.rating < constraints.minRating
  ) {
    return false;
  }
  return true;
}

function roundMoney(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
