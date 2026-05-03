#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";
import { loadDataset } from "./data";
import { resolveRegions } from "./_regions";
import type { AttractionAdmissionRule } from "@/types/domain";

/**
 * Seed the `attraction_admissions` collection from deterministic dataset
 * records for one or more regions.
 *
 * Usage:
 *   npx tsx scripts/seedAttractionAdmissions.ts --region rajasthan
 *   npx tsx scripts/seedAttractionAdmissions.ts --regions rajasthan,gujarat
 *   npx tsx scripts/seedAttractionAdmissions.ts --all
 *   npx tsx scripts/seedAttractionAdmissions.ts --all --dry-run
 */
async function main() {
  const args = parseArgs();
  const dryRun = Boolean(args["dry-run"]);
  const regions = resolveRegions(args);

  console.log(
    `[seedAttractionAdmissions] regions=${regions.join(",")} dryRun=${dryRun} (${regions.length} dataset${regions.length === 1 ? "" : "s"})`,
  );

  let totalRules = 0;
  for (const region of regions) {
    const dataset = await loadDataset(region);
    const rules = (dataset.attractionAdmissions?.() ?? []).map((rule) =>
      normaliseRule(rule, dataset.region),
    );

    if (rules.length === 0) {
      console.warn(
        `[seedAttractionAdmissions] ${region}: dataset does not expose attractionAdmissions() - skipping.`,
      );
      continue;
    }

    console.log(
      `[seedAttractionAdmissions] ${region}: ${rules.length} rule${rules.length === 1 ? "" : "s"}`,
    );
    totalRules += rules.length;

    if (dryRun) {
      console.log(JSON.stringify(rules.slice(0, 5), null, 2));
      console.log(`...and ${Math.max(0, rules.length - 5)} more`);
      continue;
    }

    const { upsertRule } = await import(
      "@/lib/repositories/attractionAdmissionRepository"
    );
    for (const rule of rules) {
      await upsertRule(rule);
    }
  }

  if (!dryRun) {
    console.log(
      `[seedAttractionAdmissions] done - upserted ${totalRules} rule${totalRules === 1 ? "" : "s"} across ${regions.length} region${regions.length === 1 ? "" : "s"}.`,
    );
  }
}

function normaliseRule(
  rule: AttractionAdmissionRule,
  region: string,
): AttractionAdmissionRule {
  const id = rule.id?.trim();
  if (!id) {
    throw new Error("[seedAttractionAdmissions] Every rule must include id.");
  }
  const attractionNodeId = rule.attraction_node_id?.trim();
  if (!attractionNodeId) {
    throw new Error(
      `[seedAttractionAdmissions] Rule "${id}" is missing attraction_node_id.`,
    );
  }

  return {
    ...rule,
    id,
    attraction_node_id: attractionNodeId,
    region: (rule.region || region).trim(),
  };
}

main().catch((err) => {
  console.error("[seedAttractionAdmissions] failed:", err);
  process.exit(1);
});
