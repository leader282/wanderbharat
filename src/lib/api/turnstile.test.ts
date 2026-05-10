import assert from "node:assert/strict";
import test from "node:test";

import { verifyTurnstileToken } from "@/lib/api/turnstile";

test("verifyTurnstileToken bypasses in development when secret is missing", async () => {
  const result = await verifyTurnstileToken({
    token: undefined,
    clientIp: "203.0.113.5",
    env: {
      NODE_ENV: "development",
      TURNSTILE_SECRET_KEY: "",
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.bypassed, true);
});

test("verifyTurnstileToken bypasses in development when site key is missing", async () => {
  const result = await verifyTurnstileToken({
    token: undefined,
    clientIp: "203.0.113.5",
    env: {
      NODE_ENV: "development",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
      TURNSTILE_SECRET_KEY: "secret",
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.bypassed, true);
});

test("verifyTurnstileToken rejects when secret is missing in production", async () => {
  const result = await verifyTurnstileToken({
    token: "token",
    clientIp: "203.0.113.5",
    env: {
      NODE_ENV: "production",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key",
      TURNSTILE_SECRET_KEY: "",
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 503);
  assert.equal(result.error, "turnstile_not_configured");
});

test("verifyTurnstileToken rejects when token is missing", async () => {
  const result = await verifyTurnstileToken({
    token: "  ",
    clientIp: "203.0.113.5",
    env: {
      NODE_ENV: "production",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key",
      TURNSTILE_SECRET_KEY: "secret",
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.equal(result.error, "turnstile_missing_token");
});

test("verifyTurnstileToken validates successful Turnstile responses", async () => {
  const result = await verifyTurnstileToken({
    token: "token",
    clientIp: "203.0.113.5",
    env: {
      NODE_ENV: "production",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key",
      TURNSTILE_SECRET_KEY: "secret",
    },
    fetchImpl: async (input, init) => {
      assert.equal(
        input,
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      );
      assert.equal(init?.method, "POST");
      const body = String(init?.body ?? "");
      assert.ok(body.includes("secret=secret"));
      assert.ok(body.includes("response=token"));
      assert.ok(body.includes("remoteip=203.0.113.5"));
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.bypassed, false);
});

test("verifyTurnstileToken rejects failed Turnstile responses", async () => {
  const result = await verifyTurnstileToken({
    token: "token",
    clientIp: "203.0.113.5",
    env: {
      NODE_ENV: "production",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key",
      TURNSTILE_SECRET_KEY: "secret",
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.equal(result.error, "turnstile_verification_failed");
  assert.deepEqual(result.errorCodes, ["invalid-input-response"]);
});
