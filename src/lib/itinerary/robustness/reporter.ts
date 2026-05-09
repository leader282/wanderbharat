import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildReplayPayload, stableStringify } from "./serialization";
import type { CaseResult, GeneratedScenario, RobustnessProfile } from "./types";

const FAILURE_SCHEMA_VERSION = 1 as const;
const SUMMARY_SCHEMA_VERSION = 1 as const;
const MAX_TOP_VIOLATION_CODES = 10;
const MAX_SLOWEST_CASES = 10;
const MAX_FAILURE_ROWS = 10;

export interface StressFailureRecord {
  scenario: GeneratedScenario;
  caseResult: CaseResult;
}

export interface StressSlowCaseSummary {
  caseId: string;
  caseIndex: number;
  elapsedMs: number;
  status: CaseResult["status"];
  failed: boolean;
}

export interface ViolationCodeCount {
  code: string;
  count: number;
}

export interface WriteStressReportInput {
  profile: RobustnessProfile;
  seed: string;
  generatorVersion: string;
  command: string;
  casesRequested: number;
  casesRun: number;
  passedCases: number;
  failedCases: number;
  rejectedCases: number;
  slowCases: number;
  startedAtEpochMs: number;
  finishedAtEpochMs: number;
  nodeVersion: string;
  networkAttemptCount: number;
  maxFailures: number;
  topViolationCodes: ViolationCodeCount[];
  slowestCases: StressSlowCaseSummary[];
  failureRecords: StressFailureRecord[];
  outDir?: string;
  gitSha?: string;
  gitRef?: string;
  fatalErrors?: string[];
}

export interface StressSummaryJson {
  schemaVersion: typeof SUMMARY_SCHEMA_VERSION;
  profile: RobustnessProfile;
  seed: string;
  generatorVersion: string;
  outcome: "PASS" | "FAIL";
  command: string;
  cases: {
    requested: number;
    run: number;
    passed: number;
    failed: number;
    rejected: number;
    slow: number;
  };
  timestamps: {
    startedAtEpochMs: number;
    finishedAtEpochMs: number;
    startedAtIso: string;
    finishedAtIso: string;
  };
  durationMs: number;
  nodeVersion: string;
  git?: {
    sha?: string;
    ref?: string;
  };
  networkAttemptCount: number;
  failureReplayFilePaths: string[];
  replayCommands: string[];
  topViolationCodes: ViolationCodeCount[];
  slowestCases: StressSlowCaseSummary[];
  fatalErrors: string[];
}

export interface WriteStressReportResult {
  outputDir: string;
  summaryJsonPath: string;
  summaryMarkdownPath: string;
  failureReplayFilePaths: string[];
  replayCommands: string[];
  summary: StressSummaryJson;
  summaryMarkdown: string;
  outcome: "PASS" | "FAIL";
}

