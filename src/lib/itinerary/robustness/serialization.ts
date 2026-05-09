import type { EngineContext } from "@/lib/itinerary/engine";
import type { GraphNode } from "@/types/domain";

import { createSeededRng, deriveSeed } from "./rng";
import type {
  GeneratedScenario,
  SerializableAttractionsByCity,
  SerializableEngineContext,
} from "./types";

const DETERMINISTIC_NOW_BASE = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
const DETERMINISTIC_NOW_RANGE_MS = 365 * 24 * 60 * 60 * 1000;
const REPLAY_SCHEMA_VERSION = 1 as const;

export interface ReplayPayload {
  schema_version: typeof REPLAY_SCHEMA_VERSION;
  replay: {
    profile: GeneratedScenario["profile"];
    seed: string;
    case_index: number;
    case_seed: string;
    scenario_id: string;
  };
  scenario: {
    id: string;
    title: string;
    source: GeneratedScenario["source"];
    dataset_id?: string;
    mutation?: string;
    expectation: GeneratedScenario["expectation"];
    input: GeneratedScenario["input"];
    context: SerializableEngineContext;
  };
}

export function deterministicNowFromSeed(seed: string): number {
  const rng = createSeededRng(`${seed}::now`);
  return DETERMINISTIC_NOW_BASE + rng.int(0, DETERMINISTIC_NOW_RANGE_MS - 1);
}

export function createDeterministicMakeId(seed: string): (prefix: string) => string {
  const rng = createSeededRng(`${seed}::make-id`);
  let counter = 0;

  return (prefix: string): string => {
    const safePrefix = prefix.trim().length > 0 ? prefix.trim() : "id";
    const ordinal = counter.toString(36).padStart(2, "0");
    counter += 1;
    const entropy = rng.int(0, 0xffff_ffff).toString(16).padStart(8, "0");
    return `${safePrefix}_${ordinal}_${entropy}`;
  };
}

export function toAttractionsByCityMap(
  value:
    | SerializableAttractionsByCity
    | Map<string, GraphNode[]>
    | undefined,
): Map<string, GraphNode[]> | undefined {
  if (!value) return undefined;

  const out = new Map<string, GraphNode[]>();

  if (value instanceof Map) {
    for (const [cityId, attractions] of value.entries()) {
      if (!cityId || !Array.isArray(attractions)) continue;
      out.set(cityId, attractions.map((attraction) => structuredClone(attraction)));
    }
    return out.size > 0 ? out : undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (Array.isArray(entry)) {
        const [cityId, attractions] = entry;
        if (!cityId || !Array.isArray(attractions)) continue;
        out.set(cityId, attractions.map((attraction) => structuredClone(attraction)));
        continue;
      }
      if (!isRecord(entry)) continue;
      const candidate = entry as Record<string, unknown>;
      const cityId =
        typeof candidate.cityId === "string"
          ? candidate.cityId
          : typeof candidate.city_id === "string"
            ? candidate.city_id
            : undefined;
      const attractions =
        Array.isArray(candidate.attractions) &&
        candidate.attractions.every(isGraphNodeLike)
          ? (candidate.attractions as GraphNode[])
          : undefined;
      if (!cityId || !attractions) continue;
      out.set(cityId, attractions.map((attraction) => structuredClone(attraction)));
    }
    return out.size > 0 ? out : undefined;
  }

  for (const [cityId, attractions] of Object.entries(value)) {
    if (!cityId || !Array.isArray(attractions)) continue;
    out.set(
      cityId,
      attractions
        .filter(isGraphNodeLike)
        .map((attraction) => structuredClone(attraction)),
    );
  }
  return out.size > 0 ? out : undefined;
}

export function toAttractionsByCityRecord(
  value:
    | SerializableAttractionsByCity
    | Map<string, GraphNode[]>
    | undefined,
): Record<string, GraphNode[]> | undefined {
  const map = toAttractionsByCityMap(value);
  if (!map || map.size === 0) return undefined;

  const out: Record<string, GraphNode[]> = {};
  for (const [cityId, attractions] of Array.from(map.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    out[cityId] = attractions;
  }
  return out;
}

export function toEngineContext(
  serializable: SerializableEngineContext,
  deterministicSeed: string,
): EngineContext {
  const nowEpochMs =
    serializable.nowEpochMs ?? deterministicNowFromSeed(deterministicSeed);
  const makeIdSeed =
    serializable.makeIdSeed ?? `${deterministicSeed}::make-id`;

  return {
    nodes: serializable.nodes.map((node) => structuredClone(node)),
    edges: serializable.edges.map((edge) => structuredClone(edge)),
    attractionsByCity: toAttractionsByCityMap(serializable.attractionsByCity),
    now: () => nowEpochMs,
    makeId: createDeterministicMakeId(makeIdSeed),
    tuningOverride: serializable.tuningOverride,
  };
}

export function scenarioToEngineContext(scenario: GeneratedScenario): EngineContext {
  const caseSeed = deriveSeed(scenario.seed, scenario.index);
  return toEngineContext(scenario.context, caseSeed);
}

export function buildReplayPayload(scenario: GeneratedScenario): ReplayPayload {
  const caseSeed = deriveSeed(scenario.seed, scenario.index);
  const nowEpochMs =
    scenario.context.nowEpochMs ?? deterministicNowFromSeed(caseSeed);
  const makeIdSeed =
    scenario.context.makeIdSeed ?? `${caseSeed}::make-id`;

  return {
    schema_version: REPLAY_SCHEMA_VERSION,
    replay: {
      profile: scenario.profile,
      seed: scenario.seed,
      case_index: scenario.index,
      case_seed: caseSeed,
      scenario_id: scenario.id,
    },
    scenario: {
      id: scenario.id,
      title: scenario.title,
      source: scenario.source,
      dataset_id: scenario.datasetId,
      mutation: scenario.mutation,
      expectation: scenario.expectation,
      input: structuredClone(scenario.input),
      context: {
        nodes: scenario.context.nodes.map((node) => structuredClone(node)),
        edges: scenario.context.edges.map((edge) => structuredClone(edge)),
        attractionsByCity: toAttractionsByCityRecord(
          scenario.context.attractionsByCity,
        ),
        nowEpochMs,
        makeIdSeed,
        tuningOverride: scenario.context.tuningOverride,
      },
    },
  };
}

export function replayPayloadToJson(scenario: GeneratedScenario): string {
  return stableStringify(buildReplayPayload(scenario));
}

export function stableStringify(value: unknown, space = 2): string {
  const sorted = sortForStableStringify(value);
  const encoded = JSON.stringify(sorted, null, space);
  return encoded ?? "null";
}

function sortForStableStringify(value: unknown): unknown {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sortForStableStringify(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  if (value instanceof Map) {
    const orderedEntries = Array.from(value.entries()).sort(([a], [b]) =>
      String(a).localeCompare(String(b)),
    );
    const out: Record<string, unknown> = {};
    for (const [key, entry] of orderedEntries) {
      out[String(key)] = sortForStableStringify(entry);
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = sortForStableStringify(value[key]);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGraphNodeLike(value: unknown): value is GraphNode {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    isRecord(value.location)
  );
}
