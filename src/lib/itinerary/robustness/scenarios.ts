import type { EngineDependencies } from "@/lib/itinerary/engine";
import { MAX_TRIP_DAYS } from "@/lib/itinerary/planningLimits";
import { buildTravelMatrix } from "@/lib/itinerary/travelMatrix";
import type {
  GenerateItineraryInput,
  GraphEdge,
  GraphNode,
  PreferenceTag,
  TransportMode,
  TravelStyle,
} from "@/types/domain";

import { createSeededRng, deriveSeed, type SeededRng } from "./rng";
import {
  deterministicNowFromSeed,
  toAttractionsByCityMap,
} from "./serialization";
import type {
  GeneratedScenario,
  RobustnessProfile,
  ScenarioExpectation,
  SerializableAttractionsByCity,
} from "./types";

type GenerationProfile = "quick" | "heavy";

const REGION_FALLBACKS = ["rajasthan", "gujarat", "himachal"] as const;
const TRAVEL_STYLE_POOL: readonly TravelStyle[] = [
  "relaxed",
  "balanced",
  "adventurous",
];
const TRANSPORT_MODE_POOL: readonly TransportMode[] = [
  "road",
  "train",
  "flight",
];
const INTEREST_POOL: readonly PreferenceTag[] = [
  "heritage",
  "nature",
  "food",
  "spiritual",
  "culture",
  "wildlife",
];

const REGION_CENTERS: Record<string, { lat: number; lng: number }> = {
  rajasthan: { lat: 26.9, lng: 75.8 },
  gujarat: { lat: 22.3, lng: 72.6 },
  himachal: { lat: 31.1, lng: 77.2 },
};

const HEAVY_MUTATIONS = [
  "none",
  "drop_edges",
  "directional_edges",
  "inflate_travel_time",
  "sparse_attractions",
  "tight_budget",
  "requested_city_pressure",
  "unsupported_modes",
] as const;

interface ScenarioDraft {
  title: string;
  source: GeneratedScenario["source"];
  datasetId?: string;
  mutation: string;
  expectationHint?: ScenarioExpectation;
  nodes: GraphNode[];
  edges: GraphEdge[];
  attractionsByCity: Record<string, GraphNode[]>;
  input: GenerateItineraryInput;
}

export interface LoadedScenarioDataset {
  id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  attractionsByCity?: SerializableAttractionsByCity | Map<string, GraphNode[]>;
}

export interface GenerateScenarioOptions {
  profile: RobustnessProfile;
  seed: string;
  caseIndex: number;
  datasets?: readonly LoadedScenarioDataset[];
}

export function generateScenario(
  opts: GenerateScenarioOptions,
): GeneratedScenario {
  const generationProfile = toGenerationProfile(opts.profile);
  const caseSeed = deriveSeed(opts.seed, opts.caseIndex);
  const rng = createSeededRng(caseSeed);
  const datasets = sanitizeDatasets(opts.datasets ?? [], caseSeed);
  const useDataset =
    datasets.length > 0 &&
    shouldUseDatasetSource(opts.caseIndex, generationProfile);

  const baseDraft = useDataset
    ? buildDatasetDraft({
        profile: generationProfile,
        caseIndex: opts.caseIndex,
        rng,
        datasets,
      })
    : buildSyntheticDraft({
        profile: generationProfile,
        caseIndex: opts.caseIndex,
        rng,
      });

  const mutatedDraft =
    generationProfile === "heavy"
      ? applyHeavyMutation(baseDraft, rng, opts.caseIndex)
      : baseDraft;
  const normalizedDraft = normalizeDraft(
    mutatedDraft,
    rng,
    generationProfile,
    opts.caseIndex,
  );
  const expectation = inferExpectation(normalizedDraft);
  const id = buildScenarioId(opts.profile, opts.caseIndex, caseSeed);

  return {
    id,
    index: opts.caseIndex,
    profile: opts.profile,
    seed: opts.seed,
    title: normalizedDraft.title,
    source: normalizedDraft.source,
    datasetId: normalizedDraft.datasetId,
    mutation: normalizedDraft.mutation,
    expectation,
    input: normalizedDraft.input,
    context: {
      nodes: normalizedDraft.nodes,
      edges: normalizedDraft.edges,
      attractionsByCity: normalizedDraft.attractionsByCity,
      nowEpochMs: deterministicNowFromSeed(caseSeed),
      makeIdSeed: `${caseSeed}::make-id`,
    },
  };
}

export function makeOfflineResolver(): NonNullable<
  EngineDependencies["resolveTravelMatrix"]
> {
  return async (input) =>
    buildTravelMatrix(input.nodes, input.edges, input.modes, input.tuning);
}

