import type {
  Accommodation,
  AccommodationRoomType,
  StayRoomAllocationSummary,
  StayRoomSelection,
  TravellerComposition,
} from "@/types/domain";
import { normaliseTravellers } from "@/lib/itinerary/planningLimits";

interface AllocationState {
  cost: number;
  roomCount: number;
  counts: Record<string, number>;
}

interface OccupancyOption {
  adults: number;
  children: number;
}

/**
 * Pick the cheapest mix of bookable rooms that physically fits the party.
 *
 * Solved as a small dynamic program over the 2-D state grid
 * `[adultsAssigned][childrenAssigned]`. From each reachable state we try
 * every (room type × per-room occupancy) move emitted by
 * {@link occupancyOptions}, adding one more room and advancing the
 * counters by the adults/children that room actually seats. The state
 * transitions are *exact* — overshooting the party size in either
 * dimension is rejected — which prevents the previous bug where
 * `Math.min` clamping let two rooms double-book the same adult to
 * supervise two separate children.
 */
export function selectOptimalRoomAllocation(args: {
  accommodation: Accommodation;
  travellers: TravellerComposition;
  nights: number;
}): StayRoomAllocationSummary | null {
  const travellers = normaliseTravellers(args.travellers);
  const nights = Math.max(1, Math.trunc(args.nights));
  const roomTypes = getBookableRoomTypes(args.accommodation);
  if (roomTypes.length === 0) return null;

  const targetAdults = travellers.adults;
  const targetChildren = travellers.children;
  const best: Array<Array<AllocationState | undefined>> = Array.from(
    { length: targetAdults + 1 },
    () => Array<AllocationState | undefined>(targetChildren + 1).fill(undefined),
  );
  best[0][0] = { cost: 0, roomCount: 0, counts: {} };

  // Pre-compute per-room-type occupancy options so we don't rebuild them
  // for every reachable DP state.
  const optionsByRoomType = roomTypes.map((roomType) => ({
    roomType,
    options: occupancyOptions(roomType, travellers),
  }));

  // Each transition strictly increases adults and/or children covered, so
  // visiting states in ascending (adults, children) order guarantees the
  // source state is final before we expand from it.
  for (let adultsCovered = 0; adultsCovered <= targetAdults; adultsCovered += 1) {
    for (
      let childrenCovered = 0;
      childrenCovered <= targetChildren;
      childrenCovered += 1
    ) {
      const current = best[adultsCovered][childrenCovered];
      if (!current) continue;

      for (const { roomType, options } of optionsByRoomType) {
        for (const option of options) {
          const nextAdults = adultsCovered + option.adults;
          const nextChildren = childrenCovered + option.children;
          // Strict counts: a room cannot seat travellers we don't have.
          if (nextAdults > targetAdults) continue;
          if (nextChildren > targetChildren) continue;

          const candidate: AllocationState = {
            cost: current.cost + roomType.pricePerNight,
            roomCount: current.roomCount + 1,
            counts: {
              ...current.counts,
              [roomType.id]: (current.counts[roomType.id] ?? 0) + 1,
            },
          };

          const existing = best[nextAdults][nextChildren];
          if (!existing || compareAllocationStates(candidate, existing) < 0) {
            best[nextAdults][nextChildren] = candidate;
          }
        }
      }
    }
  }

  const solution = best[targetAdults][targetChildren];
  if (!solution) return null;

  const rooms = buildSelectedRooms({
    roomTypes,
    counts: solution.counts,
    nights,
  });

  return {
    adults: travellers.adults,
    children: travellers.children,
    totalRooms: solution.roomCount,
    rooms,
  };
}

export function getBookableRoomTypes(
  accommodation: Accommodation,
): AccommodationRoomType[] {
  const explicit = (accommodation.roomTypes ?? [])
    .filter((roomType) => roomType.pricePerNight > 0)
    .sort((left, right) => {
      const priceDiff = left.pricePerNight - right.pricePerNight;
      if (priceDiff !== 0) return priceDiff;
      return left.id.localeCompare(right.id);
    });
  if (explicit.length > 0) return explicit;

  if (accommodation.pricePerNight <= 0) return [];

  return [
    {
      id: `${accommodation.id}_legacy_standard`,
      name: legacyRoomName(accommodation),
      pricePerNight: accommodation.pricePerNight,
      maxAdults: accommodation.category === "hostel" ? 1 : 2,
      maxChildren:
        accommodation.category === "hostel"
          ? 0
          : accommodation.familyFriendly
            ? 2
            : 0,
      maxOccupancy:
        accommodation.category === "hostel"
          ? 1
          : accommodation.familyFriendly
            ? 4
            : 2,
    },
  ];
}

