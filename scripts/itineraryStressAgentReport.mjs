#!/usr/bin/env node

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const reportsDir = path.resolve(
  readArg("reports-dir", "reports/itinerary-robustness"),
);
const promptFile = args["prompt-file"];
const commentFile = args["comment-file"];
const replayScriptFile = args["replay-script-file"];
const githubOutputFile = args["github-output"];
const context = readArg("context", "itinerary stress failure");
const reportPath = readArg(
  "report-path",
  "docs/testing/itinerary-robustness/agent-reports/stress-agent-report.md",
);
const agentAnalysisFile = args["agent-analysis-file"];

const summaries = findFiles(reportsDir, "summary.json")
  .map((summaryPath) => loadSummary(summaryPath))
  .filter(Boolean)
  .sort(
    (left, right) =>
      right.summary.timestamps.finishedAtEpochMs -
      left.summary.timestamps.finishedAtEpochMs,
  );
const failing = summaries.find((entry) => entry.summary.outcome === "FAIL");

if (!failing) {
  writeOutputs({
    has_failure_report: "false",
  });
  writeOptionalFile(promptFile, renderNoFailurePrompt(context));
  writeOptionalFile(commentFile, renderNoFailureComment(context));
  writeOptionalFile(
    replayScriptFile,
    "#!/usr/bin/env bash\nset -euo pipefail\n",
  );
  process.exit(0);
}

const failureFiles = findFiles(path.join(failing.runDir, "failures"), ".json")
  .sort((a, b) => a.localeCompare(b))
  .slice(0, 25);
const replayCommands = failing.summary.replayCommands ?? [];
const summaryMarkdown = readOptional(path.join(failing.runDir, "summary.md"));
const agentAnalysis = agentAnalysisFile ? readOptional(agentAnalysisFile) : "";
const replayScript = renderReplayScript(replayCommands);

writeOptionalFile(
  promptFile,
  renderPrompt({
    context,
    reportPath,
    failing,
    failureFiles,
    summaryMarkdown,
  }),
);
writeOptionalFile(
  commentFile,
  renderComment({
    context,
    failing,
    failureFiles,
    summaryMarkdown,
    agentAnalysis,
  }),
);
writeOptionalFile(replayScriptFile, replayScript);
writeOutputs({
  has_failure_report: "true",
  report_dir: toPosixPath(
    path.relative(process.cwd(), failing.runDir) || failing.runDir,
  ),
  summary_json: toPosixPath(
    path.relative(process.cwd(), failing.summaryPath) || failing.summaryPath,
  ),
  summary_md: toPosixPath(
    path.relative(process.cwd(), path.join(failing.runDir, "summary.md")) ||
      path.join(failing.runDir, "summary.md"),
  ),
  profile: String(failing.summary.profile),
  seed: String(failing.summary.seed),
  cases_run: String(failing.summary.cases.run),
  cases_failed: String(failing.summary.cases.failed),
});

function renderPrompt(input) {
  const { context, reportPath, failing, failureFiles, summaryMarkdown } = input;
  const summary = failing.summary;
  const replayList =
    summary.replayCommands?.length > 0
      ? summary.replayCommands.map((command) => `- ${command}`).join("\n")
      : "- No replay commands were generated.";
  const failureList =
    failureFiles.length > 0
      ? failureFiles
          .map(
            (file) =>
              `- ${toPosixPath(path.relative(process.cwd(), file) || file)}`,
          )
          .join("\n")
      : "- No failure JSON files were generated.";

  return stripIndent(`
    You are working in the WanderBharat repository after an itinerary stress test failure.

    Context:
    - Trigger context: ${context}
    - Failing report directory: ${toPosixPath(path.relative(process.cwd(), failing.runDir) || failing.runDir)}
    - Summary JSON: ${toPosixPath(path.relative(process.cwd(), failing.summaryPath) || failing.summaryPath)}
    - Summary Markdown: ${toPosixPath(path.relative(process.cwd(), path.join(failing.runDir, "summary.md")) || path.join(failing.runDir, "summary.md"))}
    - Profile: ${summary.profile}
    - Seed: ${summary.seed}
    - Cases run: ${summary.cases.run}
    - Failed cases: ${summary.cases.failed}
    - Network attempts: ${summary.networkAttemptCount}

    Goal:
    - Analyze the stress report and failure replay files.
    - Replay representative failing cases before changing code when practical.
    - Fix only the root cause for these itinerary robustness failures.
    - If a safe fix exists, make focused code/test/docs changes and document them in ${reportPath}.
    - If no safe fix exists, do not modify tracked files. Instead write the analysis to reports/itinerary-robustness/agent-analysis.md.

    Constraints:
    - Respect .cursor/rules/wanderbharat-architecture.mdc.
    - Preserve the pure-function core in src/lib/itinerary/.
    - Do not add runtime LLM calls to itinerary generation.
    - Do not call external APIs from client components or pure itinerary engine functions.
    - Do not introduce Jest or Vitest; use the existing Node test runner patterns.
    - Do not create hotel booking, flight booking, payment, refund, cancellation, or affiliate checkout flows.
    - Do not commit, push, create branches, or create pull requests. This workflow handles git and GitHub.
    - Keep changes scoped to the failure root cause; avoid broad unrelated refactors.

    Replay commands:
    ${replayList}

    Failure files:
    ${failureList}

    Summary markdown:
    ${summaryMarkdown || "(summary markdown was not found)"}

    Validation expectation:
    - Run the most relevant replay commands while developing.
    - Leave the repository in a state where npm run lint, npm run typecheck, npm test, and the relevant stress replay are expected to pass.
  `);
}

