import type { RegionSummary, TransportMode } from "@/types/domain";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

/**
 * A region repository that prefers a denormalised `regions` collection
 * (cheap single query, one doc per region) and falls back to a scan of
 * `nodes` when the collection is empty — which it will be for fresh
 * installs.
 *
 * Denormalised doc shape:
 * ```
 * regions/<slug> {
 *   region: "rajasthan",
 *   country: "india",
 *   count: 10,
 *   default_currency: "INR",
 *   default_locale: "en-IN",
 *   default_transport_modes: ["road", "train"],
 *   bbox: { min_lat, min_lng, max_lat, max_lng },
 *   updated_at: <ms>
 * }
 * ```
 */

function db() {
  return getAdminDb();
}

export async function listRegions(): Promise<RegionSummary[]> {
  return withFirestoreDiagnostics("listRegions", async () => {
    const fromDenorm = await readDenormalisedRegions();
    const all = fromDenorm.length > 0 ? fromDenorm : await scanRegionsFromNodes();
    return applyRegionAllowlist(all);
  });
}

/**
 * Optional deployment-level allowlist controlling which regions are
 * exposed to the public plan form. Comma-separated slug list, e.g.
 * `WB_ALLOWED_REGIONS=rajasthan` for a Rajasthan-only demo.
 *
 * Unset/empty → every region in Firestore is returned (current behaviour).
 * Admin tooling, seed scripts, and the data-quality scanner do not use this
 * helper, so they continue to see every region.
 */
function applyRegionAllowlist(regions: RegionSummary[]): RegionSummary[] {
  const raw = process.env.WB_ALLOWED_REGIONS?.trim();
  if (!raw) return regions;
  const allowed = new Set(
    raw
      .split(",")
      .map((slug) => slug.trim().toLowerCase())
      .filter((slug) => slug.length > 0),
  );
  if (allowed.size === 0) return regions;
  return regions.filter((r) => allowed.has(r.region.toLowerCase()));
}

async function readDenormalisedRegions(): Promise<RegionSummary[]> {
  const snap = await db()
    .collection(COLLECTIONS.regions)
    .orderBy("region")
    .limit(500)
    .get();
  if (snap.empty) return [];
  return snap.docs.map((d) => d.data() as RegionSummary);
}

async function scanRegionsFromNodes(): Promise<RegionSummary[]> {
  const snap = await db()
    .collection(COLLECTIONS.nodes)
    .where("type", "==", "city")
    .select("region", "country", "location")
    .get();

  type Accum = RegionSummary & {
    min_lat: number;
    min_lng: number;
    max_lat: number;
    max_lng: number;
  };
  const seen = new Map<string, Accum>();

  for (const doc of snap.docs) {
    const data = doc.data() as {
      region?: string;
      country?: string;
      location?: { lat?: number; lng?: number };
    };
    if (!data.region) continue;
    const key = `${data.country ?? ""}::${data.region}`;
    const current = seen.get(key);
    const lat = data.location?.lat;
    const lng = data.location?.lng;

    if (current) {
      current.count += 1;
      if (typeof lat === "number" && typeof lng === "number") {
        current.min_lat = Math.min(current.min_lat, lat);
        current.max_lat = Math.max(current.max_lat, lat);
        current.min_lng = Math.min(current.min_lng, lng);
        current.max_lng = Math.max(current.max_lng, lng);
      }
    } else {
      seen.set(key, {
        region: data.region,
        country: data.country ?? "",
        count: 1,
        min_lat: lat ?? 90,
        max_lat: lat ?? -90,
        min_lng: lng ?? 180,
        max_lng: lng ?? -180,
      });
    }
  }

  return Array.from(seen.values())
    .map(({ min_lat, min_lng, max_lat, max_lng, ...rest }) => ({
      ...rest,
      bbox:
        max_lat >= min_lat && max_lng >= min_lng
          ? { min_lat, min_lng, max_lat, max_lng }
          : undefined,
    }))
    .sort((a, b) => a.region.localeCompare(b.region));
}

/**
 * Upsert a single region summary into the denormalised collection.
 * Seeders should call this after writing nodes to keep the index fresh.
 */
export async function upsertRegionSummary(
  summary: RegionSummary & { updated_at?: number },
): Promise<void> {
  await db()
    .collection(COLLECTIONS.regions)
    .doc(summary.region)
    .set(
      {
        ...summary,
        updated_at: summary.updated_at ?? Date.now(),
      },
      { merge: true },
    );
}

/** Fetch a single region's config; used by the plan form / API. */
export async function getRegionSummary(
  slug: string,
): Promise<RegionSummary | null> {
  const snap = await db().collection(COLLECTIONS.regions).doc(slug).get();
  if (snap.exists) return snap.data() as RegionSummary;
  // Fallback: derive a minimal summary from the scan path.
  const all = await scanRegionsFromNodes();
  return all.find((r) => r.region === slug) ?? null;
}

/** Helper for callers that just want the default transport modes. */
export async function getDefaultTransportModes(
  slug: string,
): Promise<TransportMode[]> {
  const summary = await getRegionSummary(slug);
  return summary?.default_transport_modes ?? ["road"];
}