function buildSelectedRooms(args: {
  roomTypes: AccommodationRoomType[];
  counts: Record<string, number>;
  nights: number;
}): StayRoomSelection[] {
  return args.roomTypes
    .map((roomType) => {
      const roomCount = args.counts[roomType.id] ?? 0;
      if (roomCount <= 0) return null;

      const nightlyCost = roomType.pricePerNight * roomCount;
      return {
        roomTypeId: roomType.id,
        roomTypeName: roomType.name,
        roomCount,
        unitPricePerNight: roundCurrency(roomType.pricePerNight),
        nightlyCost: roundCurrency(nightlyCost),
        totalCost: roundCurrency(nightlyCost * args.nights),
        ...(roomType.maxAdults !== undefined
          ? { maxAdults: roomType.maxAdults }
          : {}),
        ...(roomType.maxChildren !== undefined
          ? { maxChildren: roomType.maxChildren }
          : {}),
        ...(roomType.maxOccupancy !== undefined
          ? { maxOccupancy: roomType.maxOccupancy }
          : {}),
      } satisfies StayRoomSelection;
    })
    .filter((room): room is StayRoomSelection => Boolean(room));
}

/**
 * Enumerate the realistic ways the party can fill ONE room of this type.
 *
 * Hard rules baked in here (so the DP never has to know about them):
 *   1. A room must seat at least one person (no empty rooms).
 *   2. A room with children always carries at least one supervising adult.
 *      Hotels do not let unaccompanied minors check in, and our planner
 *      should never silently produce a room mix that implies otherwise.
 *   3. Per-room caps from the room type (`maxAdults`, `maxChildren`,
 *      `maxOccupancy`) are respected.
 *
 * Options are ordered by total headcount descending so the DP encounters
 * the most "efficient" assignments first; this only matters as a
 * deterministic tie-breaker — cost minimisation still drives selection.
 */
function occupancyOptions(
  roomType: AccommodationRoomType,
  travellers: TravellerComposition,
): OccupancyOption[] {
  const options: OccupancyOption[] = [];
  const maxAdultsForRoom = Math.min(
    travellers.adults,
    roomType.maxAdults ?? travellers.adults,
  );
  const maxChildrenForRoom = Math.min(
    travellers.children,
    roomType.maxChildren ?? travellers.children,
  );

  for (let adults = 0; adults <= maxAdultsForRoom; adults += 1) {
    for (let children = 0; children <= maxChildrenForRoom; children += 1) {
      if (adults === 0 && children === 0) continue;
      if (children > 0 && adults === 0) continue;
      if (
        roomType.maxOccupancy !== undefined &&
        adults + children > roomType.maxOccupancy
      ) {
        continue;
      }
      options.push({ adults, children });
    }
  }

  return options.sort((left, right) => {
    const headcountDiff =
      right.adults + right.children - (left.adults + left.children);
    if (headcountDiff !== 0) return headcountDiff;
    if (right.adults !== left.adults) return right.adults - left.adults;
    return right.children - left.children;
  });
}

function compareAllocationStates(
  left: AllocationState,
  right: AllocationState,
): number {
  if (left.cost !== right.cost) return left.cost - right.cost;
  if (left.roomCount !== right.roomCount) return left.roomCount - right.roomCount;
  return signatureForCounts(left.counts).localeCompare(
    signatureForCounts(right.counts),
  );
}

function signatureForCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([roomTypeId, count]) => `${roomTypeId}:${count}`)
    .join("|");
}

function legacyRoomName(accommodation: Accommodation): string {
  switch (accommodation.category) {
    case "hostel":
      return "Dorm Bed";
    case "heritage":
      return "Heritage Room";
    case "premium":
    case "resort":
      return "Deluxe Room";
    default:
      return "Standard Room";
  }
}

function roundCurrency(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}
