#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";
import { loadDataset } from "./data";
import { resolveRegions } from "./_regions";
import type { AttractionOpeningHours } from "@/types/domain";

/**
 * Seed the `attraction_hours` collection with deterministic schedule records
 * from one or more region datasets.
 *
 * Usage:
 *   npx tsx scripts/seedAttractionHours.ts --region rajasthan
 *   npx tsx scripts/seedAttractionHours.ts --regions rajasthan,gujarat
 *   npx tsx scripts/seedAttractionHours.ts --all
 *   npx tsx scripts/seedAttractionHours.ts --all --dry-run
 */
async function main() {
  const args = parseArgs();
  const dryRun = Boolean(args["dry-run"]);
  const regions = resolveRegions(args);

  console.log(
    `[seedAttractionHours] regions=${regions.join(",")} dryRun=${dryRun} (${regions.length} dataset${regions.length === 1 ? "" : "s"})`,
  );

  let totalRecords = 0;
  for (const region of regions) {
    const dataset = await loadDataset(region);
    const records = (dataset.attractionHours?.() ?? []).map((record) =>
      normaliseRecord(record, dataset.region),
    );

    if (records.length === 0) {
      console.warn(
        `[seedAttractionHours] ${region}: dataset does not expose attractionHours() - skipping.`,
      );
      continue;
    }

    console.log(
      `[seedAttractionHours] ${region}: ${records.length} record${records.length === 1 ? "" : "s"}`,
    );
    totalRecords += records.length;

    if (dryRun) {
      console.log(JSON.stringify(records.slice(0, 5), null, 2));
      console.log(`...and ${Math.max(0, records.length - 5)} more`);
      continue;
    }

    const { upsertAttractionOpeningHours } = await import(
      "@/lib/repositories/attractionHoursRepository"
    );
    await upsertAttractionOpeningHours(records);
  }

  if (!dryRun) {
    console.log(
      `[seedAttractionHours] done - upserted ${totalRecords} record${totalRecords === 1 ? "" : "s"} across ${regions.length} region${regions.length === 1 ? "" : "s"}.`,
    );
  }
}

function normaliseRecord(
  record: AttractionOpeningHours,
  region: string,
): AttractionOpeningHours {
  const attractionId = record.attraction_id?.trim() || record.id?.trim();
  if (!attractionId) {
    throw new Error(
      "[seedAttractionHours] Every record must include id/attraction_id.",
    );
  }
  return {
    ...record,
    id: attractionId,
    attraction_id: attractionId,
    region: (record.region || region).trim(),
  };
}

main().catch((err) => {
  console.error("[seedAttractionHours] failed:", err);
  process.exit(1);
});