function toGenerationProfile(profile: RobustnessProfile): GenerationProfile {
  return profile === "heavy" ? "heavy" : "quick";
}

function shouldUseDatasetSource(
  caseIndex: number,
  profile: GenerationProfile,
): boolean {
  if (profile === "quick") {
    return caseIndex % 2 === 0;
  }
  return caseIndex % 3 !== 1;
}

function buildScenarioId(
  profile: RobustnessProfile,
  caseIndex: number,
  caseSeed: string,
): string {
  const suffix = caseSeed.slice(-8);
  return `rb-${profile}-${String(caseIndex).padStart(4, "0")}-${suffix}`;
}

function sanitizeDatasets(
  datasets: readonly LoadedScenarioDataset[],
  seed: string,
): LoadedScenarioDataset[] {
  return datasets
    .map((dataset, index) => sanitizeDataset(dataset, seed, index))
    .filter((dataset) => dataset.nodes.some((node) => node.type === "city"));
}

function sanitizeDataset(
  dataset: LoadedScenarioDataset,
  seed: string,
  index: number,
): LoadedScenarioDataset {
  const fallbackRegion = REGION_FALLBACKS[index % REGION_FALLBACKS.length];
  const cleanedNodes = dataset.nodes.map((node) =>
    sanitizeNode(node, fallbackRegion),
  );
  const nodeIds = new Set(cleanedNodes.map((node) => node.id));
  const cleanedEdges = dataset.edges
    .map((edge) => sanitizeEdge(edge, fallbackRegion))
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const cleanedAttractionsByCity = toAttractionsByCityMap(
    dataset.attractionsByCity,
  );

  return {
    id: dataset.id?.trim() || `dataset_${hashLike(seed, index)}`,
    nodes: dedupeById(cleanedNodes),
    edges: dedupeEdges(cleanedEdges),
    attractionsByCity: cleanedAttractionsByCity
      ? Object.fromEntries(cleanedAttractionsByCity.entries())
      : undefined,
  };
}

function buildSyntheticDraft(args: {
  profile: GenerationProfile;
  caseIndex: number;
  rng: SeededRng;
}): ScenarioDraft {
  const region = args.rng.pick(REGION_FALLBACKS);
  const center = REGION_CENTERS[region] ?? { lat: 23.5, lng: 78.9 };
  const cityCount =
    args.profile === "heavy" ? args.rng.int(3, 8) : args.rng.int(2, 4);
  const cities: GraphNode[] = [];
  for (let i = 0; i < cityCount; i += 1) {
    cities.push({
      id: `syn_${args.caseIndex}_city_${i}`,
      type: "city",
      name: `Synthetic City ${args.caseIndex}-${i}`,
      region,
      country: "india",
      tags: pickTags(args.rng, INTEREST_POOL, 2, 4),
      metadata: {
        avg_daily_cost: args.rng.int(1200, 6200),
        recommended_hours: args.rng.int(6, 14),
        description: `Synthetic city fixture ${args.caseIndex}-${i}`,
      },
      location: {
        lat: clamp(center.lat + jitter(args.rng, 0.8), -89, 89),
        lng: clamp(center.lng + jitter(args.rng, 1.2), -179, 179),
      },
      source: "manual",
    });
  }

  const attractionsByCity: Record<string, GraphNode[]> = {};
  const attractions: GraphNode[] = [];
  for (const city of cities) {
    const maxAttractions = args.profile === "heavy" ? 4 : 2;
    const attractionCount = args.rng.int(0, maxAttractions);
    if (attractionCount <= 0) continue;

    const cityAttractions: GraphNode[] = [];
    for (let i = 0; i < attractionCount; i += 1) {
      const attraction: GraphNode = {
        id: `${city.id}_attr_${i}`,
        type: "attraction",
        name: `${city.name} Attraction ${i + 1}`,
        region: city.region,
        country: city.country,
        tags: pickTags(args.rng, INTEREST_POOL, 1, 2),
        parent_node_id: city.id,
        metadata: {
          recommended_hours: args.rng.int(1, 4),
          avg_daily_cost: args.rng.int(0, 1800),
          description: `Synthetic attraction ${city.id}-${i}`,
        },
        location: {
          lat: clamp(city.location.lat + jitter(args.rng, 0.08), -89, 89),
          lng: clamp(city.location.lng + jitter(args.rng, 0.08), -179, 179),
        },
        source: "manual",
      };
      cityAttractions.push(attraction);
      attractions.push(attraction);
    }
    attractionsByCity[city.id] = cityAttractions;
  }

  const edges = buildSyntheticEdges(cities, args.rng, args.profile);
  const input = buildInputForCities(cities, args.rng, args.profile);

  return {
    title: `Synthetic ${args.profile} case ${args.caseIndex}`,
    source: "synthetic",
    mutation: "none",
    nodes: [...cities, ...attractions],
    edges,
    attractionsByCity,
    input,
  };
}