export async function writeStressReport(
  input: WriteStressReportInput,
): Promise<WriteStressReportResult> {
  const outputDir = resolveOutputDir(input.profile, input.seed, input.outDir);
  const failuresDir = path.join(outputDir, "failures");

  await mkdir(outputDir, { recursive: true });
  await rm(failuresDir, { recursive: true, force: true });
  await mkdir(failuresDir, { recursive: true });

  const failureReplayFilePaths: string[] = [];
  const replayCommands: string[] = [];
  const failureReplayCommandByCaseId = new Map<string, string>();
  const captureLimit = Math.max(0, Math.trunc(input.maxFailures));

  for (const failure of input.failureRecords.slice(0, captureLimit)) {
    const caseId = sanitizePathSegment(
      failure.scenario.id || `case-${failure.caseResult.caseIndex}`,
    );
    const failurePath = path.join(failuresDir, `${caseId}.json`);
    const failureDisplayPath = toDisplayPath(failurePath);
    const replayCommand = buildReplayCommand(failureDisplayPath);
    const replayPayload = buildReplayPayload(failure.scenario);

    const failurePayload = {
      schemaVersion: FAILURE_SCHEMA_VERSION,
      generatedAtIso: new Date().toISOString(),
      profile: input.profile,
      seed: input.seed,
      scenario: {
        id: failure.scenario.id,
        index: failure.scenario.index,
        title: failure.scenario.title,
        source: failure.scenario.source,
        datasetId: failure.scenario.datasetId,
        mutation: failure.scenario.mutation,
        expectation: failure.scenario.expectation,
      },
      caseResult: {
        status: failure.caseResult.status,
        elapsedMs: failure.caseResult.elapsedMs,
        expectation: failure.caseResult.expectation,
        violations: failure.caseResult.violations,
        thrownError: failure.caseResult.thrownError,
        result: failure.caseResult.result,
      },
      replayPayload,
      replayCommand,
    };

    await writeFile(failurePath, `${stableStringify(failurePayload)}\n`, "utf8");

    failureReplayFilePaths.push(failureDisplayPath);
    replayCommands.push(replayCommand);
    failureReplayCommandByCaseId.set(failure.scenario.id, replayCommand);
  }

  const fatalErrors = input.fatalErrors ?? [];
  const durationMs = Math.max(
    0,
    input.finishedAtEpochMs - input.startedAtEpochMs,
  );
  const didRunAllCases = input.casesRun >= input.casesRequested;
  const outcome: "PASS" | "FAIL" =
    input.failedCases === 0 &&
    input.networkAttemptCount === 0 &&
    fatalErrors.length === 0 &&
    didRunAllCases
      ? "PASS"
      : "FAIL";

  const summary: StressSummaryJson = {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    profile: input.profile,
    seed: input.seed,
    generatorVersion: input.generatorVersion,
    outcome,
    command: input.command,
    cases: {
      requested: input.casesRequested,
      run: input.casesRun,
      passed: input.passedCases,
      failed: input.failedCases,
      rejected: input.rejectedCases,
      slow: input.slowCases,
    },
    timestamps: {
      startedAtEpochMs: input.startedAtEpochMs,
      finishedAtEpochMs: input.finishedAtEpochMs,
      startedAtIso: new Date(input.startedAtEpochMs).toISOString(),
      finishedAtIso: new Date(input.finishedAtEpochMs).toISOString(),
    },
    durationMs,
    nodeVersion: input.nodeVersion,
    git:
      input.gitSha || input.gitRef
        ? {
            ...(input.gitSha ? { sha: input.gitSha } : {}),
            ...(input.gitRef ? { ref: input.gitRef } : {}),
          }
        : undefined,
    networkAttemptCount: input.networkAttemptCount,
    failureReplayFilePaths,
    replayCommands,
    topViolationCodes: input.topViolationCodes.slice(0, MAX_TOP_VIOLATION_CODES),
    slowestCases: input.slowestCases.slice(0, MAX_SLOWEST_CASES),
    fatalErrors,
  };

  const summaryJsonPath = path.join(outputDir, "summary.json");
  const summaryMarkdownPath = path.join(outputDir, "summary.md");

  const summaryMarkdown = renderSummaryMarkdown({
    summary,
    failureRecords: input.failureRecords,
    failureReplayCommandByCaseId,
    outputDir,
  });

  await writeFile(summaryJsonPath, `${stableStringify(summary)}\n`, "utf8");
  await writeFile(summaryMarkdownPath, summaryMarkdown, "utf8");

  return {
    outputDir,
    summaryJsonPath,
    summaryMarkdownPath,
    failureReplayFilePaths,
    replayCommands,
    summary,
    summaryMarkdown,
    outcome,
  };
}

function resolveOutputDir(
  profile: RobustnessProfile,
  seed: string,
  outDir: string | undefined,
): string {
  if (outDir && outDir.trim().length > 0) {
    return path.resolve(outDir.trim());
  }

  const safeSeed = sanitizePathSegment(seed);
  return path.resolve(
    process.cwd(),
    "reports",
    "itinerary-robustness",
    `${profile}-${safeSeed}`,
  );
}

