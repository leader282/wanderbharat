import type { HotelSearchSnapshot } from "@/lib/providers/hotels/types";
import type { Query } from "firebase-admin/firestore";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

export async function saveHotelSearchSnapshot(
  snapshot: HotelSearchSnapshot,
): Promise<HotelSearchSnapshot> {
  const normalised = normaliseHotelSearchSnapshot(snapshot);
  await withFirestoreDiagnostics("saveHotelSearchSnapshot", async () => {
    await db()
      .collection(COLLECTIONS.hotel_search_snapshots)
      .doc(normalised.id)
      .set(stripUndefinedDeep(normalised), { merge: true });
  });
  return normalised;
}

export async function getHotelSearchSnapshot(
  id: string,
): Promise<HotelSearchSnapshot | null> {
  const snapshotId = normaliseString(id);
  if (!snapshotId) return null;

  const snap = await db()
    .collection(COLLECTIONS.hotel_search_snapshots)
    .doc(snapshotId)
    .get();
  if (!snap.exists) return null;
  return normaliseHotelSearchSnapshot({
    id: snap.id,
    ...(snap.data() as Partial<HotelSearchSnapshot>),
  });
}

export async function listHotelSearchSnapshots(args: {
  region?: string;
  node_id?: string;
  limit?: number;
} = {}): Promise<HotelSearchSnapshot[]> {
  let query: Query = db().collection(COLLECTIONS.hotel_search_snapshots);
  if (args.region) query = query.where("region", "==", args.region);
  if (args.node_id) query = query.where("node_id", "==", args.node_id);

  const snap = await query.get();
  const maxLimit = Math.max(1, Math.min(Math.trunc(args.limit ?? 50), 200));
  return snap.docs
    .map((doc) =>
      normaliseHotelSearchSnapshot({
        id: doc.id,
        ...(doc.data() as Partial<HotelSearchSnapshot>),
      }),
    )
    .sort((left, right) => right.fetched_at - left.fetched_at)
    .slice(0, maxLimit);
}

function db() {
  return getAdminDb();
}

function normaliseHotelSearchSnapshot(
  raw: Partial<HotelSearchSnapshot> & { id: string },
): HotelSearchSnapshot {
  const results = Array.isArray(raw.results) ? raw.results : [];
  return {
    id: raw.id,
    provider: "liteapi",
    region: normaliseString(raw.region) ?? "",
    node_id: normaliseString(raw.node_id) ?? "",
    city_name: normaliseNullableString(raw.city_name),
    country_code: normaliseNullableString(raw.country_code)?.toUpperCase() ?? null,
    anchor: normaliseCoordinates(raw.anchor),
    radius_km: normaliseNullableNumber(raw.radius_km),
    query_key: normaliseString(raw.query_key) ?? "",
    result_count: Math.max(
      0,
      Math.round(
        normaliseFiniteNumber(raw.result_count) ?? results.length,
      ),
    ),
    results,
    fetched_at: Math.max(0, Math.round(normaliseFiniteNumber(raw.fetched_at) ?? 0)),
    expires_at: Math.max(0, Math.round(normaliseFiniteNumber(raw.expires_at) ?? 0)),
  };
}

function normaliseFiniteNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normaliseString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseNullableString(value: unknown): string | null {
  return normaliseString(value);
}

function normaliseNullableNumber(value: unknown): number | null {
  const parsed = normaliseFiniteNumber(value);
  return parsed === null ? null : Math.max(0, parsed);
}

function normaliseCoordinates(value: unknown): HotelSearchSnapshot["anchor"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const lat = normaliseFiniteNumber(record.lat);
  const lng = normaliseFiniteNumber(record.lng);
  if (lat === null || lng === null) return null;
  return { lat, lng };
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