function buildDatasetDraft(args: {
  profile: GenerationProfile;
  caseIndex: number;
  rng: SeededRng;
  datasets: LoadedScenarioDataset[];
}): ScenarioDraft {
  const dataset = args.rng.pick(args.datasets);
  const allCities = dataset.nodes.filter((node) => node.type === "city");
  if (allCities.length < 2) {
    return buildSyntheticDraft({
      profile: args.profile,
      caseIndex: args.caseIndex,
      rng: args.rng,
    });
  }

  const maxCities = Math.min(
    allCities.length,
    args.profile === "heavy" ? 10 : 5,
  );
  const minCities = Math.min(maxCities, args.profile === "heavy" ? 3 : 2);
  const selectedCityCount = args.rng.int(minCities, maxCities);
  const selectedCities = args.rng
    .shuffle(allCities)
    .slice(0, selectedCityCount);
  const selectedCityIds = new Set(selectedCities.map((node) => node.id));

  const mapFromDataset =
    toAttractionsByCityMap(dataset.attractionsByCity) ??
    toAttractionsByCityMap(buildAttractionRecord(dataset.nodes));

  const attractionsByCity: Record<string, GraphNode[]> = {};
  const selectedAttractions: GraphNode[] = [];
  for (const city of selectedCities) {
    const available = mapFromDataset?.get(city.id) ?? [];
    if (available.length === 0) continue;
    const limit = Math.min(available.length, args.profile === "heavy" ? 4 : 2);
    const count = args.rng.int(0, limit);
    if (count <= 0) continue;
    const picked = args.rng.shuffle(available).slice(0, count);
    attractionsByCity[city.id] = picked;
    selectedAttractions.push(...picked);
  }

  const baseEdges = dataset.edges.filter(
    (edge) => selectedCityIds.has(edge.from) && selectedCityIds.has(edge.to),
  );
  const edges =
    args.profile === "quick"
      ? ensureSequentialRoadEdges(
          selectedCities,
          baseEdges,
          args.rng,
          dataset.id,
        )
      : baseEdges;
  const input = buildInputForCities(selectedCities, args.rng, args.profile);

  return {
    title: `Dataset ${dataset.id} ${args.profile} case ${args.caseIndex}`,
    source: "dataset",
    datasetId: dataset.id,
    mutation: "none",
    nodes: dedupeById([...selectedCities, ...selectedAttractions]),
    edges,
    attractionsByCity,
    input,
  };
}

function applyHeavyMutation(
  draft: ScenarioDraft,
  rng: SeededRng,
  caseIndex: number,
): ScenarioDraft {
  const mutation = HEAVY_MUTATIONS[caseIndex % HEAVY_MUTATIONS.length];
  const out = structuredClone(draft) as ScenarioDraft;
  out.mutation = mutation;

  switch (mutation) {
    case "drop_edges": {
      const kept = out.edges.filter(
        (_, index) => index === 0 || rng.boolean(0.45),
      );
      out.edges = kept.length > 0 ? kept : out.edges.slice(0, 1);
      out.expectationHint = "may_reject";
      break;
    }
    case "directional_edges": {
      out.edges = out.edges.map((edge, index) =>
        index % 2 === 0 ? { ...edge, bidirectional: false } : edge,
      );
      break;
    }
    case "inflate_travel_time": {
      const factor = Number((1.6 + rng.nextFloat() * 1.8).toFixed(2));
      out.edges = out.edges.map((edge) => ({
        ...edge,
        travel_time_hours: Number(
          Math.max(0.25, edge.travel_time_hours * factor).toFixed(2),
        ),
      }));
      break;
    }
    case "sparse_attractions": {
      const sparse: Record<string, GraphNode[]> = {};
      for (const [cityId, attractions] of Object.entries(
        out.attractionsByCity,
      )) {
        if (attractions.length === 0 || !rng.boolean(0.35)) continue;
        const picked = rng.boolean(0.5) ? [] : [rng.pick(attractions)];
        if (picked.length > 0) {
          sparse[cityId] = picked;
        }
      }
      const cities = out.nodes.filter((node) => node.type === "city");
      const attractions = Object.values(sparse).flat();
      out.attractionsByCity = sparse;
      out.nodes = [...cities, ...attractions];
      break;
    }
    case "tight_budget": {
      const oldBudget = out.input.preferences.budget;
      const max = Math.max(1000, Math.min(oldBudget.max, rng.int(1500, 9000)));
      const min = rng.int(0, Math.floor(max * 0.2));
      out.input.preferences = {
        ...out.input.preferences,
        budget: {
          ...oldBudget,
          min,
          max,
        },
      };
      out.expectationHint = "may_reject";
      break;
    }
    case "requested_city_pressure": {
      const cityIds = out.nodes
        .filter((node) => node.type === "city")
        .map((node) => node.id)
        .filter(
          (id) =>
            id !== out.input.start_node &&
            id !== (out.input.end_node ?? out.input.start_node),
        );
      out.input.requested_city_ids = cityIds.slice(
        0,
        Math.min(4, cityIds.length),
      );
      out.input.days = Math.max(1, Math.min(2, out.input.days));
      out.expectationHint = "may_reject";
      break;
    }
    case "unsupported_modes": {
      out.input.preferences = {
        ...out.input.preferences,
        transport_modes: ["flight"],
      };
      out.expectationHint = "may_reject";
      break;
    }
    case "none": {
      break;
    }
  }

  return out;
}

