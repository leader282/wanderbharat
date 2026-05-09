import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

import type { EngineDependencies } from "@/lib/itinerary/engine";
import { installOfflineNetworkGuard } from "@/lib/itinerary/robustness/offlineNetworkGuard";
import {
  writeStressReport,
  type StressFailureRecord,
  type StressSlowCaseSummary,
  type ViolationCodeCount,
} from "@/lib/itinerary/robustness/reporter";
import type { ReplayPayload } from "@/lib/itinerary/robustness/serialization";
import type { LoadedScenarioDataset } from "@/lib/itinerary/robustness/scenarios";
import type { InvariantViolation } from "@/lib/itinerary/robustness/types";
import type {
  CaseResult,
  GeneratedScenario,
  RobustnessProfile,
} from "@/lib/itinerary/robustness/types";
import { validateEngineResult } from "@/lib/itinerary/robustness/invariants";
import type {
  AttractionAdmissionRule,
  AttractionOpeningHours,
  GraphNode,
} from "@/types/domain";

import { parseArgs } from "./_cli";
import type { SeedDataset } from "./data";

const SAFE_STUB_VALUES = new Set([
  "ci-stub",
  "offline-stub",
  "offline-disabled",
]);
const SENSITIVE_ENV_KEYS = [
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "FIREBASE_SERVICE_ACCOUNT_PATH",
  "LITEAPI_API_KEY",
  "GOOGLE_MAPS_API_KEY",
] as const;

const DEFAULT_GENERATOR_VERSION = "itinerary-stress-checkpoint-b-v1";
const MAX_SLOWEST_CASES = 10;

interface StressRunConfig {
  profile: RobustnessProfile;
  seed: string;
  cases: number;
  outDir?: string;
  maxFailures: number;
  slowMs: number;
  totalTimeoutMs: number;
  replayFile?: string;
  command: string;
  generatorVersion: string;
}

interface StressRuntime {
  generateItinerary: (typeof import("@/lib/itinerary/engine"))["generateItinerary"];
  scenarioToEngineContext: (typeof import("@/lib/itinerary/robustness/serialization"))["scenarioToEngineContext"];
  generateScenario: (typeof import("@/lib/itinerary/robustness/scenarios"))["generateScenario"];
  makeOfflineResolver: (typeof import("@/lib/itinerary/robustness/scenarios"))["makeOfflineResolver"];
  validateEngineResult: (typeof import("@/lib/itinerary/robustness/invariants"))["validateEngineResult"];
  listAvailableRegions: (typeof import("./data"))["listAvailableRegions"];
  loadDataset: (typeof import("./data"))["loadDataset"];
}

