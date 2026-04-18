/**
 * Firestore collection names. Centralised so renaming happens in one place
 * and callers never type raw strings.
 */
export const COLLECTIONS = {
  nodes: "nodes",
  edges: "edges",
  attractions: "attractions",
  itineraries: "itineraries",
  users: "users",
  regions: "regions",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