function normalizeDraft(
  draft: ScenarioDraft,
  rng: SeededRng,
  profile: GenerationProfile,
  caseIndex: number,
): ScenarioDraft {
  const fallbackRegion = resolveFallbackRegion(draft, caseIndex);
  let cities = dedupeById(
    draft.nodes
      .filter((node) => node.type === "city")
      .map((node) => sanitizeNode(node, fallbackRegion)),
  );
  if (cities.length === 0) {
    cities = createFallbackCities(caseIndex, fallbackRegion);
  } else if (cities.length === 1) {
    cities = [...cities, createCompanionCity(cities[0], caseIndex)];
  }

  const cityIds = new Set(cities.map((city) => city.id));
  const nodesFromDraft = draft.nodes
    .filter(
      (node) =>
        node.type === "attraction" &&
        !!node.parent_node_id &&
        cityIds.has(node.parent_node_id),
    )
    .map((node) => sanitizeNode(node, fallbackRegion));
  const mapAttractions =
    toAttractionsByCityMap(draft.attractionsByCity) ??
    new Map<string, GraphNode[]>();
  const mappedAttractions: GraphNode[] = [];
  for (const [cityId, attractions] of mapAttractions.entries()) {
    if (!cityIds.has(cityId)) continue;
    for (const attraction of attractions) {
      const sanitized = sanitizeNode(attraction, fallbackRegion);
      if (sanitized.type !== "attraction") continue;
      sanitized.parent_node_id = cityId;
      mappedAttractions.push(sanitized);
    }
  }
  const attractions = dedupeById([
    ...nodesFromDraft,
    ...mappedAttractions,
  ]).filter(
    (attraction) =>
      attraction.type === "attraction" &&
      !!attraction.parent_node_id &&
      cityIds.has(attraction.parent_node_id),
  );
  const attractionsByCity = buildAttractionRecord(attractions);

  const edges = dedupeEdges(
    draft.edges
      .map((edge) => sanitizeEdge(edge, fallbackRegion))
      .filter(
        (edge) =>
          edge.from !== edge.to &&
          cityIds.has(edge.from) &&
          cityIds.has(edge.to),
      ),
  );
  const connectedEdges =
    profile === "quick"
      ? ensureSequentialRoadEdges(cities, edges, rng, "quick")
      : edges;

  const input = sanitizeInput(draft.input, cities, profile, rng);

  return {
    ...draft,
    nodes: [...cities, ...attractions],
    edges: connectedEdges,
    attractionsByCity,
    input,
  };
}

function inferExpectation(draft: ScenarioDraft): ScenarioExpectation {
  if (draft.expectationHint === "may_reject") return "may_reject";
  if (draft.mutation !== "none") return "may_reject";

  const modes = normaliseModes(draft.input.preferences.transport_modes);
  const start = draft.input.start_node;
  const end = draft.input.end_node ?? draft.input.start_node;
  if (!hasReachablePath(start, end, draft.edges, modes)) {
    return "may_reject";
  }

  const requestedCount = draft.input.requested_city_ids?.length ?? 0;
  if (requestedCount > 0) {
    return "may_reject";
  }

  if (draft.input.preferences.budget.min > 0) {
    return "may_reject";
  }

  const cityCount = draft.nodes.filter((node) => node.type === "city").length;
  if (cityCount < 2 && draft.input.days > 1) {
    return "may_reject";
  }

  if (end !== start) {
    return "may_reject";
  }

  return "must_plan";
}

