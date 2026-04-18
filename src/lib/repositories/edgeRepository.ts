import { FieldPath } from "firebase-admin/firestore";

import type { GraphEdge, TransportMode } from "@/types/domain";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { chunk } from "@/lib/utils/concurrency";

export interface FindEdgesQuery {
  /** Restrict edges whose endpoints both belong to the given region. */
  region?: string;
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

/**
 * Normalise legacy documents written with `region: string` to the new
 * `regions: string[]` shape on the way out. Writers always use `regions`.
 */
function normaliseEdge(raw: FirebaseFirestore.DocumentData): GraphEdge {
  const edge = raw as GraphEdge;
  if (!edge.regions || edge.regions.length === 0) {
    const legacy = (raw as { region?: string }).region;
    return { ...edge, regions: legacy ? [legacy] : [] };
  }
  return edge;
}

function baseQuery(q: FindEdgesQuery): FirebaseFirestore.Query {
  let query: FirebaseFirestore.Query = db().collection(COLLECTIONS.edges);

  const regions =
    q.regions && q.regions.length > 0 ? q.regions : q.region ? [q.region] : [];
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
      yield normaliseEdge(doc.data());
      emitted += 1;
    }

    if (snap.docs.length < pageSize) return;
    last = snap.docs[snap.docs.length - 1];
  }
}

export async function findEdges(q: FindEdgesQuery = {}): Promise<GraphEdge[]> {
  const out: GraphEdge[] = [];

  // Also fetch legacy docs that use `region: string` and haven't been
  // re-written yet — only runs when exactly one region is requested.
  const regions =
    q.regions && q.regions.length > 0 ? q.regions : q.region ? [q.region] : [];
  const singleRegion = regions.length === 1 ? regions[0] : undefined;

  for await (const edge of streamEdges(q)) {
    out.push(edge);
  }

  if (singleRegion) {
    const legacy = await db()
      .collection(COLLECTIONS.edges)
      .where("region", "==", singleRegion)
      .limit(q.limit ?? 5000)
      .get();
    const seen = new Set(out.map((edge) => edge.id));
    for (const doc of legacy.docs) {
      const edge = normaliseEdge(doc.data());
      if (!seen.has(edge.id)) out.push(edge);
    }
  }
  return out;
}

export async function getEdge(id: string): Promise<GraphEdge | null> {
  const snap = await db().collection(COLLECTIONS.edges).doc(id).get();
  return snap.exists ? normaliseEdge(snap.data()!) : null;
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
    for (const doc of snap.docs) out.push(normaliseEdge(doc.data()));
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