async function main(): Promise<number> {
  process.env.LITEAPI_ENABLED = "false";
  process.env.NEXT_TELEMETRY_DISABLED = "1";

  const cliArgs = parseArgs(process.argv.slice(2));
  const config = resolveRunConfig(cliArgs);

  const startedAtEpochMs = Date.now();
  const offlineGuard = installOfflineNetworkGuard();

  let casesRun = 0;
  let passedCases = 0;
  let failedCases = 0;
  let rejectedCases = 0;
  let slowCases = 0;

  const failureRecords: StressFailureRecord[] = [];
  const slowestCases: StressSlowCaseSummary[] = [];
  const violationCounts = new Map<string, number>();
  const fatalErrors: string[] = [];

  try {
    assertSensitiveEnvGuard();

    const runtime = await loadStressRuntime();
    const offlineResolver = runtime.makeOfflineResolver();
    const replayScenario =
      config.profile === "replay"
        ? await loadReplayScenario(config.replayFile ?? "")
        : undefined;
    const datasets =
      config.profile === "replay" ? [] : await loadShippedSeedDatasets(runtime);

    if (replayScenario) {
      config.seed = replayScenario.seed;
    }

    for (let caseIndex = 0; caseIndex < config.cases; caseIndex += 1) {
      if (Date.now() - startedAtEpochMs > config.totalTimeoutMs) {
        fatalErrors.push(
          `Total timeout of ${config.totalTimeoutMs}ms exceeded after ${casesRun} case(s).`,
        );
        break;
      }

      const scenario =
        replayScenario ??
        runtime.generateScenario({
          profile: config.profile,
          seed: config.seed,
          caseIndex,
          datasets,
        });

      const caseResult = await executeCase(scenario, offlineResolver, runtime);
      const failed = isCaseFailure(caseResult);
      casesRun += 1;

      if (caseResult.status === "rejected") {
        rejectedCases += 1;
      }
      if (caseResult.elapsedMs >= config.slowMs) {
        slowCases += 1;
      }

      if (failed) {
        failedCases += 1;
        if (failureRecords.length < config.maxFailures) {
          failureRecords.push({ scenario, caseResult });
        }
        for (const violation of caseResult.violations) {
          if (violation.severity !== "error") continue;
          violationCounts.set(
            violation.code,
            (violationCounts.get(violation.code) ?? 0) + 1,
          );
        }
      } else {
        passedCases += 1;
      }

      updateSlowestCases(
        slowestCases,
        {
          caseId: scenario.id,
          caseIndex: scenario.index,
          elapsedMs: caseResult.elapsedMs,
          status: caseResult.status,
          failed,
        },
        MAX_SLOWEST_CASES,
      );

      if (replayScenario) {
        break;
      }
    }
  } catch (error) {
    fatalErrors.push(toErrorMessage(error));
  }

  const finishedAtEpochMs = Date.now();
  const networkAttemptCount = offlineGuard.getAttemptCount();
  offlineGuard.restore();

  const report = await writeStressReport({
    profile: config.profile,
    seed: config.seed,
    generatorVersion: config.generatorVersion,
    command: config.command,
    casesRequested: config.cases,
    casesRun,
    passedCases,
    failedCases,
    rejectedCases,
    slowCases,
    startedAtEpochMs,
    finishedAtEpochMs,
    nodeVersion: process.version,
    networkAttemptCount,
    maxFailures: config.maxFailures,
    topViolationCodes: sortTopViolationCodes(violationCounts),
    slowestCases,
    failureRecords,
    outDir: config.outDir,
    gitSha: process.env.GITHUB_SHA,
    gitRef: process.env.GITHUB_REF ?? process.env.GITHUB_REF_NAME,
    fatalErrors,
  });

  await appendToGitHubStepSummary(report.summaryMarkdown);

  console.log(`Summary JSON: ${report.summaryJsonPath}`);
  console.log(`Summary Markdown: ${report.summaryMarkdownPath}`);

  return report.outcome === "PASS" ? 0 : 1;
}

