import type { HotelOfferSnapshot } from "@/lib/providers/hotels/types";
import type { Query } from "firebase-admin/firestore";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

export async function saveHotelOfferSnapshot(
  snapshot: HotelOfferSnapshot,
): Promise<HotelOfferSnapshot> {
  const normalised = normaliseHotelOfferSnapshot(snapshot);
  await withFirestoreDiagnostics("saveHotelOfferSnapshot", async () => {
    await db()
      .collection(COLLECTIONS.hotel_offer_snapshots)
      .doc(normalised.id)
      .set(stripUndefinedDeep(normalised), { merge: true });
  });
  return normalised;
}

export async function getHotelOfferSnapshot(
  id: string,
): Promise<HotelOfferSnapshot | null> {
  const snapshotId = normaliseString(id);
  if (!snapshotId) return null;

  const snap = await db()
    .collection(COLLECTIONS.hotel_offer_snapshots)
    .doc(snapshotId)
    .get();
  if (!snap.exists) return null;
  return normaliseHotelOfferSnapshot({
    id: snap.id,
    ...(snap.data() as Partial<HotelOfferSnapshot>),
  });
}

export async function findLatestHotelOfferSnapshotByCacheKey(
  cacheKey: string,
): Promise<HotelOfferSnapshot | null> {
  const key = normaliseString(cacheKey);
  if (!key) return null;

  const snap = await db()
    .collection(COLLECTIONS.hotel_offer_snapshots)
    .where("cache_key", "==", key)
    .get();
  const list = snap.docs
    .map((doc) =>
      normaliseHotelOfferSnapshot({
        id: doc.id,
        ...(doc.data() as Partial<HotelOfferSnapshot>),
      }),
    )
    .sort((left, right) => right.fetched_at - left.fetched_at);

  return list[0] ?? null;
}

export async function listHotelOfferSnapshots(args: {
  region?: string;
  node_id?: string;
  limit?: number;
} = {}): Promise<HotelOfferSnapshot[]> {
  let query: Query = db().collection(COLLECTIONS.hotel_offer_snapshots);
  if (args.region) query = query.where("region", "==", args.region);
  if (args.node_id) query = query.where("node_id", "==", args.node_id);

  const snap = await query.get();
  const maxLimit = Math.max(1, Math.min(Math.trunc(args.limit ?? 50), 250));
  return snap.docs
    .map((doc) =>
      normaliseHotelOfferSnapshot({
        id: doc.id,
        ...(doc.data() as Partial<HotelOfferSnapshot>),
      }),
    )
    .sort((left, right) => right.fetched_at - left.fetched_at)
    .slice(0, maxLimit);
}

function db() {
  return getAdminDb();
}

function normaliseHotelOfferSnapshot(
  raw: Partial<HotelOfferSnapshot> & { id: string },
): HotelOfferSnapshot {
  const offers = Array.isArray(raw.offers) ? raw.offers : [];
  const status =
    raw.status === "success" || raw.status === "empty" || raw.status === "error"
      ? raw.status
      : offers.length > 0
        ? "success"
        : "empty";
  return {
    id: raw.id,
    cache_key: normaliseString(raw.cache_key) ?? "",
    provider: "liteapi",
    region: normaliseString(raw.region) ?? "",
    node_id: normaliseString(raw.node_id) ?? "",
    hotel_ids: Array.isArray(raw.hotel_ids)
      ? raw.hotel_ids
          .map((hotelId) => normaliseString(hotelId))
          .filter((hotelId): hotelId is string => Boolean(hotelId))
      : [],
    checkin: normaliseString(raw.checkin) ?? "",
    checkout: normaliseString(raw.checkout) ?? "",
    nights: Math.max(1, Math.round(normaliseFiniteNumber(raw.nights) ?? 1)),
    currency: normaliseString(raw.currency)?.toUpperCase() ?? "INR",
    guest_nationality:
      normaliseString(raw.guest_nationality)?.toUpperCase() ?? "IN",
    occupancies: Array.isArray(raw.occupancies) ? raw.occupancies : [],
    offers,
    min_total_amount: normaliseNullableAmount(raw.min_total_amount),
    min_nightly_amount: normaliseNullableAmount(raw.min_nightly_amount),
    result_count: Math.max(
      0,
      Math.round(
        normaliseFiniteNumber(raw.result_count) ?? offers.length,
      ),
    ),
    status,
    fetched_at: Math.max(0, Math.round(normaliseFiniteNumber(raw.fetched_at) ?? 0)),
    expires_at: Math.max(0, Math.round(normaliseFiniteNumber(raw.expires_at) ?? 0)),
    error_code: normaliseNullableString(raw.error_code),
    error_message: normaliseNullableString(raw.error_message),
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

function normaliseNullableAmount(value: unknown): number | null {
  const amount = normaliseFiniteNumber(value);
  if (amount === null) return null;
  return Math.max(0, amount);
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
