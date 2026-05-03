#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";
import {
  buildPurgeCollections,
  buildRegionQueryFilter,
  describePreservedData,
  resolvePurgeOptions,
  supportsRegionScope,
  verifyProjectConfirmation,
  type PurgeCollectionSpec,
  type PurgeOptions,
  type RegionQueryFilter,
} from "@/lib/admin/purgePlan";

/**
 * Wipe prototype data from Firestore so v2 reseeding can run cleanly.
 *
 * Usage:
 *   npx tsx scripts/purge.ts --dry-run
 *   npx tsx scripts/purge.ts --regions=rajasthan --dry-run
 *   npx tsx scripts/purge.ts --regions=rajasthan --yes --confirm-project=<projectId>
 *   npx tsx scripts/purge.ts --all-regions --include-itineraries --yes --confirm-project=<projectId>
 *
 * Safe defaults:
 *   - users / itineraries / data_quality_issues are preserved by default
 *   - admin role assignments live in `users` and stay intact
 *   - destructive runs require --yes, an explicit scope, and --confirm-project
 *   - --dry-run and --yes cannot be combined
 */

interface CrossRegionRisk {
  edgeCount: number;
  edgeSamples: string[];
  itineraryCount: number;
  itinerarySamples: string[];
  itineraryScanCapped: boolean;
}

interface CollectionExecutionPlan {
  spec: PurgeCollectionSpec;
  status: "ready" | "missing" | "skipped";
  reason?: string;
  filter: RegionQueryFilter | null;
  estimatedDocs: number;
}

const ITINERARY_SCAN_CAP = 2_000;
const PAGE_SIZE = 400;

async function main() {
  const args = parseArgs();
  const options = resolvePurgeOptions(args);
  const collections = buildPurgeCollections(options);
  const preserved = describePreservedData(options);

  const projectId = resolveProjectIdFromEnv();
  const databaseId = resolveDatabaseIdFromEnv();

  const projectCheck = verifyProjectConfirmation(options, projectId);
  if (!projectCheck.ok) {
    console.error(`[purge] ${projectCheck.reason}`);
    process.exit(2);
  }

  const { getAdminDb, withFirestoreDiagnostics } = await import(
    "@/lib/firebase/admin"
  );

  const db = getAdminDb();

  await withFirestoreDiagnostics("purge", async () => {
    const existingCollections = new Set(
      (await db.listCollections()).map((collection) => collection.id),
    );

    const executionPlan = await buildExecutionPlan(
      db,
      collections,
      existingCollections,
      options,
    );

    const willPurgeNodes = executionPlan.some(
      (entry) => entry.spec.name === "nodes" && entry.status === "ready",
    );
    const willPurgeEdges = executionPlan.some(
      (entry) => entry.spec.name === "edges" && entry.status === "ready",
    );
    const willPurgeItineraries = executionPlan.some(
      (entry) => entry.spec.name === "itineraries" && entry.status === "ready",
    );

    const crossRegionRisk = await analyzeCrossRegionRisk(
      db,
      options,
      existingCollections,
      { willPurgeNodes, willPurgeEdges, willPurgeItineraries },
    );

    printPrePurgeSummary({
      executionPlan,
      options,
      preserved,
      projectId,
      databaseId,
      crossRegionRisk,
      willPurgeNodes,
      willPurgeItineraries,
    });

    if (options.dryRun) {
      console.log("[purge] dry-run complete — no documents were deleted.");
      console.log(
        "[purge] re-run with --yes --confirm-project=" +
          (projectId ?? "<projectId>") +
          " to execute.",
      );
      return;
    }

    if (!options.confirmed) {
      console.error(
        "[purge] refusing destructive delete without --yes. Re-run with --dry-run to preview safely.",
      );
      console.error(
        "[purge] when ready, pass --yes plus --confirm-project=<projectId> after reviewing the summary above.",
      );
      process.exit(2);
    }

    const readyCollections = executionPlan.filter(
      (entry): entry is CollectionExecutionPlan & { status: "ready" } =>
        entry.status === "ready",
    );
    const estimatedTotal = readyCollections.reduce(
      (sum, entry) => sum + entry.estimatedDocs,
      0,
    );

    console.error("[purge] !!! DESTRUCTIVE MODE ENABLED !!!");
    console.error(
      `[purge] target project="${projectId ?? "<unset>"}" database="${databaseId ?? "(default)"}"`,
    );
    console.error(
      "[purge] This operation permanently deletes Firestore documents and cannot be undone.",
    );
    if (options.includeUsers) {
      console.error(
        "[purge] !!! users collection is included — admin role assignments will also be deleted.",
      );
    }
    if (options.includeItineraries) {
      console.error(
        "[purge] !!! itineraries are included — generated trip history will be deleted.",
      );
    }
    if (options.includeDataQualityIssues) {
      console.error(
        "[purge] !!! data_quality_issues collection is included — admin investigation state will be deleted.",
      );
    }

    if (estimatedTotal === 0) {
      console.log(
        "[purge] no matching documents found for the selected scope — nothing to delete.",
      );
      return;
    }

    const deletedTotals: Record<string, number> = {};
    for (const entry of readyCollections) {
      const filterLabel = formatFilterLabel(entry.filter);
      console.log(`[purge] deleting ${entry.spec.name}${filterLabel}...`);
      const deleted = await deleteMatchingDocs(db, entry.spec.name, entry.filter);
      deletedTotals[entry.spec.name] = deleted;
      console.log(`[purge] ${entry.spec.name}: deleted ${deleted} docs`);
    }

    console.log("[purge] done.");
    console.log(
      JSON.stringify(
        {
          project: projectId,
          database: databaseId,
          estimated_total: estimatedTotal,
          deleted: deletedTotals,
        },
        null,
        2,
      ),
    );
  });
}

