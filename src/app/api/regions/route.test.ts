import assert from "node:assert/strict";
import test from "node:test";

import { handleGetRegions } from "@/app/api/regions/route";

test("handleGetRegions returns region summaries", async () => {
  const response = await handleGetRegions({
    listRegions: async () => [
      {
        region: "rajasthan",
        country: "india",
        count: 5,
      },
    ],
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    regions: Array<{ region: string }>;
  };
  assert.equal(payload.regions[0]?.region, "rajasthan");
});

test("handleGetRegions redacts backend failure details", async () => {
  const response = await handleGetRegions({
    listRegions: async () => {
      throw new Error(
        "Firestore index projects/wanderbharat/databases/(default)/indexes/secret",
      );
    },
  });

  assert.equal(response.status, 500);
  const payload = (await response.json()) as { error: string; message: string };
  assert.equal(payload.error, "internal_error");
  assert.doesNotMatch(payload.message, /Firestore|secret|projects\//);
});
