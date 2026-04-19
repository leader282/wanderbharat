#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";
import { loadDataset } from "./data";
import { resolveRegions } from "./_regions";
import { mapLimit } from "@/lib/utils/concurrency";
import type { GraphEdge } from "@/types/domain";

/**
 * Seed the `edges` collection with the base travel network for one or more
 * regions.
 *
 * Usage:
 *   npx tsx scripts/seedEdges.ts --region rajasthan
 *   npx tsx scripts/seedEdges.ts --regions rajasthan,gujarat,himachal
 *   npx tsx scripts/seedEdges.ts --all
 *   npx tsx scripts/seedEdges.ts --all --use-google --concurrency 8
 *   npx tsx scripts/seedEdges.ts --region rajasthan --dry-run
 *
 * Live Google Routes enrichment is opt-in because (a) it costs money and
 * (b) curated seed data is already good enough for demos. When enabled,
 * calls run in parallel bounded by `--concurrency` (default 8).
 *
 * Datasets without an `edges()` factory are skipped with a warning rather
 * than failing the whole run, so `--all` keeps moving.
 */

async function main() {
  const args = parseArgs();
  const dryRun = Boolean(args["dry-run"]);
  const useGoogle = Boolean(args["use-google"]);
  const concurrency = Math.max(1, Math.min(32, Number(args.concurrency ?? 8)));
  const regions = resolveRegions(args);

  console.log(
    `[seedEdges] regions=${regions.join(",")} dryRun=${dryRun} useGoogle=${useGoogle} concurrency=${concurrency}`,
  );

  let totalEdges = 0;
  for (const region of regions) {
    const dataset = await loadDataset(region);
    if (!dataset.edges) {
      console.warn(
        `[seedEdges] ${region}: dataset does not expose an edges() factory — skipping.`,
      );
      continue;
    }

    let edges = dataset.edges();
    if (useGoogle) {
      edges = await enrichWithGoogle(edges, concurrency);
    }

    console.log(
      `[seedEdges] ${region}: ${edges.length} edge${edges.length === 1 ? "" : "s"}`,
    );
    totalEdges += edges.length;

    if (dryRun) {
      console.log(JSON.stringify(edges, null, 2));
      continue;
    }

    const { upsertEdges } = await import("@/lib/repositories/edgeRepository");
    await upsertEdges(edges);
  }

  if (!dryRun) {
    console.log(
      `[seedEdges] done — upserted ${totalEdges} edges across ${regions.length} region${regions.length === 1 ? "" : "s"}.`,
    );
  }
}

async function enrichWithGoogle(
  edges: GraphEdge[],
  concurrency: number,
): Promise<GraphEdge[]> {
  const { getTravelTime } = await import("@/lib/services/distanceService");
  const { getNodes } = await import("@/lib/repositories/nodeRepository");

  const nodeIds = Array.from(new Set(edges.flatMap((e) => [e.from, e.to])));
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
        const resolvedAt = Date.now();
        return {
          ...e,
          distance_km: Number(leg.distance_km.toFixed(1)),
          travel_time_hours: Number(leg.travel_time_hours.toFixed(2)),
          metadata: {
            ...(e.metadata ?? {}),
            provider: "google_routes",
            resolved_at: resolvedAt,
            ...(leg.encoded_polyline
              ? { encoded_polyline: leg.encoded_polyline }
              : {}),
          },
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