function buildSyntheticEdges(
  cities: GraphNode[],
  rng: SeededRng,
  profile: GenerationProfile,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  if (cities.length < 2) return edges;

  for (let i = 0; i < cities.length - 1; i += 1) {
    const from = cities[i];
    const to = cities[i + 1];
    edges.push(makeRoadEdge(from, to, `chain_${i}`));
  }

  const extraEdgeCount =
    profile === "heavy"
      ? rng.int(1, Math.max(2, cities.length))
      : rng.int(0, Math.max(1, cities.length - 1));
  for (let i = 0; i < extraEdgeCount; i += 1) {
    const from = rng.pick(cities);
    const to = rng.pick(cities);
    if (from.id === to.id) continue;
    const mode =
      profile === "heavy" && rng.boolean(0.45)
        ? rng.pick(TRANSPORT_MODE_POOL)
        : "road";
    edges.push(
      makeEdgeBetweenCities(from, to, mode, `extra_${i}`, rng.boolean(0.75)),
    );
  }

  return dedupeEdges(edges.map((edge) => sanitizeEdge(edge, cities[0].region)));
}

function ensureSequentialRoadEdges(
  cities: GraphNode[],
  seedEdges: GraphEdge[],
  rng: SeededRng,
  seedLabel: string,
): GraphEdge[] {
  const edges = [...seedEdges];
  const seenPairs = new Set<string>();
  for (const edge of edges) {
    seenPairs.add(pairKey(edge.from, edge.to, edge.type));
    if (edge.bidirectional !== false) {
      seenPairs.add(pairKey(edge.to, edge.from, edge.type));
    }
  }

  for (let i = 0; i < cities.length - 1; i += 1) {
    const from = cities[i];
    const to = cities[i + 1];
    const forward = pairKey(from.id, to.id, "road");
    const backward = pairKey(to.id, from.id, "road");
    if (seenPairs.has(forward) || seenPairs.has(backward)) continue;
    const edge = makeEdgeBetweenCities(
      from,
      to,
      "road",
      `${seedLabel}_${i}`,
      rng.boolean(0.9),
    );
    edges.push(edge);
    seenPairs.add(pairKey(edge.from, edge.to, edge.type));
    if (edge.bidirectional !== false) {
      seenPairs.add(pairKey(edge.to, edge.from, edge.type));
    }
  }

  return dedupeEdges(edges);
}

function buildInputForCities(
  cities: GraphNode[],
  rng: SeededRng,
  profile: GenerationProfile,
): GenerateItineraryInput {
  const ordered = rng.shuffle(cities);
  const start = ordered[0];
  const roundTripChance = profile === "quick" ? 0.55 : 0.3;
  const roundTrip = rng.boolean(roundTripChance);
  const fallbackEnd = ordered[1] ?? ordered[0];
  const end = roundTrip ? start : fallbackEnd;
  const dayUpper =
    profile === "quick" ? Math.min(MAX_TRIP_DAYS, 4) : MAX_TRIP_DAYS;
  const minDays = start.id === end.id ? 1 : 2;
  const days = rng.int(minDays, dayUpper);

  const budgetMaxBase = Math.max(12000, cities.length * 4500 + days * 3800);
  const budgetMax =
    profile === "quick"
      ? budgetMaxBase + rng.int(8000, 32000)
      : budgetMaxBase + rng.int(2000, 45000);
  const budgetMin =
    profile === "quick" ? 0 : rng.int(0, Math.floor(budgetMax * 0.4));

  const requestedCandidates = ordered
    .slice(2)
    .filter((city) => city.id !== start.id && city.id !== end.id);
  const requestedCount =
    profile === "quick"
      ? Math.min(requestedCandidates.length, rng.int(0, 1))
      : Math.min(requestedCandidates.length, rng.int(0, 3));
  const requestedCityIds = rng
    .shuffle(requestedCandidates)
    .slice(0, requestedCount)
    .map((city) => city.id);

  return {
    regions: dedupeStrings(ordered.map((city) => city.region)),
    start_node: start.id,
    end_node: end.id,
    requested_city_ids:
      requestedCityIds.length > 0 ? requestedCityIds : undefined,
    days,
    preferences: {
      travel_style: rng.pick(TRAVEL_STYLE_POOL),
      budget: {
        min: budgetMin,
        max: Math.max(budgetMin, budgetMax),
        currency: "INR",
      },
      travellers: {
        adults: rng.int(1, 4),
        children: rng.int(0, 2),
      },
      interests: pickTags(rng, INTEREST_POOL, 1, 3),
      transport_modes:
        profile === "quick"
          ? rng.boolean(0.85)
            ? ["road"]
            : ["road", "train"]
          : rng
              .shuffle(TRANSPORT_MODE_POOL)
              .slice(0, rng.int(1, TRANSPORT_MODE_POOL.length)),
      prioritize_city_coverage: rng.boolean(profile === "quick" ? 0.3 : 0.5),
      preferred_start_time: makeClock(rng),
      trip_start_date: makeDate(rng),
    },
  };
}

