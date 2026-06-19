import assert from "node:assert/strict";
import test from "node:test";

import { GET, handleGetNodes } from "@/app/api/nodes/route";
import type { FindNodesQuery } from "@/lib/repositories/nodeRepository";

test("GET /api/nodes rejects regions outside the public allowlist", async () => {
  const previous = process.env.WB_ALLOWED_REGIONS;
  process.env.WB_ALLOWED_REGIONS = "rajasthan";

  try {
    const response = await GET(
      new Request("http://localhost/api/nodes?region=hidden&type=city"),
    );

    assert.equal(response.status, 404);
    const payload = (await response.json()) as { error: string };
    assert.equal(payload.error, "region_not_available");
  } finally {
    if (previous === undefined) {
      delete process.env.WB_ALLOWED_REGIONS;
    } else {
      process.env.WB_ALLOWED_REGIONS = previous;
    }
  }
});

test("handleGetNodes normalises malformed pagination before repository access", async () => {
  let observedQuery: FindNodesQuery | undefined;

  const response = await handleGetNodes(
    new Request(
      "http://localhost/api/nodes?region=rajasthan&type=city&page_size=wat&limit=nope",
    ),
    {
      findNodes: async (query) => {
        observedQuery = query;
        return [];
      },
      getDisallowedPublicRegions: () => [],
      getPublicAllowedRegionSlugs: () => null,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(observedQuery?.pageSize, 200);
  assert.equal(observedQuery?.limit, 200);
});

test("handleGetNodes redacts backend failure details", async () => {
  const response = await handleGetNodes(
    new Request("http://localhost/api/nodes?region=rajasthan&type=city"),
    {
      findNodes: async () => {
        throw new Error(
          "Firestore index projects/wanderbharat/databases/(default)/indexes/secret",
        );
      },
      getDisallowedPublicRegions: () => [],
      getPublicAllowedRegionSlugs: () => null,
    },
  );

  assert.equal(response.status, 500);
  const payload = (await response.json()) as { error: string; message: string };
  assert.equal(payload.error, "internal_error");
  assert.doesNotMatch(payload.message, /Firestore|secret|projects\//);
});
