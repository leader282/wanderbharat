#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";

/**
 * Wipe seed data from Firestore so the seed scripts can run cleanly.
 *
 * Usage:
 *   npx tsx scripts/purge.ts --yes                    # purge ALL seed collections
 *   npx tsx scripts/purge.ts --region rajasthan --yes # purge a single region
 *   npx tsx scripts/purge.ts --dry-run                # count only, no deletes
 *
 * What it touches:
 *   - `nodes`        — cities + attractions
 *   - `edges`        — curated and resolved travel legs
 *   - `regions`      — denormalised region summaries
 *   - `itineraries`  — generated trips (omit with --keep-itineraries)
 *
 * What it never touches:
 *   - `users` — real authenticated user data lives here.
 *
 * Requires `--yes` for any destructive run; safety brake.
 */

type CollectionName = "nodes" | "edges" | "regions" | "itineraries";

async function main() {
  const args = parseArgs();
  const region =
    typeof args.region === "string" ? args.region.trim() : undefined;
  const dryRun = Boolean(args["dry-run"]);
  const confirmed = Boolean(args.yes);
  const keepItineraries = Boolean(args["keep-itineraries"]);

  if (!dryRun && !confirmed) {
    console.error(
      "[purge] refusing to delete without --yes. Re-run with --dry-run to preview, " +
        "or --yes to actually delete.",
    );
    process.exit(2);
  }

  const collections: CollectionName[] = keepItineraries
    ? ["nodes", "edges", "regions"]
    : ["nodes", "edges", "regions", "itineraries"];

  const { getAdminDb, withFirestoreDiagnostics } = await import(
    "@/lib/firebase/admin"
  );

  const db = getAdminDb();
  const totals: Record<string, number> = {};

  await withFirestoreDiagnostics("purge", async () => {
    for (const collection of collections) {
      const filter = regionFilterFor(collection, region);
      const filterLabel = filter
        ? ` (filter: ${filter.field}=${filter.value})`
        : "";
      console.log(
        `[purge] ${collection}${filterLabel} — scanning${dryRun ? " (dry-run)" : ""}…`,
      );

      let total = 0;
      let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      const pageSize = 400;

      while (true) {
        let query: FirebaseFirestore.Query = db.collection(collection);
        if (filter) {
          query =
            filter.op === "=="
              ? query.where(filter.field, "==", filter.value)
              : query.where(filter.field, "array-contains", filter.value);
        }
        query = query.orderBy("__name__").limit(pageSize);
        if (last) query = query.startAfter(last);

        const snap = await query.get();
        if (snap.empty) break;

        if (!dryRun) {
          const batch = db.batch();
          for (const doc of snap.docs) batch.delete(doc.ref);
          await batch.commit();
        }

        total += snap.docs.length;
        if (snap.docs.length < pageSize) break;
        last = snap.docs[snap.docs.length - 1];
      }

      totals[collection] = total;
      console.log(
        `[purge] ${collection}: ${dryRun ? "would delete" : "deleted"} ${total} docs`,
      );
    }
  });

  console.log("[purge] done.");
  console.log(JSON.stringify(totals, null, 2));
}

function regionFilterFor(
  collection: CollectionName,
  region: string | undefined,
):
  | { field: string; op: "=="; value: string }
  | { field: string; op: "array-contains"; value: string }
  | null {
  if (!region) return null;
  switch (collection) {
    case "nodes":
    case "itineraries":
      return { field: "region", op: "==", value: region };
    case "edges":
      return { field: "regions", op: "array-contains", value: region };
    case "regions":
      return { field: "region", op: "==", value: region };
  }
}

main().catch((err) => {
  console.error("[purge] failed:", err);
  process.exit(1);
});
