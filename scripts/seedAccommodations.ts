#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";
import { resolveRegions } from "./_regions";
import type { Accommodation } from "@/types/domain";

/**
 * Seed the `accommodations` collection with curated, deterministic hotel data
 * for one or more regions.
 *
 * Usage:
 *   npx tsx scripts/seedAccommodations.ts --region rajasthan
 *   npx tsx scripts/seedAccommodations.ts --regions rajasthan,gujarat
 *   npx tsx scripts/seedAccommodations.ts --all
 *   npx tsx scripts/seedAccommodations.ts --all --dry-run
 */

async function main() {
  const args = parseArgs();
  const dryRun = Boolean(args["dry-run"]);
  const regions = resolveRegions(args);

  console.log(
    `[seedAccommodations] regions=${regions.join(",")} dryRun=${dryRun} (${regions.length} dataset${regions.length === 1 ? "" : "s"})`,
  );

  let totalAccommodations = 0;
  for (const region of regions) {
    const accommodations = await loadAccommodations(region);
    console.log(
      `[seedAccommodations] ${region}: ${accommodations.length} accommodation${accommodations.length === 1 ? "" : "s"}`,
    );
    totalAccommodations += accommodations.length;

    if (dryRun) {
      console.log(JSON.stringify(accommodations.slice(0, 5), null, 2));
      console.log(`...and ${Math.max(0, accommodations.length - 5)} more`);
      continue;
    }

    const { upsertAccommodations } = await import(
      "@/lib/repositories/accommodationRepository"
    );
    await upsertAccommodations(accommodations);
  }

  if (!dryRun) {
    console.log(
      `[seedAccommodations] done — upserted ${totalAccommodations} accommodations across ${regions.length} region${regions.length === 1 ? "" : "s"}.`,
    );
  }
}

async function loadAccommodations(region: string): Promise<Accommodation[]> {
  let mod: { default?: Accommodation[] };

  try {
    mod = (await import(`./data/${region}/accommodations.ts`)) as {
      default?: Accommodation[];
    };
  } catch (err) {
    throw new Error(
      `Could not load scripts/data/${region}/accommodations.ts: ${(err as Error).message}`,
    );
  }

  const accommodations = mod.default;
  if (!Array.isArray(accommodations)) {
    throw new Error(
      `scripts/data/${region}/accommodations.ts must default-export an Accommodation[] array.`,
    );
  }

  return accommodations;
}

main().catch((err) => {
  console.error("[seedAccommodations] failed:", err);
  process.exit(1);
});