function renderComment(input) {
  const { context, failing, failureFiles, summaryMarkdown, agentAnalysis } =
    input;
  const summary = failing.summary;
  const replayCommands = summary.replayCommands ?? [];
  const topCodes = summary.topViolationCodes ?? [];
  const lines = [];

  lines.push("## Itinerary stress failure analysis");
  lines.push("");
  lines.push(`Automated stress triage ran for **${context}**.`);
  lines.push("");
  lines.push(`- Profile: \`${summary.profile}\``);
  lines.push(`- Seed: \`${summary.seed}\``);
  lines.push(
    `- Cases: ${summary.cases.run}/${summary.cases.requested} run, ${summary.cases.failed} failed, ${summary.cases.rejected} rejected`,
  );
  lines.push(`- Network attempts: ${summary.networkAttemptCount}`);
  lines.push(
    `- Report: \`${toPosixPath(path.relative(process.cwd(), failing.runDir) || failing.runDir)}\``,
  );
  lines.push("");

  if (topCodes.length > 0) {
    lines.push("Top violation codes:");
    for (const violation of topCodes.slice(0, 5)) {
      lines.push(`- \`${violation.code}\`: ${violation.count}`);
    }
    lines.push("");
  }

  if (replayCommands.length > 0) {
    lines.push("Replay commands:");
    lines.push("");
    lines.push("```bash");
    for (const command of replayCommands.slice(0, 10)) {
      lines.push(command);
    }
    lines.push("```");
    lines.push("");
  }

  if (failureFiles.length > 0) {
    lines.push("Failure files:");
    for (const file of failureFiles.slice(0, 10)) {
      lines.push(
        `- \`${toPosixPath(path.relative(process.cwd(), file) || file)}\``,
      );
    }
    lines.push("");
  }

  if (agentAnalysis.trim()) {
    lines.push("Agent analysis:");
    lines.push("");
    lines.push(agentAnalysis.trim());
    lines.push("");
  } else if (summaryMarkdown.trim()) {
    lines.push("Summary excerpt:");
    lines.push("");
    lines.push(summaryMarkdown.trim().slice(0, 6000));
    lines.push("");
  }

  lines.push(
    "No automated fix PR was opened for this report. A code owner should review the replay files and decide whether to fix, adjust invariants, or accept the rejection behavior.",
  );
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function renderReplayScript(replayCommands) {
  const lines = ["#!/usr/bin/env bash", "set -euo pipefail"];
  for (const command of replayCommands.slice(0, 25)) {
    lines.push(command);
  }
  return `${lines.join("\n")}\n`;
}

function renderNoFailurePrompt(context) {
  return `No failing itinerary stress report was found for ${context}.\n`;
}

function renderNoFailureComment(context) {
  return `No failing itinerary stress report was found for ${context}.\n`;
}

function loadSummary(summaryPath) {
  try {
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    if (!summary || typeof summary !== "object" || !summary.timestamps)
      return undefined;
    return {
      summary,
      summaryPath,
      runDir: path.dirname(summaryPath),
    };
  } catch {
    return undefined;
  }
}

function findFiles(startDir, suffix) {
  const out = [];
  if (!exists(startDir)) return out;

  const entries = readdirSync(startDir);
  for (const entry of entries) {
    const fullPath = path.join(startDir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      out.push(...findFiles(fullPath, suffix));
      continue;
    }
    if (stats.isFile() && entry.endsWith(suffix)) {
      out.push(fullPath);
    }
  }
  return out;
}

function exists(targetPath) {
  try {
    statSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function readOptional(targetPath) {
  try {
    return readFileSync(targetPath, "utf8");
  } catch {
    return "";
  }
}

function writeOptionalFile(targetPath, content) {
  if (!targetPath) return;
  const absolutePath = path.resolve(String(targetPath));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function writeOutputs(outputs) {
  if (!githubOutputFile) return;
  const lines = [];
  for (const [key, value] of Object.entries(outputs)) {
    lines.push(`${key}=${String(value).replace(/\n/g, " ")}`);
  }
  writeOptionalFile(githubOutputFile, `${lines.join("\n")}\n`);
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > -1) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function readArg(key, fallback) {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.trim();
}

function stripIndent(value) {
  const lines = value.replace(/^\n/, "").replace(/\s+$/, "").split("\n");
  const indent = lines
    .filter((line) => line.trim().length > 0)
    .reduce((min, line) => {
      const match = /^(\s*)/.exec(line);
      return Math.min(min, match?.[1].length ?? 0);
    }, Number.POSITIVE_INFINITY);
  return `${lines.map((line) => line.slice(indent)).join("\n")}\n`;
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}
