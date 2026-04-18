#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";
import { loadDataset } from "./data";
import { mapLimit } from "@/lib/utils/concurrency";
import type { GraphNode, PreferenceTag } from "@/types/domain";

/**
 * Seed the `nodes` collection with `attraction` records for each city in a
 * region. Uses the generic Places Text Search service; no region-specific
 * logic lives here. The dataset file supplies the query list + center for
 * each city.
 *
 * Usage:
 *   npx tsx scripts/seedAttractions.ts --region rajasthan
 *   npx tsx scripts/seedAttractions.ts --region rajasthan --per-city 8
 *   npx tsx scripts/seedAttractions.ts --region rajasthan --concurrency 6
 *   npx tsx scripts/seedAttractions.ts --region rajasthan --dry-run
 */

async function main() {
  const args = parseArgs();
  const region = String(args.region ?? "rajasthan");
  const dryRun = Boolean(args["dry-run"]);
  const perCity = Math.max(1, Math.min(20, Number(args["per-city"] ?? 6)));
  const concurrency = Math.max(1, Math.min(16, Number(args.concurrency ?? 4)));
  const radius_m = Math.max(
    2_000,
    Math.min(200_000, Number(args["radius-m"] ?? 35_000)),
  );

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY is required for attraction seeding. Set it in .env.local.",
    );
  }

  const dataset = await loadDataset(region);
  const queries = dataset.placesQueries?.() ?? [];
  if (queries.length === 0) {
    throw new Error(
      `Dataset ${region} does not expose placesQueries(). Seed attractions cannot proceed.`,
    );
  }

  const { fetchPlacesByQuery } = await import("@/lib/services/placesService");

  const perCityResults = await mapLimit(queries, concurrency, async (q) => {
    console.log(`[seedAttractions] ${q.city_id}: "${q.query}"`);
    const results = await fetchPlacesByQuery({
      query: q.query,
      locationBias: { center: q.center, radius_m },
      maxResults: perCity,
    });
    return results.map((p) => ({
      id: `attr_${p.google_place_id}`,
      type: "attraction" as const,
      name: p.name,
      region: dataset.region,
      country: dataset.country,
      tags: inferTags(p.types ?? [], q.city_tags ?? []),
      metadata: {
        description: p.formatted_address,
        recommended_hours: estimateHoursFromTypes(p.types ?? []),
        google_place_id: p.google_place_id,
        rating: p.rating,
        user_ratings_total: p.user_ratings_total,
      },
      location: p.location,
      parent_node_id: q.city_id,
      source: "google_places" as const,
    }));
  });
  const attractions: GraphNode[] = perCityResults.flat();

  console.log(
    `[seedAttractions] region=${region} attractions=${attractions.length} dryRun=${dryRun} concurrency=${concurrency}`,
  );

  if (dryRun) {
    console.log(JSON.stringify(attractions.slice(0, 5), null, 2));
    console.log(`…and ${Math.max(0, attractions.length - 5)} more`);
    return;
  }

  const { upsertNodes } = await import("@/lib/repositories/nodeRepository");
  await upsertNodes(attractions);
  console.log(`[seedAttractions] upserted ${attractions.length} attractions.`);
}

/**
 * Map Google Places `types` to our preference tags. Purely heuristic — the
 * point of tags is to let scoring + UI filters bite on seed data. Override
 * per-region by customising a dataset's cities' `tags`.
 */
function inferTags(
  placeTypes: string[],
  cityTags: PreferenceTag[],
): PreferenceTag[] {
  const tags = new Set<PreferenceTag>(cityTags);
  const map: Record<string, PreferenceTag> = {
    museum: "heritage",
    tourist_attraction: "heritage",
    hindu_temple: "spiritual",
    mosque: "spiritual",
    church: "spiritual",
    park: "nature",
    zoo: "wildlife",
    natural_feature: "nature",
    amusement_park: "adventure",
    art_gallery: "culture",
    shopping_mall: "shopping",
    restaurant: "food",
    cafe: "food",
  };
  for (const t of placeTypes) {
    const mapped = map[t];
    if (mapped) tags.add(mapped);
  }
  return Array.from(tags);
}

function estimateHoursFromTypes(types: string[]): number {
  if (types.some((t) => t === "museum" || t === "art_gallery")) return 2;
  if (types.some((t) => t === "park" || t === "natural_feature")) return 2.5;
  if (types.some((t) => t === "zoo" || t === "amusement_park")) return 3.5;
  if (types.some((t) => t === "restaurant" || t === "cafe")) return 1.5;
  return 2;
}

main().catch((err) => {
  console.error("[seedAttractions] failed:", err);
  process.exit(1);
});