async function buildExecutionPlan(
  db: FirebaseFirestore.Firestore,
  collections: PurgeCollectionSpec[],
  existingCollections: Set<string>,
  options: Pick<PurgeOptions, "regionSlugs">,
): Promise<CollectionExecutionPlan[]> {
  const plan: CollectionExecutionPlan[] = [];

  for (const spec of collections) {
    if (!existingCollections.has(spec.name)) {
      plan.push({
        spec,
        status: "missing",
        reason: spec.optional
          ? "collection not found (optional)"
          : "collection not found",
        filter: null,
        estimatedDocs: 0,
      });
      continue;
    }

    if (options.regionSlugs.length > 0 && !supportsRegionScope(spec)) {
      plan.push({
        spec,
        status: "skipped",
        reason:
          "region filtering is not supported for this collection; left untouched",
        filter: null,
        estimatedDocs: 0,
      });
      continue;
    }

    const filter = buildRegionQueryFilter(spec, options.regionSlugs);
    const estimatedDocs = await estimateMatchingDocs(db, spec.name, filter);
    plan.push({
      spec,
      status: "ready",
      filter,
      estimatedDocs,
    });
  }

  return plan;
}

async function analyzeCrossRegionRisk(
  db: FirebaseFirestore.Firestore,
  options: PurgeOptions,
  existingCollections: Set<string>,
  flags: {
    willPurgeNodes: boolean;
    willPurgeEdges: boolean;
    willPurgeItineraries: boolean;
  },
): Promise<CrossRegionRisk> {
  const empty: CrossRegionRisk = {
    edgeCount: 0,
    edgeSamples: [],
    itineraryCount: 0,
    itinerarySamples: [],
    itineraryScanCapped: false,
  };

  if (options.regionSlugs.length === 0) {
    return empty;
  }

  const edgeRisk = flags.willPurgeEdges
    ? await detectCrossRegionEdges(db, options.regionSlugs)
    : { count: 0, samples: [] };

  const itineraryRisk =
    flags.willPurgeNodes && existingCollections.has("itineraries")
      ? await detectCrossRegionItineraries(db, options.regionSlugs, flags.willPurgeItineraries)
      : { count: 0, samples: [], scanCapped: false };

  return {
    edgeCount: edgeRisk.count,
    edgeSamples: edgeRisk.samples,
    itineraryCount: itineraryRisk.count,
    itinerarySamples: itineraryRisk.samples,
    itineraryScanCapped: itineraryRisk.scanCapped,
  };
}

