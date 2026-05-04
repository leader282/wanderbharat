import {
  DEFAULT_GUEST_NATIONALITY,
  type TravellerComposition,
} from "@/types/domain";

export const MAX_TRIP_DAYS = 7;

export const DEFAULT_TRAVELLERS: TravellerComposition = {
  adults: 1,
  children: 0,
  children_ages: [],
  rooms: 1,
  guest_nationality: DEFAULT_GUEST_NATIONALITY,
};

export function normaliseTravellers(
  travellers: TravellerComposition | undefined,
): TravellerComposition {
  const adults = Math.max(
    1,
    Math.trunc(travellers?.adults ?? DEFAULT_TRAVELLERS.adults),
  );
  const children = Math.max(
    0,
    Math.trunc(travellers?.children ?? DEFAULT_TRAVELLERS.children),
  );
  const rooms = Math.max(1, Math.trunc(travellers?.rooms ?? 1));
  const guest_nationality = normaliseGuestNationality(
    travellers?.guest_nationality,
  );
  const children_ages = normaliseChildrenAges(travellers?.children_ages, children);

  return {
    adults,
    children,
    children_ages,
    rooms,
    guest_nationality,
  };
}

export function totalTravellers(travellers: TravellerComposition): number {
  return Math.max(1, travellers.adults + travellers.children);
}

function normaliseGuestNationality(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_GUEST_NATIONALITY;
  const cleaned = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cleaned) ? cleaned : DEFAULT_GUEST_NATIONALITY;
}

function normaliseChildrenAges(
  value: unknown,
  childrenCount: number,
): number[] | undefined {
  if (childrenCount <= 0) return [];
  if (!Array.isArray(value) || value.length !== childrenCount) return undefined;

  const ages: number[] = [];
  for (const entry of value) {
    if (!Number.isFinite(entry)) return undefined;
    const age = Math.trunc(Number(entry));
    if (age < 0 || age > 17) return undefined;
    ages.push(age);
  }
  return ages;
}
