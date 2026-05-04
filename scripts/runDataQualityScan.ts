#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";

/**
 * Run the data-quality scanner from the CLI. Useful after a purge + reseed
 * to repopulate `data_quality_issues` deterministically.
 *
 * Usage:
 *   npx tsx scripts/runDataQualityScan.ts
 *   npx tsx scripts/runDataQualityScan.ts --resolved-by="ops:reseed"
 */

async function main() {
  const args = parseArgs();
  const resolvedByArg = args["resolved-by"];
  const resolvedBy =
    typeof resolvedByArg === "string" && resolvedByArg.trim().length > 0
      ? resolvedByArg.trim()
      : "cli:runDataQualityScan";

  const { runDataQualityScan } = await import(
    "@/lib/admin/dataQualityScanner"
  );

  const result = await runDataQualityScan({ resolvedBy });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("[runDataQualityScan] failed:", err);
  process.exit(1);
});
