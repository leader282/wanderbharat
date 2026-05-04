import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AttractionAdmissionRule,
  AttractionOpeningHours,
  GraphEdge,
  GraphNode,
  RegionSummary,
} from "@/types/domain";

/**
 * Shape that every seed-data module must export. Seed scripts load datasets
 * by name via {@link loadDataset} — adding a new region is a matter of
 * creating `scripts/data/<slug>.ts` that default-exports a
 * {@link SeedDataset}. No edits to the seed scripts are required.
 */
export interface SeedDataset {
  region: string;
  country: string;
  /** Optional metadata written to the denormalised `regions/<slug>` doc. */
  summary?: Partial<RegionSummary>;
  cities: () => GraphNode[];
  /**
   * Optional deterministic attraction records. Prefer this for curated v2
   * datasets where we don't want live provider dependence during reseed.
   */
  attractions?: () => GraphNode[];
  /** Optional base road/train/flight edges. Curated seed data. */
  edges?: () => GraphEdge[];
  /** Optional seed payload for the `attraction_hours` collection. */
  attractionHours?: () => AttractionOpeningHours[];
  /** Optional seed payload for the `attraction_admissions` collection. */
  attractionAdmissions?: () => AttractionAdmissionRule[];
  /** Optional list used by `seedAttractions` for Places queries. */
  placesQueries?: () => Array<{
    city_id: string;
    query: string;
    center: { lat: number; lng: number };
    city_tags?: string[];
  }>;
}

/**
 * Dynamically load a dataset file. Adding `scripts/data/<slug>.ts` is all
 * that's needed — no registry edits. The file must default-export a
 * {@link SeedDataset}.
 */
export async function loadDataset(slug: string): Promise<SeedDataset> {
  let mod: { default?: SeedDataset };
  try {
    mod = (await import(`./${slug}.ts`)) as { default?: SeedDataset };
  } catch (err) {
    throw new Error(
      `Could not load scripts/data/${slug}.ts: ${(err as Error).message}`,
    );
  }

  const dataset = mod.default;
  if (!dataset || typeof dataset !== "object") {
    throw new Error(
      `scripts/data/${slug}.ts must default-export a SeedDataset.`,
    );
  }
  if (dataset.region !== slug) {
    throw new Error(
      `scripts/data/${slug}.ts declares region="${dataset.region}" but was loaded as "${slug}". The slug must match the filename.`,
    );
  }
  return dataset;
}

/**
 * Discover every dataset available on disk. Returns a sorted list of region
 * slugs (filenames without extension), excluding the loader itself and any
 * leading-underscore helper modules. Used by the seed scripts to power
 * `--all`.
 */
export function listAvailableRegions(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return readdirSync(here)
    .filter(
      (file) =>
        (file.endsWith(".ts") || file.endsWith(".js")) &&
        !file.startsWith("_") &&
        !file.startsWith("index."),
    )
    .map((file) => file.replace(/\.(ts|js)$/, ""))
    .sort();
}
