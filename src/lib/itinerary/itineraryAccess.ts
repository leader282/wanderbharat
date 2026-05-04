import type { Itinerary } from "@/types/domain";

/**
 * Saved itineraries are private to their owner.
 * Guest itineraries (`user_id` absent) remain shareable by link.
 */
export function canAccessItinerary(args: {
  itineraryUserId: Itinerary["user_id"];
  requesterUserId: string | null | undefined;
}): boolean {
  if (!args.itineraryUserId) return true;
  return args.itineraryUserId === (args.requesterUserId ?? null);
}
