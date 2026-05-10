import assert from "node:assert/strict";
import test from "node:test";

import { handleContactRequest } from "@/app/api/contact/route";
import type { ContactSubmissionBody } from "@/lib/api/contactValidation";
import type { SendContactEmailResult } from "@/lib/email/contactMailer";
import type { TurnstileVerificationResult } from "@/lib/api/turnstile";

const validPayload = {
  name: "Aritra Chakraborty",
  email: "traveler@example.com",
  queryType: "Trip help",
  destinationOrRegion: "Sikkim",
  tripDates: "10-16 Jun 2026",
  numberOfPeople: "4",
  budget: "INR 40,000 to 60,000",
  message:
    "Need help creating a 6-day itinerary with local transport options and family-friendly attractions.",
  consent: true,
  company: "",
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createDependencies(overrides?: {
  checkRateLimit?: () => { allowed: true } | { allowed: false; retryAfterSeconds: number };
  verifyTurnstileToken?: () => Promise<TurnstileVerificationResult>;
  sendContactEmail?: (
    body: ContactSubmissionBody,
  ) => Promise<SendContactEmailResult>;
}) {
  return {
    checkRateLimit: overrides?.checkRateLimit ?? (() => ({ allowed: true as const })),
    verifyTurnstileToken:
      overrides?.verifyTurnstileToken ??
      (async () =>
        ({
          ok: true,
          bypassed: false,
        }) satisfies TurnstileVerificationResult),
    sendContactEmail:
      overrides?.sendContactEmail ??
      (async () =>
        ({
          ok: true,
          id: "email_123",
        }) satisfies SendContactEmailResult),
  };
}

test("handleContactRequest returns 201 for successful submissions", async () => {
  let observedPayload: ContactSubmissionBody | undefined;

  const response = await handleContactRequest(
    makeRequest(validPayload),
    createDependencies({
      sendContactEmail: async (body) => {
        observedPayload = body;
        return {
          ok: true,
          id: "email_123",
        };
      },
    }),
  );

  assert.equal(response.status, 201);
  const payload = (await response.json()) as { ok: boolean };
  assert.equal(payload.ok, true);
  assert.equal(observedPayload?.numberOfPeople, 4);
});

test("handleContactRequest returns 400 with field errors for invalid payloads", async () => {
  const response = await handleContactRequest(
    makeRequest({
      ...validPayload,
      message: "too short",
    }),
    createDependencies(),
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as {
    error: string;
    fieldErrors: Record<string, string[]>;
  };
  assert.equal(payload.error, "invalid_input");
  assert.ok(payload.fieldErrors.message?.length > 0);
});

test("handleContactRequest swallows honeypot submissions", async () => {
  let sendCalls = 0;

  const response = await handleContactRequest(
    makeRequest({
      ...validPayload,
      company: "spam bot",
    }),
    createDependencies({
      sendContactEmail: async () => {
        sendCalls += 1;
        return { ok: true, id: "email_123" };
      },
    }),
  );

  assert.equal(response.status, 202);
  assert.equal(sendCalls, 0);
});

test("handleContactRequest returns 429 when rate limited", async () => {
  const response = await handleContactRequest(
    makeRequest(validPayload),
    createDependencies({
      checkRateLimit: () => ({ allowed: false, retryAfterSeconds: 45 }),
    }),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "45");
});

test("handleContactRequest returns 400 when turnstile verification fails", async () => {
  const response = await handleContactRequest(
    makeRequest(validPayload),
    createDependencies({
      verifyTurnstileToken: async () => ({
        ok: false,
        status: 400,
        error: "turnstile_verification_failed",
        message: "Please complete the security check and try again.",
        errorCodes: ["invalid-input-response"],
      }),
    }),
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assert.equal(payload.error, "turnstile_verification_failed");
});

test("handleContactRequest returns 503 when turnstile is not configured", async () => {
  const response = await handleContactRequest(
    makeRequest(validPayload),
    createDependencies({
      verifyTurnstileToken: async () => ({
        ok: false,
        status: 503,
        error: "turnstile_not_configured",
        message:
          "Contact submissions are temporarily unavailable. Please try again later.",
        errorCodes: [],
      }),
    }),
  );

  assert.equal(response.status, 503);
  const payload = (await response.json()) as { error: string };
  assert.equal(payload.error, "turnstile_not_configured");
});

test("handleContactRequest returns 502 when turnstile verification is unavailable", async () => {
  const response = await handleContactRequest(
    makeRequest(validPayload),
    createDependencies({
      verifyTurnstileToken: async () => ({
        ok: false,
        status: 502,
        error: "turnstile_verification_failed",
        message:
          "We could not verify the security check right now. Please try again.",
        errorCodes: [],
      }),
    }),
  );

  assert.equal(response.status, 502);
  const payload = (await response.json()) as { error: string };
  assert.equal(payload.error, "turnstile_verification_failed");
});

test("handleContactRequest returns 503 when mail config is missing", async () => {
  const response = await handleContactRequest(
    makeRequest(validPayload),
    createDependencies({
      sendContactEmail: async () =>
        ({
          ok: false,
          reason: "missing_config",
          missing: ["CONTACT_FROM_EMAIL"],
        }) satisfies SendContactEmailResult,
    }),
  );

  assert.equal(response.status, 503);
});

test("handleContactRequest returns 502 on provider delivery failure", async () => {
  const response = await handleContactRequest(
    makeRequest(validPayload),
    createDependencies({
      sendContactEmail: async () =>
        ({
          ok: false,
          reason: "provider_error",
        }) satisfies SendContactEmailResult,
    }),
  );

  assert.equal(response.status, 502);
});