function sanitizeInput(
  input: GenerateItineraryInput,
  cities: GraphNode[],
  profile: GenerationProfile,
  rng: SeededRng,
): GenerateItineraryInput {
  const cityIds = cities.map((city) => city.id);
  const cityIdSet = new Set(cityIds);

  const fallbackStart = cityIds[0];
  const fallbackEnd = cityIds[1] ?? cityIds[0];
  const start = cityIdSet.has(input.start_node)
    ? input.start_node
    : fallbackStart;
  const candidateEnd = input.end_node ?? start;
  const end = cityIdSet.has(candidateEnd) ? candidateEnd : fallbackEnd;

  const minDays = start === end ? 1 : 2;
  const maxDays =
    profile === "quick" ? Math.min(MAX_TRIP_DAYS, 4) : MAX_TRIP_DAYS;
  const days = clampInt(toFiniteInt(input.days, minDays), minDays, maxDays);

  const modeSet = new Set<TransportMode>(
    normaliseModes(input.preferences.transport_modes),
  );
  if (modeSet.size === 0) modeSet.add("road");

  const regionsFromInput = dedupeStrings(input.regions);
  const regions =
    regionsFromInput.length > 0
      ? regionsFromInput
      : dedupeStrings(cities.map((city) => city.region));

  const rawBudget = input.preferences.budget;
  const minBudget = Math.max(0, toFiniteNumber(rawBudget.min, 0));
  const maxBudget = Math.max(
    minBudget,
    toFiniteNumber(rawBudget.max, minBudget + 10000),
  );

  let requested = dedupeStrings(input.requested_city_ids ?? []).filter(
    (id) => cityIdSet.has(id) && id !== start && id !== end,
  );
  if (profile === "quick") {
    requested = requested.slice(0, 2);
  } else {
    requested = requested.slice(0, 4);
  }

  return {
    regions: regions.length > 0 ? regions : [rng.pick(REGION_FALLBACKS)],
    start_node: start,
    end_node: end,
    requested_city_ids: requested.length > 0 ? requested : undefined,
    days,
    preferences: {
      travel_style: normaliseTravelStyle(input.preferences.travel_style),
      budget: {
        min: Number(minBudget.toFixed(2)),
        max: Number(maxBudget.toFixed(2)),
        currency:
          typeof rawBudget.currency === "string" && rawBudget.currency.trim()
            ? rawBudget.currency.trim().toUpperCase()
            : "INR",
      },
      travellers: {
        adults: Math.max(
          1,
          toFiniteInt(input.preferences.travellers.adults, 1),
        ),
        children: Math.max(
          0,
          toFiniteInt(input.preferences.travellers.children, 0),
        ),
      },
      interests: sanitizeInterests(input.preferences.interests, cities, rng),
      transport_modes: Array.from(modeSet),
      prioritize_city_coverage: Boolean(
        input.preferences.prioritize_city_coverage,
      ),
      preferred_start_time: normaliseClock(
        input.preferences.preferred_start_time,
        rng,
      ),
      trip_start_date: normaliseDate(input.preferences.trip_start_date, rng),
    },
  };
}

function resolveFallbackRegion(
  draft: ScenarioDraft,
  caseIndex: number,
): string {
  const fromNodes = draft.nodes
    .map((node) => node.region?.trim())
    .find((region) => !!region);
  if (fromNodes) return fromNodes;
  return REGION_FALLBACKS[caseIndex % REGION_FALLBACKS.length];
}

function createFallbackCities(caseIndex: number, region: string): GraphNode[] {
  const cityA: GraphNode = {
    id: `fallback_${caseIndex}_a`,
    type: "city",
    name: `Fallback City ${caseIndex}A`,
    region,
    country: "india",
    tags: ["heritage"],
    metadata: { avg_daily_cost: 2000, recommended_hours: 8 },
    location: { lat: 23, lng: 77 },
    source: "manual",
  };
  const cityB = createCompanionCity(cityA, caseIndex);
  return [cityA, cityB];
}

function createCompanionCity(anchor: GraphNode, caseIndex: number): GraphNode {
  return {
    id: `${anchor.id}_b`,
    type: "city",
    name: `Fallback Companion ${caseIndex}`,
    region: anchor.region,
    country: anchor.country,
    tags: [...anchor.tags],
    metadata: { ...anchor.metadata },
    location: {
      lat: clamp(anchor.location.lat + 0.35, -89, 89),
      lng: clamp(anchor.location.lng + 0.35, -179, 179),
    },
    source: anchor.source,
  };
}

