import assert from "node:assert/strict";
import test from "node:test";

import { requireAdminUser } from "@/lib/auth/admin";

const sampleUser = {
  uid: "uid_admin",
  email: "admin@example.com",
  name: "Admin User",
  picture: null,
};

test("requireAdminUser returns unauthenticated when no session user exists", async () => {
  let roleLookups = 0;

  const result = await requireAdminUser({
    resolveCurrentUser: async () => null,
    resolveUserRole: async () => {
      roleLookups += 1;
      return "admin";
    },
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "unauthenticated",
  });
  assert.equal(roleLookups, 0);
});

test("requireAdminUser accepts admin role from users collection", async () => {
  const result = await requireAdminUser({
    resolveCurrentUser: async () => sampleUser,
    resolveUserRole: async () => " Admin ",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.user.uid, sampleUser.uid);
  assert.equal(result.user.role, "admin");
});

test("requireAdminUser returns forbidden for signed-in non-admin users", async () => {
  const result = await requireAdminUser({
    resolveCurrentUser: async () => sampleUser,
    resolveUserRole: async () => "editor",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "forbidden");
  assert.equal(result.user.uid, sampleUser.uid);
});

test("requireAdminUser returns forbidden when role is missing", async () => {
  const result = await requireAdminUser({
    resolveCurrentUser: async () => sampleUser,
    resolveUserRole: async () => null,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "forbidden");
});