function renderSummaryMarkdown(args: {
  summary: StressSummaryJson;
  failureRecords: StressFailureRecord[];
  failureReplayCommandByCaseId: Map<string, string>;
  outputDir: string;
}): string {
  const { summary, failureRecords, failureReplayCommandByCaseId, outputDir } = args;
  const lines: string[] = [];

  lines.push("# Itinerary Stress Summary");
  lines.push("");
  lines.push(`- **Result:** ${summary.outcome}`);
  lines.push(`- **Profile:** ${summary.profile}`);
  lines.push(`- **Seed:** \`${summary.seed}\``);
  lines.push(`- **Generator version:** \`${summary.generatorVersion}\``);
  lines.push(`- **Node:** \`${summary.nodeVersion}\``);
  lines.push(`- **Duration:** ${summary.durationMs} ms`);
  lines.push(`- **Network attempts:** ${summary.networkAttemptCount}`);
  if (summary.git?.sha || summary.git?.ref) {
    lines.push(
      `- **Git:** sha=\`${summary.git?.sha ?? "n/a"}\` ref=\`${summary.git?.ref ?? "n/a"}\``,
    );
  }
  lines.push("");

  lines.push("## Cases");
  lines.push("");
  lines.push(`- Requested: ${summary.cases.requested}`);
  lines.push(`- Run: ${summary.cases.run}`);
  lines.push(`- Passed: ${summary.cases.passed}`);
  lines.push(`- Failed: ${summary.cases.failed}`);
  lines.push(`- Rejected: ${summary.cases.rejected}`);
  lines.push(`- Slow: ${summary.cases.slow}`);
  lines.push("");

  lines.push("## Command Used");
  lines.push("");
  lines.push("```bash");
  lines.push(summary.command);
  lines.push("```");
  lines.push("");

  lines.push("## Replay Commands");
  lines.push("");
  if (summary.replayCommands.length === 0) {
    lines.push("- No replay files generated.");
  } else {
    for (const command of summary.replayCommands) {
      lines.push(`- \`${command}\``);
    }
  }
  lines.push("");

  lines.push("## Top Failures");
  lines.push("");
  lines.push("| Case | Status | Elapsed (ms) | Errors | Warnings | Top Codes |");
  lines.push("| --- | --- | ---: | ---: | ---: | --- |");
  const failureRows = failureRecords
    .map((record) => {
      const errors = record.caseResult.violations.filter(
        (violation) => violation.severity === "error",
      ).length;
      const warnings = record.caseResult.violations.length - errors;
      const topCodes = summariseViolationCodes(record.caseResult);
      return {
        caseId: record.scenario.id,
        status: record.caseResult.status,
        elapsedMs: record.caseResult.elapsedMs,
        errors,
        warnings,
        topCodes,
      };
    })
    .sort((left, right) => {
      if (right.errors !== left.errors) return right.errors - left.errors;
      if (right.warnings !== left.warnings) return right.warnings - left.warnings;
      return right.elapsedMs - left.elapsedMs;
    })
    .slice(0, MAX_FAILURE_ROWS);

  if (failureRows.length === 0) {
    lines.push("| _(none)_ | - | - | - | - | - |");
  } else {
    for (const row of failureRows) {
      lines.push(
        `| ${escapeMarkdownCell(row.caseId)} | ${row.status} | ${row.elapsedMs} | ${row.errors} | ${row.warnings} | ${escapeMarkdownCell(row.topCodes)} |`,
      );
      const replayCommand = failureReplayCommandByCaseId.get(row.caseId);
      if (replayCommand) {
        lines.push(`| ↳ replay | command | - | - | - | \`${replayCommand}\` |`);
      }
    }
  }
  lines.push("");

  lines.push("## Slowest Cases");
  lines.push("");
  lines.push("| Case | Index | Elapsed (ms) | Status | Failed |");
  lines.push("| --- | ---: | ---: | --- | --- |");
  if (summary.slowestCases.length === 0) {
    lines.push("| _(none)_ | - | - | - | - |");
  } else {
    for (const slow of summary.slowestCases) {
      lines.push(
        `| ${escapeMarkdownCell(slow.caseId)} | ${slow.caseIndex} | ${slow.elapsedMs} | ${slow.status} | ${slow.failed ? "yes" : "no"} |`,
      );
    }
  }
  lines.push("");

  if (summary.topViolationCodes.length > 0) {
    lines.push("## Top Violation Codes");
    lines.push("");
    for (const violation of summary.topViolationCodes) {
      lines.push(`- \`${violation.code}\`: ${violation.count}`);
    }
    lines.push("");
  }

  if (summary.fatalErrors.length > 0) {
    lines.push("## Fatal Errors");
    lines.push("");
    for (const error of summary.fatalErrors) {
      lines.push(`- ${error}`);
    }
    lines.push("");
  }

  lines.push("## Artifacts");
  lines.push("");
  lines.push(`- Output directory: \`${toDisplayPath(outputDir)}\``);
  lines.push(`- Summary JSON: \`${toDisplayPath(path.join(outputDir, "summary.json"))}\``);
  lines.push(`- Summary Markdown: \`${toDisplayPath(path.join(outputDir, "summary.md"))}\``);

  return `${lines.join("\n")}\n`;
}

function summariseViolationCodes(caseResult: CaseResult): string {
  if (caseResult.violations.length === 0) return "-";
  const counts = new Map<string, number>();
  for (const violation of caseResult.violations) {
    counts.set(violation.code, (counts.get(violation.code) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 2)
    .map(([code, count]) => `${code} (${count})`)
    .join(", ");
}

function sanitizePathSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!normalized) return "seed";
  return normalized.slice(0, 120);
}

function buildReplayCommand(failurePath: string): string {
  return `npx tsx scripts/runItineraryStress.ts --profile=replay --file=${quoteForShell(failurePath)}`;
}

function quoteForShell(value: string): string {
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function toDisplayPath(targetPath: string): string {
  const relativePath = path.relative(process.cwd(), targetPath);
  if (!relativePath || relativePath.startsWith("..")) {
    return targetPath;
  }
  return relativePath;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br/>");
}
