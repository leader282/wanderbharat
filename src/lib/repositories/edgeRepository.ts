import { FieldPath } from "firebase-admin/firestore";

import type { GraphEdge, TransportMode } from "@/types/domain";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { chunk } from "@/lib/utils/concurrency";

export interface FindEdgesQuery {
  /** Match edges touching any of these regions (`array-contains-any`). */
  regions?: string[];
  /** Restrict to edges whose `from` is in this id set (for incremental loads). */
  fromIds?: string[];
  transport_modes?: TransportMode[];
  /** Hard cap on total results. Unset = fully enumerate. */
  limit?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 500;

function db() {
  return getAdminDb();
}

function baseQuery(q: FindEdgesQuery): FirebaseFirestore.Query {
  let query: FirebaseFirestore.Query = db().collection(COLLECTIONS.edges);

  const regions = q.regions ?? [];
  if (regions.length === 1) {
    query = query.where("regions", "array-contains", regions[0]);
  } else if (regions.length > 1) {
    query = query.where("regions", "array-contains-any", regions.slice(0, 10));
  }

  if (q.transport_modes && q.transport_modes.length > 0) {
    query = query.where("type", "in", q.transport_modes.slice(0, 10));
  }
  if (q.fromIds && q.fromIds.length > 0) {
    query = query.where("from", "in", q.fromIds.slice(0, 10));
  }
  return query;
}

export async function* streamEdges(
  q: FindEdgesQuery = {},
): AsyncGenerator<GraphEdge, void, void> {
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
      yield doc.data() as GraphEdge;
      emitted += 1;
    }

    if (snap.docs.length < pageSize) return;
    last = snap.docs[snap.docs.length - 1];
  }
}

export async function findEdges(q: FindEdgesQuery = {}): Promise<GraphEdge[]> {
  const out: GraphEdge[] = [];
  for await (const edge of streamEdges(q)) {
    out.push(edge);
  }
  return out;
}

export async function getEdge(id: string): Promise<GraphEdge | null> {
  const snap = await db().collection(COLLECTIONS.edges).doc(id).get();
  return snap.exists ? (snap.data() as GraphEdge) : null;
}

/** Multi-get. Batches of 10 (Firestore `in` cap). */
export async function getEdges(ids: string[]): Promise<GraphEdge[]> {
  if (ids.length === 0) return [];
  const out: GraphEdge[] = [];
  for (const ids10 of chunk(ids, 10)) {
    const snap = await db()
      .collection(COLLECTIONS.edges)
      .where(FieldPath.documentId(), "in", ids10)
      .get();
    for (const doc of snap.docs) out.push(doc.data() as GraphEdge);
  }
  return out;
}

export async function upsertEdge(edge: GraphEdge): Promise<void> {
  await db().collection(COLLECTIONS.edges).doc(edge.id).set(edge, { merge: true });
}

export async function upsertEdges(edges: GraphEdge[]): Promise<void> {
  if (edges.length === 0) return;
  const batchSize = 400;
  await withFirestoreDiagnostics("upsertEdges", async () => {
    for (const slice of chunk(edges, batchSize)) {
      const batch = db().batch();
      for (const e of slice) {
        batch.set(db().collection(COLLECTIONS.edges).doc(e.id), e, { merge: true });
      }
      await batch.commit();
    }
  });
}
