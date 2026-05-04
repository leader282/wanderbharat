import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBooleanEnv,
  resolveLiteApiProviderConfig,
} from "@/lib/providers/hotels/liteApiConfig";

test("resolveLiteApiProviderConfig applies safe defaults", () => {
  const config = resolveLiteApiProviderConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.apiKey, null);
  assert.equal(config.baseUrl, "https://api.liteapi.travel/v3.0");
  assert.equal(config.timeoutMs, 12000);
  assert.equal(config.maxResults, 20);
  assert.equal(config.maxProviderCallsPerItinerary, 6);
});

test("resolveLiteApiProviderConfig normalises custom env values", () => {
  const config = resolveLiteApiProviderConfig({
    LITEAPI_ENABLED: "true",
    LITEAPI_API_KEY: "test_key",
    LITEAPI_BASE_URL: "https://example.com/root/",
    LITEAPI_TIMEOUT_MS: "9000",
    LITEAPI_MAX_RESULTS: "50",
    LITEAPI_MAX_PROVIDER_CALLS_PER_ITINERARY: "12",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.apiKey, "test_key");
  assert.equal(config.baseUrl, "https://example.com/root");
  assert.equal(config.timeoutMs, 9000);
  assert.equal(config.maxResults, 50);
  assert.equal(config.maxProviderCallsPerItinerary, 12);
});

test("parseBooleanEnv handles expected true/false aliases", () => {
  assert.equal(parseBooleanEnv("yes", false), true);
  assert.equal(parseBooleanEnv("1", false), true);
  assert.equal(parseBooleanEnv("OFF", true), false);
  assert.equal(parseBooleanEnv("0", true), false);
  assert.equal(parseBooleanEnv("unexpected", true), true);
});
