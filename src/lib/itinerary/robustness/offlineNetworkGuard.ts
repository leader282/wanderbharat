import { createRequire } from "node:module";

export interface NetworkAttempt {
  operation: string;
  target?: string;
  atEpochMs: number;
}

export class OfflineNetworkError extends Error {
  readonly attempt: NetworkAttempt;

  constructor(attempt: NetworkAttempt) {
    super(
      `Offline guard blocked network call via ${attempt.operation}${
        attempt.target ? ` (${attempt.target})` : ""
      }`,
    );
    this.name = "OfflineNetworkError";
    this.attempt = attempt;
  }
}

export interface OfflineNetworkGuard {
  getAttemptCount(): number;
  getAttempts(): NetworkAttempt[];
  restore(): void;
}

export function installOfflineNetworkGuard(
  nowEpochMs: () => number = () => Date.now(),
): OfflineNetworkGuard {
  const attempts: NetworkAttempt[] = [];
  const require = createRequire(import.meta.url);
  const httpModule = require("node:http") as typeof import("node:http");
  const httpsModule = require("node:https") as typeof import("node:https");

  const originalFetch = globalThis.fetch;
  const originalHttpRequest = httpModule.request;
  const originalHttpGet = httpModule.get;
  const originalHttpsRequest = httpsModule.request;
  const originalHttpsGet = httpsModule.get;

  const block = (operation: string, target?: string): never => {
    const attempt: NetworkAttempt = { operation, target, atEpochMs: nowEpochMs() };
    attempts.push(attempt);
    throw new OfflineNetworkError(attempt);
  };

  if (typeof originalFetch === "function") {
    const patchedFetch = ((input: RequestInfo | URL, _init?: RequestInit) =>
      block("globalThis.fetch", extractFetchTarget(input))) as typeof fetch;
    globalThis.fetch = patchedFetch;
  }

  (httpModule as { request: typeof httpModule.request }).request = ((...args: unknown[]) =>
    block("http.request", extractHttpTarget(args))) as typeof httpModule.request;
  (httpModule as { get: typeof httpModule.get }).get = ((...args: unknown[]) =>
    block("http.get", extractHttpTarget(args))) as typeof httpModule.get;
  (httpsModule as { request: typeof httpsModule.request }).request = ((...args: unknown[]) =>
    block("https.request", extractHttpTarget(args))) as typeof httpsModule.request;
  (httpsModule as { get: typeof httpsModule.get }).get = ((...args: unknown[]) =>
    block("https.get", extractHttpTarget(args))) as typeof httpsModule.get;

  return {
    getAttemptCount: () => attempts.length,
    getAttempts: () => attempts.map((attempt) => ({ ...attempt })),
    restore: () => {
      if (typeof originalFetch === "function") {
        globalThis.fetch = originalFetch;
      }
      (httpModule as { request: typeof httpModule.request }).request = originalHttpRequest;
      (httpModule as { get: typeof httpModule.get }).get = originalHttpGet;
      (httpsModule as { request: typeof httpsModule.request }).request =
        originalHttpsRequest;
      (httpsModule as { get: typeof httpsModule.get }).get = originalHttpsGet;
    },
  };
}

function extractFetchTarget(input: RequestInfo | URL): string | undefined {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }
  return undefined;
}

function extractHttpTarget(args: unknown[]): string | undefined {
  const firstArg = args[0];
  if (typeof firstArg === "string") return firstArg;
  if (firstArg instanceof URL) return firstArg.toString();
  if (!isRecord(firstArg)) return undefined;

  const href = firstArg.href;
  if (typeof href === "string" && href.trim().length > 0) {
    return href;
  }

  const protocol =
    typeof firstArg.protocol === "string" ? firstArg.protocol : "http:";
  const hostname =
    typeof firstArg.hostname === "string"
      ? firstArg.hostname
      : typeof firstArg.host === "string"
        ? firstArg.host
        : undefined;
  const pathname =
    typeof firstArg.path === "string"
      ? firstArg.path
      : typeof firstArg.pathname === "string"
        ? firstArg.pathname
        : "";

  if (!hostname) return undefined;
  return `${protocol}//${hostname}${pathname}`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
