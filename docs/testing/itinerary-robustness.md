# Itinerary Robustness Testing

This document covers the offline robustness harness for the itinerary engine. It generates deterministic scenarios, runs the pure itinerary engine directly, validates invariants, and writes replayable reports under `reports/itinerary-robustness/`.

## What Quick Stress Covers

Quick stress (`--profile=quick`) is the PR-friendly safety sweep:

- Moderate deterministic case count by default (150).
- Mixed scenario sources:
  - Seed datasets from `scripts/data/*`.
  - Synthetic graph/data generation.
- Region-focused coverage for shipped region datasets.
- Typical itinerary dimensions:
  - Different day counts.
  - Travel styles.
  - Budget ranges.
  - Traveller mixes.
  - Requested-city combinations.
  - Common transport mode mixes (mostly road, some road+train).
- Deterministic case IDs and deterministic engine context (`now` and `makeId`) to keep runs replayable.

## What Heavy Chaos/Stress Covers

Heavy stress (`--profile=heavy`) expands scale and chaos:

- Large deterministic case volume by default (2000).
- Wider travel-mode and trip-shape combinations.
- In-memory mutation coverage, including:
  - `drop_edges`
  - `directional_edges`
  - `inflate_travel_time`
  - `sparse_attractions`
  - `tight_budget`
  - `requested_city_pressure`
  - `unsupported_modes`
- More "may reject" scenarios to verify structured constraint failures instead of crashes.
- Same invariant checks as quick, but against harder graph/data conditions.

## Why These Tests Are Offline

These tests intentionally run without external I/O to keep them deterministic, fast to replay, and safe in CI/local environments:

- The harness calls `generateItinerary(input, ctx, deps)` directly with an injected offline matrix resolver.
- Network surfaces are blocked by guard logic (for example `fetch`, `http`, and `https` paths).
- Sensitive provider env vars are blocked for this workflow.
- The harness does not rely on Firebase, live APIs, or external credentials.

## Run Locally

Use these commands from the repository root:

```bash
npm run test:itinerary:stress
npm run test:itinerary:stress:quick -- --seed=my-seed --cases=25
npm run test:itinerary:stress:heavy -- --seed=my-heavy-seed --cases=250
```

## Replay A Failure

Replay a recorded failing case with:

```bash
npm run test:itinerary:stress:replay -- --file reports/itinerary-robustness/<run>/failures/<case>.json
```

The `<run>` segment is `<profile>-<seed>` (for example `quick-local-smoke`), and `<case>` is the failure JSON filename (for example `rb-quick-0002-ea0c8cac.json`).

## Report Structure

Each run writes to:

- `reports/itinerary-robustness/<profile>-<seed>/summary.json`
- `reports/itinerary-robustness/<profile>-<seed>/summary.md`
- `reports/itinerary-robustness/<profile>-<seed>/failures/*.json`

What each file contains:

- `summary.json`
  - Machine-readable run metadata and aggregates (pass/fail counts, duration, replay commands, top violation codes, slowest cases, fatal errors, network attempt count).
- `summary.md`
  - Human-readable run outcome and highlights (counts, replay commands, top failures, slowest cases, artifact paths).
- Failure replay JSON files
  - Per-case details (scenario summary, case result, invariant violations, and replay payload/command for deterministic reruns).

## Tuning Case Counts And Timeouts

You can tune runtime directly from CLI flags:

- `--cases=<n>` controls number of generated scenarios.
- `--seed=<value>` fixes deterministic scenario generation.
- `--total-timeout-ms=<ms>` caps total run duration.
- `--slow-ms=<ms>` changes threshold used for "slow case" counting.
- `--max-failures=<n>` limits number of failure replay artifacts written.
- `--out-dir=<path>` writes reports to a custom output directory.

Useful smoke examples:

```bash
npm run test:itinerary:stress -- --cases=25 --seed=local-smoke --total-timeout-ms=120000
npm run test:itinerary:stress:heavy -- --cases=50 --seed=local-heavy-smoke --total-timeout-ms=120000
```

## Automated Failure Triage

Stress failures are triaged by Cursor Agent automation after reports are written:

- PR CI quick stress failures are handled by `.github/workflows/itinerary-stress-agent.yml`.
- Scheduled/manual heavy chaos failures are handled by `.github/workflows/itinerary-chaos.yml`.
- Both flows use `scripts/itineraryStressAgentReport.mjs` to locate the failing `summary.json`, generate the agent prompt, generate a report-only PR comment, and emit replay commands for validation.

Required repository secrets:

- `CURSOR_API_KEY` lets the workflow run the Cursor agent.
- `BOT_GITHUB_TOKEN` lets the workflow push fix branches, open PRs, and comment on PRs.

Failure behavior:

- If a trusted same-repository branch has a failing stress report, the agent may make a focused fix. The workflow validates replay commands, `npm run lint`, `npm run typecheck`, `npm test`, and a targeted quick stress smoke before opening a fix PR.
- If the failed PR came from a fork, the workflow does not run the agent with write-capable secrets against that code. It posts a report-only PR comment with replay commands and failure details.
- If the agent finds no safe fix, it should leave tracked files unchanged and write analysis under `reports/itinerary-robustness/agent-analysis.md`; the workflow posts a report-only comment when a PR exists.
- If scheduled/manual heavy chaos fails on `main`, the workflow opens a `main`-targeted fix PR when validated changes exist. Without tracked changes, it writes the report to the workflow summary and preserves the failed status.

Code owners should treat bot fix PRs like any other code change: review the root-cause analysis, inspect replayed failure cases, and confirm the validation listed in the PR body.

## Safety Warning

- Firebase/API/network calls are intentionally blocked in these workflows.
- Do not add production credentials to these workflows.
- Run from a clean environment for stress tests; unset provider keys instead of reusing production shell exports.