async function detectCrossRegionEdges(
  db: FirebaseFirestore.Firestore,
  regionSlugs: string[],
): Promise<{ count: number; samples: string[] }> {
  const seen = new Set<string>();
  const samples: string[] = [];

  for (const region of regionSlugs) {
    const snap = await db
      .collection("edges")
      .where("regions", "array-contains", region)
      .get();
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      const regions = doc.get("regions");
      if (Array.isArray(regions) && regions.length > 1) {
        seen.add(doc.id);
        if (samples.length < 5) samples.push(doc.id);
      }
    }
  }

  return { count: seen.size, samples };
}

async function detectCrossRegionItineraries(
  db: FirebaseFirestore.Firestore,
  regionSlugs: string[],
  willPurgeItineraries: boolean,
): Promise<{ count: number; samples: string[]; scanCapped: boolean }> {
  const purgedNodeIds = new Set<string>();
  for (const region of regionSlugs) {
    const snap = await db
      .collection("nodes")
      .where("region", "==", region)
      .select()
      .get();
    for (const doc of snap.docs) purgedNodeIds.add(doc.id);
  }

  if (purgedNodeIds.size === 0) {
    return { count: 0, samples: [], scanCapped: false };
  }

  const itinerarySnap = await db
    .collection("itineraries")
    .limit(ITINERARY_SCAN_CAP)
    .get();

  const purgedRegionSet = new Set(regionSlugs);
  const samples: string[] = [];
  let count = 0;

  for (const doc of itinerarySnap.docs) {
    const data = doc.data();
    const itineraryRegion = typeof data.region === "string" ? data.region : "";

    // If we're already deleting itineraries in the purged region, those don't
    // count as "cross-region risk". Only flag itineraries that survive the
    // purge but reference soon-to-be-deleted nodes.
    if (willPurgeItineraries && purgedRegionSet.has(itineraryRegion)) {
      continue;
    }

    const nodes = data.nodes;
    if (!Array.isArray(nodes)) continue;

    const overlaps = nodes.some(
      (entry: unknown) => typeof entry === "string" && purgedNodeIds.has(entry),
    );
    if (overlaps) {
      count += 1;
      if (samples.length < 5) samples.push(doc.id);
    }
  }

  return {
    count,
    samples,
    scanCapped: itinerarySnap.size === ITINERARY_SCAN_CAP,
  };
}

function printPrePurgeSummary(input: {
  executionPlan: CollectionExecutionPlan[];
  options: PurgeOptions;
  preserved: string[];
  projectId: string | null;
  databaseId: string | null;
  crossRegionRisk: CrossRegionRisk;
  willPurgeNodes: boolean;
  willPurgeItineraries: boolean;
}): void {
  const {
    executionPlan,
    options,
    preserved,
    projectId,
    databaseId,
    crossRegionRisk,
    willPurgeNodes,
    willPurgeItineraries,
  } = input;

  console.log("[purge] ================= PRE-PURGE SUMMARY =================");
  console.log(
    `[purge] project="${projectId ?? "<unset>"}" database="${databaseId ?? "(default)"}"`,
  );
  console.log(
    `[purge] mode: ${
      options.dryRun
        ? "DRY RUN (safe preview only)"
        : options.confirmed
          ? "DESTRUCTIVE (--yes confirmed)"
          : "PREVIEW (no --dry-run, no --yes — would refuse to delete)"
    }`,
  );
  console.log(
    `[purge] region scope: ${
      options.regionSlugs.length > 0
        ? options.regionSlugs.join(", ")
        : options.allRegions
          ? "all regions (--all-regions)"
          : "all regions (no scope filter)"
    }`,
  );
  console.log("[purge] collections:");

  for (const entry of executionPlan) {
    if (entry.status === "ready") {
      console.log(
        `  - ${entry.spec.name}${formatFilterLabel(entry.filter)} | estimated docs: ${entry.estimatedDocs}`,
      );
      continue;
    }

    console.log(`  - ${entry.spec.name} | skip: ${entry.reason}`);
  }

  const estimatedTotal = executionPlan
    .filter((entry): entry is CollectionExecutionPlan & { status: "ready" } =>
      entry.status === "ready",
    )
    .reduce((sum, entry) => sum + entry.estimatedDocs, 0);

  console.log(`[purge] estimated total docs affected: ${estimatedTotal}`);

  console.log("[purge] preserved by default:");
  if (preserved.length === 0) {
    console.log("  - (nothing — every opt-in flag was passed)");
  } else {
    for (const item of preserved) {
      console.log(`  - ${item}`);
    }
  }

  if (
    crossRegionRisk.edgeCount > 0 ||
    crossRegionRisk.itineraryCount > 0
  ) {
    console.log("[purge] cross-region risk:");

    if (crossRegionRisk.edgeCount > 0) {
      console.log(
        `  - ${crossRegionRisk.edgeCount} edge(s) span multiple regions and will be removed even though only some endpoints are in the purged region(s).`,
      );
      if (crossRegionRisk.edgeSamples.length > 0) {
        console.log(
          `    sample ids: ${crossRegionRisk.edgeSamples.join(", ")}`,
        );
      }
    }

    if (crossRegionRisk.itineraryCount > 0) {
      const scopeQualifier = willPurgeItineraries
        ? "outside the purged region(s) "
        : "";
      console.log(
        `  - ${crossRegionRisk.itineraryCount} itinerary(ies) ${scopeQualifier}reference soon-to-be-deleted nodes and would render broken.`,
      );
      if (crossRegionRisk.itinerarySamples.length > 0) {
        console.log(
          `    sample ids: ${crossRegionRisk.itinerarySamples.join(", ")}`,
        );
      }
      if (crossRegionRisk.itineraryScanCapped) {
        console.log(
          `    (itinerary scan was capped at ${ITINERARY_SCAN_CAP} docs — true count may be higher)`,
        );
      }
      if (!willPurgeItineraries) {
        console.log(
          "    consider re-running with --include-itineraries to clean these up too.",
        );
      }
    }
  }

  if (
    willPurgeNodes &&
    !willPurgeItineraries &&
    options.regionSlugs.length === 0
  ) {
    console.log(
      "[purge] WARNING: nodes will be deleted while itineraries are preserved. Existing saved trips may reference deleted nodes and render broken.",
    );
  }

  console.log("[purge] ======================================================");
}

