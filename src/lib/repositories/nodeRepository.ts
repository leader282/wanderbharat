import type { Firestore } from "firebase-admin/firestore";
import { FieldPath } from "firebase-admin/firestore";

import type { GraphNode, NodeType } from "@/types/domain";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { chunk } from "@/lib/utils/concurrency";

/**
 * Thin repository around the `nodes` collection. Generic over region /
 * type so it can serve cities, attractions, hotels, etc.
 *
 * `findNodes` is *always* complete — it walks cursors under the hood —
 * so callers never silently see a truncated list. Use `streamNodes` to
 * process huge collections without buffering them in memory.
 */

export interface FindNodesQuery {
  region?: string;
  /** Alternative to `region`: match any of these regions. */
  regions?: string[];
  country?: string;
  type?: NodeType;
  /** Restrict to nodes that belong to this parent (e.g. attractions of a city). */
  parent_node_id?: string;
  /** Optional AND-filter on tags (`array-contains-any`). */
  tags?: string[];
  /**
   * Hard cap on total results across pages. Leave unset to fully enumerate
   * the query. Batches of `pageSize` are fetched until the cap is hit.
   */
  limit?: number;
  /** Page size used when paginating. Firestore allows up to 1000. */
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 500;

function db(): Firestore {
  return getAdminDb();
}

function baseQuery(q: FindNodesQuery): FirebaseFirestore.Query {
  let query: FirebaseFirestore.Query = db().collection(COLLECTIONS.nodes);

  const regions = q.regions && q.regions.length > 0 ? q.regions : q.region ? [q.region] : [];
  if (regions.length === 1) {
    query = query.where("region", "==", regions[0]);
  } else if (regions.length > 1) {
    query = query.where("region", "in", regions.slice(0, 10));
  }

  if (q.country) query = query.where("country", "==", q.country);
  if (q.type) query = query.where("type", "==", q.type);
  if (q.parent_node_id) {
    query = query.where("parent_node_id", "==", q.parent_node_id);
  }
  if (q.tags && q.tags.length > 0) {
    query = query.where("tags", "array-contains-any", q.tags.slice(0, 10));
  }
  return query;
}

/**
 * Yield every matching node. Paginates with `startAfter` so
 * collections with millions of documents don't blow the function's
 * memory. Back-pressure friendly.
 */
export async function* streamNodes(
  q: FindNodesQuery = {},
): AsyncGenerator<GraphNode, void, void> {
  const pageSize = Math.max(1, Math.min(q.pageSize ?? DEFAULT_PAGE_SIZE, 1000));
  const hardCap = q.limit ?? Number.POSITIVE_INFINITY;
  let emitted = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (emitted < hardCap) {
    let pq = baseQuery(q).orderBy(FieldPath.documentId()).limit(pageSize);
    if (last) pq = pq.startAfter(last.id);
    const snap = await pq.get();
    if (snap.empty) return;

    for (const doc of snap.docs) {
      if (emitted >= hardCap) return;
      yield doc.data() as GraphNode;
      emitted += 1;
    }

    if (snap.docs.length < pageSize) return;
    last = snap.docs[snap.docs.length - 1];
  }
}

/**
 * Fetch every matching node. Paginates internally so there's no silent
 * truncation at 500 rows. Pass `limit` if you actually need to cap.
 */
export async function findNodes(q: FindNodesQuery = {}): Promise<GraphNode[]> {
  const out: GraphNode[] = [];
  for await (const node of streamNodes(q)) {
    out.push(node);
  }
  return out;
}

export async function getNode(id: string): Promise<GraphNode | null> {
  const snap = await db().collection(COLLECTIONS.nodes).doc(id).get();
  return snap.exists ? (snap.data() as GraphNode) : null;
}

export async function findAttractionsByGooglePlaceId(
  googlePlaceId: string,
): Promise<GraphNode[]> {
  const placeId = googlePlaceId.trim();
  if (!placeId) return [];

  const snap = await db()
    .collection(COLLECTIONS.nodes)
    .where("metadata.google_place_id", "==", placeId)
    .limit(25)
    .get();

  return snap.docs
    .map((doc) => doc.data() as GraphNode)
    .filter((node) => node.type === "attraction");
}

/** Multi-get over a list of ids. Batches of 10 (Firestore `in` cap). */
export async function getNodes(ids: string[]): Promise<GraphNode[]> {
  if (ids.length === 0) return [];
  const out: GraphNode[] = [];
  for (const ids10 of chunk(ids, 10)) {
    const snap = await db()
      .collection(COLLECTIONS.nodes)
      .where(FieldPath.documentId(), "in", ids10)
      .get();
    for (const doc of snap.docs) out.push(doc.data() as GraphNode);
  }
  return out;
}

export async function upsertNode(node: GraphNode): Promise<void> {
  await db().collection(COLLECTIONS.nodes).doc(node.id).set(node, { merge: true });
}

export async function replaceNode(node: GraphNode): Promise<void> {
  await db()
    .collection(COLLECTIONS.nodes)
    .doc(node.id)
    .set(stripUndefinedDeep(node), { merge: false });
}

export async function upsertNodes(nodes: GraphNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const batchSize = 400; // Firestore cap is 500 writes per batch
  await withFirestoreDiagnostics("upsertNodes", async () => {
    for (const slice of chunk(nodes, batchSize)) {
      const batch = db().batch();
      for (const n of slice) {
        batch.set(db().collection(COLLECTIONS.nodes).doc(n.id), n, { merge: true });
      }
      await batch.commit();
    }
  });
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => entry !== undefined) as T;
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      const cleaned = stripUndefinedDeep(nested);
      if (cleaned !== undefined) {
        out[key] = cleaned;
      }
    }
    return out as T;
  }

  return value;
}
