import type { Itinerary } from "@/types/domain";

/**
 * Saved itineraries are private to their owner.
 * Guest itineraries (`user_id` absent) remain shareable by link.
 */
export function canAccessItinerary(args: {
  itineraryUserId: Itinerary["user_id"];
  requesterUserId: string | null | undefined;
}): boolean {
  if (args.itineraryUserId === null) return true;

  const ownerId = args.itineraryUserId.trim();
  if (!ownerId) return false;

  return ownerId === (args.requesterUserId?.trim() ?? null);
}
