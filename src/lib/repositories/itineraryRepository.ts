import type { Itinerary } from "@/types/domain";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

function db() {
  return getAdminDb();
}

export async function saveItinerary(itinerary: Itinerary): Promise<void> {
  await withFirestoreDiagnostics("saveItinerary", async () => {
    await db()
      .collection(COLLECTIONS.itineraries)
      .doc(itinerary.id)
      .set(stripUndefinedDeep(itinerary));
  });
}

export async function getItinerary(id: string): Promise<Itinerary | null> {
  const snap = await db().collection(COLLECTIONS.itineraries).doc(id).get();
  return snap.exists ? (snap.data() as Itinerary) : null;
}

export async function deleteItinerary(id: string): Promise<void> {
  await withFirestoreDiagnostics("deleteItinerary", async () => {
    await db().collection(COLLECTIONS.itineraries).doc(id).delete();
  });
}

export async function listItinerariesForUser(
  userId: string,
  limit = 50,
): Promise<Itinerary[]> {
  const snap = await db()
    .collection(COLLECTIONS.itineraries)
    .where("user_id", "==", userId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as Itinerary);
}

export function stripUndefinedDeep<T>(value: T): T {
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
