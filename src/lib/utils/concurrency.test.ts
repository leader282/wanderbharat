import assert from "node:assert/strict";
import test from "node:test";

import { chunk, mapLimit } from "@/lib/utils/concurrency";

test("mapLimit returns an empty array for empty input", async () => {
  const result = await mapLimit([], 4, async () => 1);
  assert.deepEqual(result, []);
});

test("mapLimit preserves input order in the output", async () => {
  const result = await mapLimit(
    [10, 20, 30, 40, 50],
    2,
    async (n) => n * 2,
  );
  assert.deepEqual(result, [20, 40, 60, 80, 100]);
});

test("mapLimit never runs more than `limit` workers in parallel", async () => {
  let active = 0;
  let peak = 0;

  await mapLimit(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  });

  assert.ok(peak <= 3, `peak concurrency was ${peak}`);
});

test("mapLimit clamps the limit to a sane minimum", async () => {
  const result = await mapLimit([1, 2, 3], 0, async (n) => n + 1);
  assert.deepEqual(result, [2, 3, 4]);
});

test("mapLimit propagates the first failure", async () => {
  await assert.rejects(
    () =>
      mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
        if (n === 3) throw new Error("boom");
        return n;
      }),
    /boom/,
  );
});

test("chunk splits arrays into fixed-size buckets", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("chunk returns an empty array for empty input", () => {
  assert.deepEqual(chunk([], 3), []);
});

test("chunk produces a single bucket when size >= length", () => {
  assert.deepEqual(chunk([1, 2, 3], 10), [[1, 2, 3]]);
});

test("chunk throws on a non-positive size", () => {
  assert.throws(() => chunk([1, 2, 3], 0), /chunk size must be > 0/);
  assert.throws(() => chunk([1, 2, 3], -1), /chunk size must be > 0/);
});
