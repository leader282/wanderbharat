import assert from "node:assert/strict";
import test from "node:test";

import { parseServiceAccountEnv } from "@/lib/firebase/admin";

const sampleServiceAccount = {
  type: "service_account",
  project_id: "wanderbharat-explore",
  private_key_id: "abc123",
  private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
  client_email: "firebase-adminsdk@test.iam.gserviceaccount.com",
  client_id: "1234567890",
};

test("parseServiceAccountEnv accepts raw JSON", () => {
  const parsed = parseServiceAccountEnv(
    JSON.stringify(sampleServiceAccount),
  ) as unknown as typeof sampleServiceAccount;

  assert.deepEqual(parsed, sampleServiceAccount);
});

test("parseServiceAccountEnv accepts base64-encoded JSON", () => {
  const encoded = Buffer.from(
    JSON.stringify(sampleServiceAccount),
    "utf8",
  ).toString("base64");
  const parsed = parseServiceAccountEnv(encoded) as unknown as typeof sampleServiceAccount;

  assert.deepEqual(parsed, sampleServiceAccount);
});

test("parseServiceAccountEnv throws a helpful error for invalid input", () => {
  assert.throws(
    () => parseServiceAccountEnv("definitely-not-a-service-account"),
    /FIREBASE_SERVICE_ACCOUNT_JSON must be raw JSON or a base64-encoded JSON object/,
  );
});
