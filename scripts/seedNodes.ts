#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";
import { loadDataset } from "./data";
import { resolveRegions } from "./_regions";

/**
 * Seed the `nodes` collection with city-level data for one or more regions.
 *
 * Usage:
 *   npx tsx scripts/seedNodes.ts --region rajasthan
 *   npx tsx scripts/seedNodes.ts --regions rajasthan,gujarat,himachal
 *   npx tsx scripts/seedNodes.ts --all
 *   npx tsx scripts/seedNodes.ts --all --dry-run
 *
 * The script is region-agnostic: create `scripts/data/<slug>.ts` that
 * default-exports a `SeedDataset` (see scripts/data/index.ts) and the
 * script picks it up automatically (including via `--all`).
 */

async function main() {
  const args = parseArgs();
  const dryRun = Boolean(args["dry-run"]);
  const regions = resolveRegions(args);

  console.log(
    `[seedNodes] regions=${regions.join(",")} dryRun=${dryRun} (${regions.length} dataset${regions.length === 1 ? "" : "s"})`,
  );

  let totalNodes = 0;
  for (const region of regions) {
    const dataset = await loadDataset(region);
    const nodes = dataset.cities();
    console.log(
      `[seedNodes] ${region}: ${nodes.length} city node${nodes.length === 1 ? "" : "s"}`,
    );
    totalNodes += nodes.length;

    if (dryRun) {
      console.log(JSON.stringify(nodes, null, 2));
      continue;
    }

    const { upsertNodes } = await import("@/lib/repositories/nodeRepository");
    const { upsertRegionSummary } = await import(
      "@/lib/repositories/regionRepository"
    );

    await upsertNodes(nodes);

    const bbox = computeBbox(nodes);
    await upsertRegionSummary({
      region: dataset.region,
      country: dataset.country,
      count: nodes.length,
      bbox,
      ...(dataset.summary ?? {}),
    });
  }

  if (!dryRun) {
    console.log(
      `[seedNodes] done — upserted ${totalNodes} city nodes across ${regions.length} region${regions.length === 1 ? "" : "s"}.`,
    );
  }
}

function computeBbox(
  nodes: Array<{ location: { lat: number; lng: number } }>,
) {
  if (nodes.length === 0) return undefined;
  let min_lat = nodes[0].location.lat;
  let max_lat = nodes[0].location.lat;
  let min_lng = nodes[0].location.lng;
  let max_lng = nodes[0].location.lng;
  for (const n of nodes) {
    min_lat = Math.min(min_lat, n.location.lat);
    max_lat = Math.max(max_lat, n.location.lat);
    min_lng = Math.min(min_lng, n.location.lng);
    max_lng = Math.max(max_lng, n.location.lng);
  }
  return { min_lat, min_lng, max_lat, max_lng };
}

main().catch((err) => {
  console.error("[seedNodes] failed:", err);
  process.exit(1);
});