async function executeCase(
  scenario: GeneratedScenario,
  offlineResolver: NonNullable<EngineDependencies["resolveTravelMatrix"]>,
  runtime: StressRuntime,
): Promise<CaseResult> {
  const startedAt = Date.now();

  try {
    const ctx = runtime.scenarioToEngineContext(scenario);
    const result = await runtime.generateItinerary(scenario.input, ctx, {
      resolveTravelMatrix: offlineResolver,
    });
    const elapsedMs = Date.now() - startedAt;
    const violations = runtime.validateEngineResult(
      scenario,
      result,
      elapsedMs,
    );

    return {
      scenarioId: scenario.id,
      caseIndex: scenario.index,
      expectation: scenario.expectation,
      elapsedMs,
      status: result.ok ? "ok" : "rejected",
      result,
      violations,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const thrown = serializeError(error);
    const violations: InvariantViolation[] = [
      {
        code: "engine.throw.unhandled",
        message:
          "Itinerary generation threw an unexpected error instead of returning a structured result.",
        severity: "error",
        actual: {
          name: thrown.name,
          message: thrown.message,
        },
      },
    ];

    return {
      scenarioId: scenario.id,
      caseIndex: scenario.index,
      expectation: scenario.expectation,
      elapsedMs,
      status: "threw",
      thrownError: thrown,
      violations,
    };
  }
}

async function loadStressRuntime(): Promise<StressRuntime> {
  const [engine, serialization, scenarios, invariants, data] =
    await Promise.all([
      import("@/lib/itinerary/engine"),
      import("@/lib/itinerary/robustness/serialization"),
      import("@/lib/itinerary/robustness/scenarios"),
      import("@/lib/itinerary/robustness/invariants"),
      import("./data"),
    ]);

  return {
    generateItinerary: engine.generateItinerary,
    scenarioToEngineContext: serialization.scenarioToEngineContext,
    generateScenario: scenarios.generateScenario,
    makeOfflineResolver: scenarios.makeOfflineResolver,
    validateEngineResult: invariants.validateEngineResult,
    listAvailableRegions: data.listAvailableRegions,
    loadDataset: data.loadDataset,
  };
}

async function loadShippedSeedDatasets(
  runtime: StressRuntime,
): Promise<LoadedScenarioDataset[]> {
  const slugs = runtime.listAvailableRegions();
  const datasets: LoadedScenarioDataset[] = [];

  for (const slug of slugs) {
    const dataset = await runtime.loadDataset(slug);
    datasets.push(toLoadedScenarioDataset(dataset));
  }

  return datasets;
}

function toLoadedScenarioDataset(dataset: SeedDataset): LoadedScenarioDataset {
  const cityNodes = dataset.cities().map((node) => structuredClone(node));
  const attractionNodes = (dataset.attractions?.() ?? []).map((node) =>
    structuredClone(node),
  );
  const edgeRows = (dataset.edges?.() ?? []).map((edge) =>
    structuredClone(edge),
  );
  const openingHours = (dataset.attractionHours?.() ?? []).map((row) =>
    structuredClone(row),
  );
  const admissionRules = (dataset.attractionAdmissions?.() ?? []).map((row) =>
    structuredClone(row),
  );

  const hydratedAttractions = hydrateAttractions(
    attractionNodes,
    openingHours,
    admissionRules,
  );
  const attractionsByCity = buildAttractionsByCity(hydratedAttractions);

  return {
    id: dataset.region,
    nodes: [...cityNodes, ...hydratedAttractions],
    edges: edgeRows,
    attractionsByCity,
  };
}

function hydrateAttractions(
  attractions: GraphNode[],
  openingHours: AttractionOpeningHours[],
  admissionRules: AttractionAdmissionRule[],
): GraphNode[] {
  const openingByAttractionId = new Map<string, AttractionOpeningHours>();
  for (const row of openingHours) {
    openingByAttractionId.set(row.attraction_id, structuredClone(row));
  }

  const admissionsByAttractionId = new Map<string, AttractionAdmissionRule[]>();
  for (const rule of admissionRules) {
    const bucket = admissionsByAttractionId.get(rule.attraction_node_id) ?? [];
    bucket.push(structuredClone(rule));
    admissionsByAttractionId.set(rule.attraction_node_id, bucket);
  }

  return attractions.map((attraction) => {
    const opening = openingByAttractionId.get(attraction.id);
    const admissions = admissionsByAttractionId.get(attraction.id);
    return {
      ...attraction,
      metadata: {
        ...attraction.metadata,
        ...(opening ? { opening_hours: opening } : {}),
        ...(admissions && admissions.length > 0
          ? { admission_rules: admissions }
          : {}),
      },
    };
  });
}

function buildAttractionsByCity(
  attractions: GraphNode[],
): Record<string, GraphNode[]> {
  const out: Record<string, GraphNode[]> = {};
  for (const attraction of attractions) {
    const cityId = attraction.parent_node_id;
    if (!cityId) continue;
    const bucket = out[cityId] ?? [];
    bucket.push(attraction);
    out[cityId] = bucket;
  }
  return out;
}

async function loadReplayScenario(
  filePath: string,
): Promise<GeneratedScenario> {
  if (!filePath.trim()) {
    throw new Error('Replay profile requires --file="<failure-json>".');
  }

  const absolutePath = path.resolve(filePath);
  const raw = await readFile(absolutePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Could not parse replay file ${absolutePath}: ${toErrorMessage(error)}`,
    );
  }

  const replayPayload = extractReplayPayload(parsed);
  if (!replayPayload) {
    throw new Error(
      `Replay file ${absolutePath} is missing a replay payload and cannot be replayed.`,
    );
  }

  return replayPayloadToScenario(replayPayload);
}

function replayPayloadToScenario(payload: ReplayPayload): GeneratedScenario {
  return {
    id: payload.scenario.id,
    index: payload.replay.case_index,
    profile: "replay",
    seed: payload.replay.seed,
    title: payload.scenario.title,
    source: payload.scenario.source,
    datasetId: payload.scenario.dataset_id,
    mutation: payload.scenario.mutation,
    expectation: payload.scenario.expectation,
    input: structuredClone(payload.scenario.input),
    context: structuredClone(payload.scenario.context),
  };
}

function extractReplayPayload(value: unknown): ReplayPayload | undefined {
  if (!isRecord(value)) return undefined;

  const direct = value.replayPayload;
  if (isReplayPayload(direct)) return direct;

  const snakeCase = value.replay_payload;
  if (isReplayPayload(snakeCase)) return snakeCase;

  if (isRecord(value.replay) && isRecord(value.scenario)) {
    const legacyPayload: ReplayPayload = {
      schema_version: 1,
      replay: value.replay as ReplayPayload["replay"],
      scenario: value.scenario as ReplayPayload["scenario"],
    };
    if (isReplayPayload(legacyPayload)) {
      return legacyPayload;
    }
  }

  return undefined;
}

function isReplayPayload(value: unknown): value is ReplayPayload {
  if (!isRecord(value)) return false;
  if (!isRecord(value.replay) || !isRecord(value.scenario)) return false;
  return (
    typeof value.replay.seed === "string" &&
    typeof value.replay.case_index === "number" &&
    typeof value.scenario.id === "string" &&
    typeof value.scenario.title === "string" &&
    isRecord(value.scenario.context)
  );
}

function resolveRunConfig(
  args: Record<string, string | boolean>,
): StressRunConfig {
  const profileRaw =
    readOption(args, "profile", "WB_STRESS_PROFILE") ?? "quick";
  if (
    profileRaw !== "quick" &&
    profileRaw !== "heavy" &&
    profileRaw !== "replay"
  ) {
    throw new Error(`Unsupported profile "${profileRaw}".`);
  }
  const profile = profileRaw;

  const defaults = getProfileDefaults(profile);
  const replayFile = readCliOnlyOption(args, "file");
  const seedOverride = readOption(args, "seed", "WB_STRESS_SEED");
  const casesOverride = readOption(args, "cases", "WB_STRESS_CASES");
  const outDir = readOption(args, "out-dir", "WB_STRESS_OUT_DIR");
  const maxFailuresOverride = readOption(
    args,
    "max-failures",
    "WB_STRESS_MAX_FAILURES",
  );
  const slowMsOverride = readOption(args, "slow-ms", "WB_STRESS_SLOW_MS");
  const totalTimeoutMsOverride = readOption(
    args,
    "total-timeout-ms",
    "WB_STRESS_TOTAL_TIMEOUT_MS",
  );

  const seed = seedOverride ?? defaults.seed;
  const cases =
    profile === "replay"
      ? 1
      : parseIntegerOption(casesOverride, defaults.cases, "cases", { min: 1 });
  const maxFailures = parseIntegerOption(
    maxFailuresOverride,
    defaults.maxFailures,
    "max-failures",
    { min: 0 },
  );
  const slowMs = parseIntegerOption(
    slowMsOverride,
    defaults.slowMs,
    "slow-ms",
    {
      min: 1,
    },
  );
  const totalTimeoutMs = parseIntegerOption(
    totalTimeoutMsOverride,
    defaults.totalTimeoutMs,
    "total-timeout-ms",
    { min: 1 },
  );

  if (profile === "replay" && !replayFile) {
    throw new Error('Replay profile requires --file="<failure-json>".');
  }

  return {
    profile,
    seed,
    cases,
    outDir: outDir?.trim() || undefined,
    maxFailures,
    slowMs,
    totalTimeoutMs,
    replayFile: replayFile?.trim() || undefined,
    command: buildCommandString(process.argv.slice(2)),
    generatorVersion:
      process.env.WB_STRESS_GENERATOR_VERSION ??
      `${DEFAULT_GENERATOR_VERSION}-${process.env.npm_package_version ?? "dev"}`,
  };
}

function getProfileDefaults(profile: RobustnessProfile): {
  seed: string;
  cases: number;
  maxFailures: number;
  slowMs: number;
  totalTimeoutMs: number;
} {
  if (profile === "heavy") {
    return {
      seed: `heavy-${process.env.GITHUB_RUN_ID ?? todayIsoDate()}`,
      cases: 2000,
      maxFailures: 25,
      slowMs: 2000,
      totalTimeoutMs: 2_700_000,
    };
  }

  if (profile === "replay") {
    return {
      seed: "replay",
      cases: 1,
      maxFailures: 1,
      slowMs: 750,
      totalTimeoutMs: 120_000,
    };
  }

  return {
    seed: "wb-ci-quick-v1",
    cases: 150,
    maxFailures: 10,
    slowMs: 750,
    totalTimeoutMs: 120_000,
  };
}

function assertSensitiveEnvGuard(): void {
  const blockedKeys = SENSITIVE_ENV_KEYS.filter((key) =>
    hasSensitiveValue(process.env[key]),
  );
  if (blockedKeys.length === 0) return;

  throw new Error(
    `Sensitive env vars are set for offline stress runs: ${blockedKeys.join(", ")}. ` +
      `Unset them or replace with approved stubs (${Array.from(SAFE_STUB_VALUES).join(", ")}).`,
  );
}

function hasSensitiveValue(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !SAFE_STUB_VALUES.has(trimmed.toLowerCase());
}

function isCaseFailure(caseResult: CaseResult): boolean {
  if (caseResult.status === "threw") return true;
  return caseResult.violations.some(
    (violation) => violation.severity === "error",
  );
}

function updateSlowestCases(
  cases: StressSlowCaseSummary[],
  nextCase: StressSlowCaseSummary,
  limit: number,
): void {
  cases.push(nextCase);
  cases.sort((left, right) => {
    if (right.elapsedMs !== left.elapsedMs) {
      return right.elapsedMs - left.elapsedMs;
    }
    return left.caseId.localeCompare(right.caseId);
  });
  if (cases.length > limit) {
    cases.length = limit;
  }
}

function sortTopViolationCodes(
  violationCounts: Map<string, number>,
): ViolationCodeCount[] {
  return Array.from(violationCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .map(([code, count]) => ({ code, count }));
}

async function appendToGitHubStepSummary(markdown: string): Promise<void> {
  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!stepSummaryPath) return;
  await appendFile(stepSummaryPath, `\n${markdown}\n`, "utf8");
}

function serializeError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function parseIntegerOption(
  rawValue: string | undefined,
  fallback: number,
  optionName: string,
  bounds: { min?: number; max?: number } = {},
): number {
  if (rawValue === undefined) return fallback;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed)) {
    throw new Error(
      `--${optionName} must be an integer. Received "${rawValue}".`,
    );
  }
  if (bounds.min !== undefined && parsed < bounds.min) {
    throw new Error(
      `--${optionName} must be >= ${bounds.min}. Received "${rawValue}".`,
    );
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    throw new Error(
      `--${optionName} must be <= ${bounds.max}. Received "${rawValue}".`,
    );
  }
  return parsed;
}

function readOption(
  args: Record<string, string | boolean>,
  key: string,
  envKey: string,
): string | undefined {
  const fromCli = args[key];
  if (typeof fromCli === "boolean") {
    throw new Error(`--${key} requires a value.`);
  }
  if (typeof fromCli === "string" && fromCli.trim().length > 0) {
    return fromCli.trim();
  }

  const fromEnv = process.env[envKey];
  if (!fromEnv || fromEnv.trim().length === 0) {
    return undefined;
  }
  return fromEnv.trim();
}

function readCliOnlyOption(
  args: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = args[key];
  if (typeof value === "boolean") {
    throw new Error(`--${key} requires a value.`);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function buildCommandString(argv: string[]): string {
  const suffix =
    argv.length === 0
      ? ""
      : ` ${argv.map((arg) => quoteShellArg(arg)).join(" ")}`;
  return `npx tsx scripts/runItineraryStress.ts${suffix}`;
}

function quoteShellArg(value: string): string {
  if (/^[a-zA-Z0-9._:/=-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

void main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  });
