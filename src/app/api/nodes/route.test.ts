import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "@/app/api/nodes/route";

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
