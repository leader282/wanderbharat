import { FieldPath } from "firebase-admin/firestore";

import type { Accommodation, AccommodationCategory } from "@/types/domain";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { chunk } from "@/lib/utils/concurrency";

export interface AccommodationFilterQuery {
  accommodations?: Accommodation[];
  regionId?: string;
  nodeId?: string;
  activeOnly?: boolean;
  allowedCategories?: AccommodationCategory[];
  maxPricePerNight?: number;
  minRating?: number;
}

function db() {
  return getAdminDb();
}

export async function getByRegion(regionId: string): Promise<Accommodation[]> {
  const snap = await db()
    .collection(COLLECTIONS.accommodations)
    .where("regionId", "==", regionId)
    .get();
  return sortAccommodations(
    snap.docs.map((doc) => doc.data() as Accommodation),
  );
}

export async function getByNode(nodeId: string): Promise<Accommodation[]> {
  const snap = await db()
    .collection(COLLECTIONS.accommodations)
    .where("nodeId", "==", nodeId)
    .get();
  return sortAccommodations(
    snap.docs.map((doc) => doc.data() as Accommodation),
  );
}

export async function getAccommodation(
  id: string,
): Promise<Accommodation | null> {
  const snap = await db().collection(COLLECTIONS.accommodations).doc(id).get();
  return snap.exists ? (snap.data() as Accommodation) : null;
}

export async function getAccommodations(
  ids: string[],
): Promise<Accommodation[]> {
  if (ids.length === 0) return [];

  const out: Accommodation[] = [];
  for (const ids10 of chunk(ids, 10)) {
    const snap = await db()
      .collection(COLLECTIONS.accommodations)
      .where(FieldPath.documentId(), "in", ids10)
      .get();
    for (const doc of snap.docs) {
      out.push(doc.data() as Accommodation);
    }
  }

  return sortAccommodations(out);
}

export async function filterByConstraints(
  query: AccommodationFilterQuery,
): Promise<Accommodation[]> {
  const source = query.accommodations
    ? [...query.accommodations]
    : query.nodeId
      ? await getByNode(query.nodeId)
      : query.regionId
        ? await getByRegion(query.regionId)
        : [];

  const allowedCategories = query.allowedCategories
    ? new Set(query.allowedCategories)
    : null;

  return sortAccommodations(
    source.filter((accommodation) => {
      if (query.regionId && accommodation.regionId !== query.regionId) {
        return false;
      }
      if (query.nodeId && accommodation.nodeId !== query.nodeId) {
        return false;
      }
      if (query.activeOnly && !accommodation.active) {
        return false;
      }
      if (
        allowedCategories &&
        !allowedCategories.has(accommodation.category)
      ) {
        return false;
      }
      if (
        query.maxPricePerNight !== undefined &&
        accommodation.pricePerNight > query.maxPricePerNight
      ) {
        return false;
      }
      if (
        query.minRating !== undefined &&
        accommodation.rating < query.minRating
      ) {
        return false;
      }
      return true;
    }),
  );
}

export async function upsertAccommodation(
  accommodation: Accommodation,
): Promise<void> {
  await db()
    .collection(COLLECTIONS.accommodations)
    .doc(accommodation.id)
    .set(stripUndefinedDeep(accommodation), { merge: true });
}

export async function upsertAccommodations(
  accommodations: Accommodation[],
): Promise<void> {
  if (accommodations.length === 0) return;

  const batchSize = 400;
  await withFirestoreDiagnostics("upsertAccommodations", async () => {
    for (const slice of chunk(accommodations, batchSize)) {
      const batch = db().batch();
      for (const accommodation of slice) {
        batch.set(
          db().collection(COLLECTIONS.accommodations).doc(accommodation.id),
          stripUndefinedDeep(accommodation),
          { merge: true },
        );
      }
      await batch.commit();
    }
  });
}

function sortAccommodations(
  accommodations: Accommodation[],
): Accommodation[] {
  return [...accommodations].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      const cleaned = stripUndefinedDeep(nested);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out as T;
  }

  return value;
}
