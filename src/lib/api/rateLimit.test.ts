import assert from "node:assert/strict";
import test from "node:test";

import { getClientIpAddress } from "@/lib/api/rateLimit";

test("getClientIpAddress uses the proxy-appended address from forwarded chains", () => {
  const request = new Request("https://wanderbharat.example/api/contact", {
    headers: {
      "x-forwarded-for": "198.51.100.10, 203.0.113.42",
    },
  });

  assert.equal(getClientIpAddress(request), "203.0.113.42");
});

test("getClientIpAddress prefers trusted direct proxy IP headers", () => {
  const request = new Request("https://wanderbharat.example/api/contact", {
    headers: {
      "x-real-ip": "203.0.113.8",
      "x-forwarded-for": "198.51.100.10, 203.0.113.42",
    },
  });

  assert.equal(getClientIpAddress(request), "203.0.113.8");
});

test("getClientIpAddress ignores malformed forwarded values", () => {
  const request = new Request("https://wanderbharat.example/api/contact", {
    headers: {
      "x-forwarded-for": "spoofed, unknown",
    },
  });

  assert.equal(getClientIpAddress(request), "unknown");
});