function formatFilterLabel(filter: RegionQueryFilter | null): string {
  if (!filter) return "";
  if (Array.isArray(filter.value)) {
    return ` (filter: ${filter.field} ${filter.op} [${filter.value.join(", ")}])`;
  }
  return ` (filter: ${filter.field} ${filter.op} ${filter.value})`;
}

async function estimateMatchingDocs(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  filter: RegionQueryFilter | null,
): Promise<number> {
  const filtered = applyRegionFilter(db.collection(collectionName), filter);

  try {
    const aggregate = await filtered.count().get();
    return Number(aggregate.data().count ?? 0);
  } catch {
    return countByPaging(filtered);
  }
}

async function countByPaging(query: FirebaseFirestore.Query): Promise<number> {
  let total = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (true) {
    let pageQuery = query.orderBy("__name__").limit(PAGE_SIZE);
    if (last) pageQuery = pageQuery.startAfter(last);

    const snap = await pageQuery.get();
    if (snap.empty) break;

    total += snap.docs.length;
    if (snap.docs.length < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }

  return total;
}

async function deleteMatchingDocs(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  filter: RegionQueryFilter | null,
): Promise<number> {
  let deleted = 0;

  while (true) {
    const query = applyRegionFilter(db.collection(collectionName), filter)
      .orderBy("__name__")
      .limit(PAGE_SIZE);

    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();

    deleted += snap.docs.length;
    if (snap.docs.length < PAGE_SIZE) break;
  }

  return deleted;
}

function applyRegionFilter(
  query: FirebaseFirestore.Query,
  filter: RegionQueryFilter | null,
): FirebaseFirestore.Query {
  if (!filter) return query;

  switch (filter.op) {
    case "==":
    case "array-contains":
      return query.where(filter.field, filter.op, filter.value as string);
    case "in":
    case "array-contains-any":
      return query.where(filter.field, filter.op, filter.value as string[]);
  }
}

function resolveProjectIdFromEnv(): string | null {
  const value =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  return value && value.trim().length > 0 ? value.trim() : null;
}

function resolveDatabaseIdFromEnv(): string | null {
  const value = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  return value && value.trim().length > 0 ? value.trim() : null;
}

main().catch((err) => {
  console.error("[purge] failed:", err);
  process.exit(1);
});