function sanitizeNode(node: GraphNode, fallbackRegion: string): GraphNode {
  const region = node.region?.trim() || fallbackRegion;
  const country = node.country?.trim() || "india";
  const tags = sanitizeTags(node.tags);
  const metadata = sanitizeMetadata(node.metadata);

  return {
    ...node,
    id: safeId(node.id, `${node.type}_${hashLike(region, 1)}`),
    name: node.name?.trim() || node.id,
    region,
    country,
    tags,
    metadata,
    location: {
      lat: clamp(toFiniteNumber(node.location?.lat, 23.5), -90, 90),
      lng: clamp(toFiniteNumber(node.location?.lng, 78.9), -180, 180),
    },
    parent_node_id: node.parent_node_id?.trim() || undefined,
  };
}

function sanitizeEdge(edge: GraphEdge, fallbackRegion: string): GraphEdge {
  const mode = normaliseTransportMode(edge.type);
  const distance = Math.max(0.1, toFiniteNumber(edge.distance_km, 1));
  const travelTime = Math.max(
    0.1,
    toFiniteNumber(edge.travel_time_hours, estimateHoursByMode(distance, mode)),
  );
  const metadata = sanitizeUnknown(edge.metadata) as GraphEdge["metadata"];

  if (typeof metadata.base_price === "number") {
    metadata.base_price = Math.max(0, metadata.base_price);
  }
  if (typeof metadata.estimated_cost === "number") {
    metadata.estimated_cost = Math.max(0, metadata.estimated_cost);
  }

  const regions = dedupeStrings(edge.regions).filter(Boolean);
  if (regions.length === 0) {
    regions.push(fallbackRegion);
  }

  return {
    ...edge,
    id: safeId(edge.id, `${edge.from}_${edge.to}_${mode}`),
    from: safeId(edge.from, "from"),
    to: safeId(edge.to, "to"),
    type: mode,
    distance_km: Number(distance.toFixed(1)),
    travel_time_hours: Number(travelTime.toFixed(2)),
    bidirectional: edge.bidirectional !== false,
    regions,
    metadata,
  };
}

function sanitizeMetadata(
  metadata: GraphNode["metadata"],
): GraphNode["metadata"] {
  const out = sanitizeUnknown(metadata) as GraphNode["metadata"];
  if (typeof out.avg_daily_cost === "number") {
    out.avg_daily_cost = Math.max(0, out.avg_daily_cost);
  }
  if (typeof out.recommended_hours === "number") {
    out.recommended_hours = Math.max(0.25, out.recommended_hours);
  }
  return out;
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUnknown(entry));
  }
  if (!isRecord(value)) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = sanitizeUnknown(entry);
  }
  return out;
}

function buildAttractionRecord(
  nodes: GraphNode[],
): Record<string, GraphNode[]> {
  const out: Record<string, GraphNode[]> = {};
  for (const node of nodes) {
    if (node.type !== "attraction" || !node.parent_node_id) continue;
    const bucket = out[node.parent_node_id] ?? [];
    bucket.push(node);
    out[node.parent_node_id] = bucket;
  }
  return out;
}

function hasReachablePath(
  startId: string,
  endId: string,
  edges: GraphEdge[],
  modes: TransportMode[],
): boolean {
  if (startId === endId) return true;

  const allowedModes = new Set(modes);
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!allowedModes.has(edge.type)) continue;
    const forward = adjacency.get(edge.from) ?? new Set<string>();
    forward.add(edge.to);
    adjacency.set(edge.from, forward);

    if (edge.bidirectional !== false) {
      const backward = adjacency.get(edge.to) ?? new Set<string>();
      backward.add(edge.from);
      adjacency.set(edge.to, backward);
    }
  }

  const visited = new Set<string>();
  const queue: string[] = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const next = adjacency.get(current);
    if (!next) continue;
    for (const candidate of next) {
      if (candidate === endId) return true;
      if (visited.has(candidate)) continue;
      visited.add(candidate);
      queue.push(candidate);
    }
  }

  return false;
}

function makeRoadEdge(
  from: GraphNode,
  to: GraphNode,
  suffix: string,
): GraphEdge {
  return makeEdgeBetweenCities(from, to, "road", suffix, true);
}

function makeEdgeBetweenCities(
  from: GraphNode,
  to: GraphNode,
  mode: TransportMode,
  suffix: string,
  bidirectional: boolean,
): GraphEdge {
  const distance = estimateDistanceKm(from, to);
  const travelTime = estimateHoursByMode(distance, mode);
  return {
    id: `edge_${from.id}_${to.id}_${mode}_${suffix}`,
    from: from.id,
    to: to.id,
    type: mode,
    distance_km: Number(distance.toFixed(1)),
    travel_time_hours: Number(travelTime.toFixed(2)),
    bidirectional,
    regions: dedupeStrings([from.region, to.region]),
    metadata: {
      base_price:
        mode === "flight"
          ? Number((distance * 6.5).toFixed(2))
          : Number((distance * (mode === "train" ? 1.2 : 2.8)).toFixed(2)),
    },
  };
}

