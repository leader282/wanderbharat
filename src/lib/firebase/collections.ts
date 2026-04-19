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
  users: "users",
  regions: "regions",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
