/**
 * Firestore collection names. Centralised so renaming happens in one place
 * and callers never type raw strings.
 *
 * Attractions are not a separate collection — they live in `nodes` with
 * `type: "attraction"` and a `parent_node_id` pointing at their city.
 */
export const COLLECTIONS = {
  nodes: "nodes",
  edges: "edges",
  accommodations: "accommodations",
  itineraries: "itineraries",
  attraction_hours: "attraction_hours",
  attraction_admissions: "attraction_admissions",
  hotel_search_snapshots: "hotel_search_snapshots",
  hotel_offer_snapshots: "hotel_offer_snapshots",
  provider_call_logs: "provider_call_logs",
  users: "users",
  regions: "regions",
  data_quality_issues: "data_quality_issues",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
