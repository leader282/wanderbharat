const DEFAULT_BASE_URL = "https://api.liteapi.travel/v3.0";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MAX_PROVIDER_CALLS_PER_ITINERARY = 6;

const TRUTHY_VALUES = new Set(["1", "true", "yes", "y", "on"]);
const FALSY_VALUES = new Set(["0", "false", "no", "n", "off"]);

export interface LiteApiProviderConfig {
  enabled: boolean;
  apiKey: string | null;
  baseUrl: string;
  timeoutMs: number;
  maxResults: number;
  maxProviderCallsPerItinerary: number;
}

export function resolveLiteApiProviderConfig(
  env: Record<string, string | undefined> = process.env,
): LiteApiProviderConfig {
  assertServerRuntime();
  return {
    enabled: parseBooleanEnv(env.LITEAPI_ENABLED, false),
    apiKey: normaliseOptionalString(env.LITEAPI_API_KEY),
    baseUrl: normaliseBaseUrl(env.LITEAPI_BASE_URL),
    timeoutMs: parsePositiveInt(
      env.LITEAPI_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      1_000,
      120_000,
    ),
    maxResults: parsePositiveInt(
      env.LITEAPI_MAX_RESULTS,
      DEFAULT_MAX_RESULTS,
      1,
      100,
    ),
    maxProviderCallsPerItinerary: parsePositiveInt(
      env.LITEAPI_MAX_PROVIDER_CALLS_PER_ITINERARY,
      DEFAULT_MAX_PROVIDER_CALLS_PER_ITINERARY,
      0,
      50,
    ),
  };
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("LiteAPI configuration can only be resolved on the server.");
  }
}

export function parseBooleanEnv(
  raw: string | undefined,
  defaultValue: boolean,
): boolean {
  if (!raw) return defaultValue;
  const normalised = raw.trim().toLowerCase();
  if (TRUTHY_VALUES.has(normalised)) return true;
  if (FALSY_VALUES.has(normalised)) return false;
  return defaultValue;
}

function normaliseOptionalString(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseBaseUrl(raw: string | undefined): string {
  const value = normaliseOptionalString(raw) ?? DEFAULT_BASE_URL;
  return value.replace(/\/+$/, "");
}

function parsePositiveInt(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultValue;
  const rounded = Math.trunc(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}