function estimateDistanceKm(from: GraphNode, to: GraphNode): number {
  const avgLatRadians =
    (((from.location.lat + to.location.lat) / 2) * Math.PI) / 180;
  const latKm = (to.location.lat - from.location.lat) * 111;
  const lngKm =
    (to.location.lng - from.location.lng) * 111 * Math.cos(avgLatRadians);
  const distance = Math.sqrt(latKm * latKm + lngKm * lngKm);
  return Math.max(1, Number.isFinite(distance) ? distance : 1);
}

function estimateHoursByMode(distanceKm: number, mode: TransportMode): number {
  const speed = mode === "flight" ? 550 : mode === "train" ? 75 : 52;
  const overhead = mode === "flight" ? 1.25 : mode === "train" ? 0.35 : 0.2;
  return Math.max(0.25, distanceKm / speed + overhead);
}

function normaliseModes(modes: TransportMode[] | undefined): TransportMode[] {
  if (!modes || modes.length === 0) return ["road"];
  const seen = new Set<TransportMode>();
  const out: TransportMode[] = [];
  for (const mode of modes) {
    const normalized = normaliseTransportMode(mode);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.length > 0 ? out : ["road"];
}

function normaliseTransportMode(mode: unknown): TransportMode {
  if (mode === "road" || mode === "train" || mode === "flight") return mode;
  return "road";
}

function normaliseTravelStyle(style: unknown): TravelStyle {
  if (style === "relaxed" || style === "balanced" || style === "adventurous") {
    return style;
  }
  return "balanced";
}

function sanitizeInterests(
  interests: PreferenceTag[] | undefined,
  cities: GraphNode[],
  rng: SeededRng,
): PreferenceTag[] {
  const fromInput = dedupeStrings(interests ?? []);
  if (fromInput.length > 0) return fromInput.slice(0, 4);

  const cityTags = dedupeStrings(cities.flatMap((city) => city.tags));
  const source = cityTags.length > 0 ? cityTags : [...INTEREST_POOL];
  const count = Math.min(source.length, rng.int(1, Math.min(3, source.length)));
  return rng.shuffle(source).slice(0, count);
}

function makeClock(rng: SeededRng): string {
  const hour = String(rng.int(6, 10)).padStart(2, "0");
  const minute = String(rng.pick([0, 15, 30, 45])).padStart(2, "0");
  return `${hour}:${minute}`;
}

function makeDate(rng: SeededRng): string {
  const month = String(rng.int(1, 12)).padStart(2, "0");
  const day = String(rng.int(1, 28)).padStart(2, "0");
  return `2026-${month}-${day}`;
}

function normaliseClock(value: string | undefined, rng: SeededRng): string {
  if (typeof value === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    return value;
  }
  return makeClock(rng);
}

function normaliseDate(value: string | undefined, rng: SeededRng): string {
  if (
    typeof value === "string" &&
    /^(\d{4})-(\d{2})-(\d{2})$/.test(value) &&
    isValidDate(value)
  ) {
    return value;
  }
  return makeDate(rng);
}

function isValidDate(localDate: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const out: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.id}::${edge.from}::${edge.to}::${edge.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

function dedupeStrings(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function pickTags(
  rng: SeededRng,
  pool: readonly string[],
  min: number,
  max: number,
): string[] {
  const shuffled = rng.shuffle(pool);
  const count = clampInt(rng.int(min, Math.min(max, pool.length)), min, max);
  return shuffled.slice(0, count);
}

function jitter(rng: SeededRng, range: number): number {
  return (rng.nextFloat() * 2 - 1) * range;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toFiniteInt(value: unknown, fallback: number): number {
  const finite = toFiniteNumber(value, fallback);
  return Math.trunc(finite);
}

function hashLike(seed: string, value: number): string {
  const rng = createSeededRng(`${seed}::${value}`);
  return rng.int(0, 0xffff_ffff).toString(16).padStart(8, "0");
}

function pairKey(from: string, to: string, mode: TransportMode): string {
  return `${from}::${to}::${mode}`;
}

function safeId(value: string, fallback: string): string {
  const cleaned = value?.trim();
  return cleaned && cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeTags(tags: string[] | undefined): string[] {
  const cleaned = dedupeStrings(tags);
  return cleaned.length > 0 ? cleaned : ["heritage"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
