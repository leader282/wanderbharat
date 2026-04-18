#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";
import { loadDataset } from "./data";
import { mapLimit } from "@/lib/utils/concurrency";
import type { GraphEdge } from "@/types/domain";

/**
 * Seed the `edges` collection with the base travel network for a region.
 *
 * Usage:
 *   npx tsx scripts/seedEdges.ts --region rajasthan
 *   npx tsx scripts/seedEdges.ts --region rajasthan --use-google
 *   npx tsx scripts/seedEdges.ts --region rajasthan --concurrency 8
 *   npx tsx scripts/seedEdges.ts --region rajasthan --dry-run
 *
 * Live Google Routes enrichment is opt-in because (a) it costs money and
 * (b) curated seed data is already good enough for demos. When enabled,
 * calls run in parallel bounded by `--concurrency` (default 8).
 */

async function main() {
  const args = parseArgs();
  const region = String(args.region ?? "rajasthan");
  const dryRun = Boolean(args["dry-run"]);
  const useGoogle = Boolean(args["use-google"]);
  const concurrency = Math.max(
    1,
    Math.min(32, Number(args.concurrency ?? 8)),
  );

  const dataset = await loadDataset(region);
  if (!dataset.edges) {
    throw new Error(
      `Dataset ${region} does not expose an edges() factory. Skipping.`,
    );
  }

  let edges = dataset.edges();
  if (useGoogle) {
    edges = await enrichWithGoogle(edges, concurrency);
  }

  console.log(
    `[seedEdges] region=${region} count=${edges.length} dryRun=${dryRun} useGoogle=${useGoogle} concurrency=${concurrency}`,
  );

  if (dryRun) {
    console.log(JSON.stringify(edges, null, 2));
    return;
  }

  const { upsertEdges } = await import("@/lib/repositories/edgeRepository");
  await upsertEdges(edges);
  console.log(`[seedEdges] upserted ${edges.length} edges.`);
}

async function enrichWithGoogle(
  edges: GraphEdge[],
  concurrency: number,
): Promise<GraphEdge[]> {
  const { getTravelTime } = await import("@/lib/services/distanceService");
  const { getNodes } = await import("@/lib/repositories/nodeRepository");

  const nodeIds = Array.from(
    new Set(edges.flatMap((e) => [e.from, e.to])),
  );
  const nodes = await getNodes(nodeIds);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return await mapLimit(edges, concurrency, async (e) => {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) {
      console.warn(
        `[seedEdges] skipping ${e.id} (missing node — seed nodes first?)`,
      );
      return e;
    }
    try {
      const leg = await getTravelTime({
        origin: from.location,
        destination: to.location,
        mode: e.type,
      });
      if (leg) {
        return {
          ...e,
          distance_km: Number(leg.distance_km.toFixed(1)),
          travel_time_hours: Number(leg.travel_time_hours.toFixed(2)),
        };
      }
    } catch (err) {
      console.warn(
        `[seedEdges] google lookup failed for ${e.id}:`,
        (err as Error).message,
      );
    }
    return e;
  });
}

main().catch((err) => {
  console.error("[seedEdges] failed:", err);
  process.exit(1);
});
