import assert from "node:assert/strict";
import test from "node:test";

import {
  handleCreateSession,
  handleDeleteSession,
} from "@/app/api/auth/session/route";

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://wanderbharat.example/api/auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const deps = {
  verifyIdToken: async () => ({
    uid: "uid_test",
    auth_time: 1_700_000_000,
    email: "test@example.com",
    name: "Test User",
    picture: "https://example.com/avatar.png",
  }),
  createSessionCookie: async () => "session_cookie_value",
  setSessionCookie: async () => {},
  nowSeconds: () => 1_700_000_060,
};

test("handleCreateSession rejects cross-origin session minting", async () => {
  let verifyCalls = 0;
  const response = await handleCreateSession(
    makeRequest({ idToken: "token" }, { Origin: "https://evil.example" }),
    {
      ...deps,
      verifyIdToken: async () => {
        verifyCalls += 1;
        return deps.verifyIdToken();
      },
    },
  );

  assert.equal(response.status, 403);
  assert.equal(verifyCalls, 0);
});

test("handleCreateSession rejects form-compatible content types", async () => {
  let verifyCalls = 0;
  const request = new Request("https://wanderbharat.example/api/auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Origin: "https://wanderbharat.example",
    },
    body: JSON.stringify({ idToken: "token" }),
  });

  const response = await handleCreateSession(request, {
    ...deps,
    verifyIdToken: async () => {
      verifyCalls += 1;
      return deps.verifyIdToken();
    },
  });

  assert.equal(response.status, 415);
  assert.equal(verifyCalls, 0);
});

test("handleCreateSession sets a session cookie for same-origin JSON", async () => {
  let cookieValue: string | null = null;
  const response = await handleCreateSession(
    makeRequest({ idToken: "token" }, { Origin: "https://wanderbharat.example" }),
    {
      ...deps,
      setSessionCookie: async (value) => {
        cookieValue = value;
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(cookieValue, "session_cookie_value");
});

test("handleDeleteSession rejects cross-origin clears", async () => {
  let setCalls = 0;
  const request = new Request("https://wanderbharat.example/api/auth/session", {
    method: "DELETE",
    headers: { Origin: "https://evil.example" },
  });

  const response = await handleDeleteSession(request, {
    setSessionCookie: async () => {
      setCalls += 1;
    },
  });

  assert.equal(response.status, 403);
  assert.equal(setCalls, 0);
});
