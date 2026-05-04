#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = process.cwd();
const srcDir = join(rootDir, "src");
const testFiles = collectTestFiles(srcDir).sort();

if (testFiles.length === 0) {
  console.error("No test files found under src.");
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), "wanderbharat-tests-"));
const manifestPath = join(tempDir, "manifest.mjs");
writeFileSync(
  manifestPath,
  testFiles
    .map((file) => `await import(${JSON.stringify(pathToFileURL(file).href)});`)
    .join("\n"),
);

const result = spawnSync(process.execPath, [
  "--import",
  "tsx",
  "--test",
  ...process.argv.slice(2),
  manifestPath,
], {
  cwd: rootDir,
  env: process.env,
  stdio: "inherit",
});

rmSync(tempDir, { force: true, recursive: true });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.signal) {
  console.error(`Test process terminated with signal ${result.signal}.`);
  process.exit(1);
}

process.exit(result.status ?? 1);

function collectTestFiles(dir) {
  const files = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (stats.isFile() && entry.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}
