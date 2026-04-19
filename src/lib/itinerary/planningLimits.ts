import type { TravellerComposition } from "@/types/domain";

export const MAX_TRIP_DAYS = 7;

export const DEFAULT_TRAVELLERS: TravellerComposition = {
  adults: 1,
  children: 0,
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

  return { adults, children };
}

export function totalTravellers(travellers: TravellerComposition): number {
  return Math.max(1, travellers.adults + travellers.children);
}
