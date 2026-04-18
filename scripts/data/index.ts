import type { GraphEdge, GraphNode, RegionSummary } from "@/types/domain";

/**
 * Shape that every seed-data module must export. Seed scripts load datasets
 * by name via {@link loadDataset} — adding a new region is a matter of
 * creating `scripts/data/<slug>.ts` that default-exports a
 * {@link SeedDataset}. No edits to the seed scripts required.
 */
export interface SeedDataset {
  region: string;
  country: string;
  /** Optional metadata written to the denormalised `regions/<slug>` doc. */
  summary?: Partial<RegionSummary>;
  cities: () => GraphNode[];
  /** Optional base road/train/flight edges. Curated seed data. */
  edges?: () => GraphEdge[];
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
 * that's needed — no registry edits. The loader normalises whatever the
 * file exports into a {@link SeedDataset}.
 */
export async function loadDataset(slug: string): Promise<SeedDataset> {
  const mod = (await import(`./${slug}.ts`)) as Record<string, unknown>;

  // Preferred shape: `export default { ... } as SeedDataset`.
  const defaultExport = mod.default as SeedDataset | undefined;
  if (defaultExport && typeof defaultExport === "object") {
    return defaultExport;
  }

  // Back-compat for hand-written modules with named exports (e.g.
  // `rajasthan.ts` keeps its existing shape). Wire them up here so the
  // scripts don't have to care.
  if (slug === "rajasthan") {
    const {
      RAJASTHAN_REGION,
      RAJASTHAN_COUNTRY,
      RAJASTHAN_CITIES,
      RAJASTHAN_CURRENCY,
      RAJASTHAN_LOCALE,
      RAJASTHAN_DEFAULT_TRANSPORT_MODES,
      toCityNodes,
      toRoadEdges,
    } = mod as typeof import("./rajasthan");
    return {
      region: RAJASTHAN_REGION,
      country: RAJASTHAN_COUNTRY,
      summary: {
        default_currency: RAJASTHAN_CURRENCY,
        default_locale: RAJASTHAN_LOCALE,
        default_transport_modes: [...RAJASTHAN_DEFAULT_TRANSPORT_MODES],
      },
      cities: () => toCityNodes(),
      edges: () => toRoadEdges(),
      placesQueries: () =>
        RAJASTHAN_CITIES.map((c) => ({
          city_id: c.id,
          query: c.places_query ?? `top tourist attractions in ${c.name}`,
          center: { lat: c.lat, lng: c.lng },
          city_tags: c.tags,
        })),
    };
  }

  throw new Error(
    `scripts/data/${slug}.ts does not export a default SeedDataset.`,
  );
}
