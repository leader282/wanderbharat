#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";
import { loadDataset } from "./data";

/**
 * Seed the `nodes` collection with city-level data for a region.
 *
 * Usage:
 *   npx tsx scripts/seedNodes.ts --region rajasthan
 *   npx tsx scripts/seedNodes.ts --region rajasthan --dry-run
 *
 * The script is region-agnostic: create `scripts/data/<slug>.ts` that
 * default-exports a `SeedDataset` (see scripts/data/index.ts) and the
 * script will pick it up automatically.
 */

async function main() {
  const args = parseArgs();
  const region = String(args.region ?? "rajasthan");
  const dryRun = Boolean(args["dry-run"]);

  const dataset = await loadDataset(region);
  const nodes = dataset.cities();
  console.log(
    `[seedNodes] region=${region} count=${nodes.length} dryRun=${dryRun}`,
  );

  if (dryRun) {
    console.log(JSON.stringify(nodes, null, 2));
    return;
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

  console.log(
    `[seedNodes] upserted ${nodes.length} city nodes + 1 region summary.`,
  );
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
