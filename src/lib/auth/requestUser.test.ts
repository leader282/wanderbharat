import assert from "node:assert/strict";
import test from "node:test";

import { resolveRequestUserId } from "@/lib/auth/requestUser";

function requestWithAuth(value?: string): Request {
  return new Request("https://wanderbharat.example/api/test", {
    headers: value ? { Authorization: value } : undefined,
  });
}

test("resolveRequestUserId prefers a fresh bearer token over a stale session cookie", async () => {
  const userId = await resolveRequestUserId(requestWithAuth("Bearer token_for_b"), {
    getCurrentUser: async () => ({
      uid: "uid_cookie_a",
      email: null,
      name: null,
      picture: null,
    }),
    verifyIdToken: async () => ({ uid: "uid_bearer_b" }),
  });

  assert.equal(userId, "uid_bearer_b");
});

test("resolveRequestUserId does not fall back to cookies when a bearer token is invalid", async () => {
  const userId = await resolveRequestUserId(requestWithAuth("Bearer bad_token"), {
    getCurrentUser: async () => ({
      uid: "uid_cookie_a",
      email: null,
      name: null,
      picture: null,
    }),
    verifyIdToken: async () => {
      throw new Error("invalid token");
    },
  });

  assert.equal(userId, null);
});

test("resolveRequestUserId uses the session cookie when no bearer token is present", async () => {
  const userId = await resolveRequestUserId(requestWithAuth(), {
    getCurrentUser: async () => ({
      uid: "uid_cookie",
      email: null,
      name: null,
      picture: null,
    }),
    verifyIdToken: async () => {
      throw new Error("should not verify");
    },
  });

  assert.equal(userId, "uid_cookie");
});
