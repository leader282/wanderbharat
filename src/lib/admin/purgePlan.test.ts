import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPurgeCollections,
  buildRegionQueryFilter,
  describePreservedData,
  parseBooleanArg,
  parseRegionSlugs,
  rejectRemovedFlags,
  resolvePurgeOptions,
  supportsRegionScope,
  verifyProjectConfirmation,
  type PurgeCollectionSpec,
} from "@/lib/admin/purgePlan";

test("resolvePurgeOptions defaults to safe preservation flags", () => {
  const options = resolvePurgeOptions({});

  assert.equal(options.dryRun, false);
  assert.equal(options.confirmed, false);
  assert.equal(options.allRegions, false);
  assert.equal(options.includeUsers, false);
  assert.equal(options.includeItineraries, false);
  assert.equal(options.includeDataQualityIssues, false);
  assert.equal(options.confirmProject, null);
  assert.deepEqual(options.regionSlugs, []);

  const collections = buildPurgeCollections(options);
  const names = collections.map((collection) => collection.name);
  assert.equal(names.includes("users"), false);
  assert.equal(names.includes("itineraries"), false);
  assert.equal(names.includes("data_quality_issues"), false);
});

test("resolvePurgeOptions accepts a fully-formed destructive run", () => {
  const options = resolvePurgeOptions({
    yes: true,
    "all-regions": true,
    "include-itineraries": true,
    "include-users": true,
    "include-data-quality-issues": true,
    "confirm-project": "wanderbharat-prod",
  });

  assert.equal(options.confirmed, true);
  assert.equal(options.allRegions, true);
  assert.equal(options.includeUsers, true);
  assert.equal(options.includeItineraries, true);
  assert.equal(options.includeDataQualityIssues, true);
  assert.equal(options.confirmProject, "wanderbharat-prod");

  const collections = buildPurgeCollections(options);
  const names = collections.map((collection) => collection.name);
  assert.ok(names.includes("users"));
  assert.ok(names.includes("itineraries"));
  assert.ok(names.includes("data_quality_issues"));
});

test("resolvePurgeOptions normalises and dedupes region slugs", () => {
  const options = resolvePurgeOptions({
    regions: "Rajasthan, gujarat,rajasthan",
  });

  assert.deepEqual(options.regionSlugs, ["rajasthan", "gujarat"]);
});

test("resolvePurgeOptions rejects --dry-run combined with --yes", () => {
  assert.throws(
    () => resolvePurgeOptions({ "dry-run": true, yes: true }),
    /--dry-run and --yes cannot be combined/,
  );
});

test("resolvePurgeOptions rejects --regions combined with --all-regions", () => {
  assert.throws(
    () =>
      resolvePurgeOptions({
        regions: "rajasthan",
        "all-regions": true,
      }),
    /--regions and --all-regions cannot be combined/,
  );
});

test("resolvePurgeOptions rejects --yes without an explicit scope", () => {
  assert.throws(
    () =>
      resolvePurgeOptions({
        yes: true,
        "confirm-project": "wanderbharat-prod",
      }),
    /Destructive run requires explicit scope/,
  );
});

test("resolvePurgeOptions rejects --yes without --confirm-project", () => {
  assert.throws(
    () =>
      resolvePurgeOptions({
        yes: true,
        regions: "rajasthan",
      }),
    /requires --confirm-project=<projectId>/,
  );
});

test("rejectRemovedFlags surfaces removed flag names with replacements", () => {
  assert.throws(
    () => rejectRemovedFlags({ "keep-itineraries": true }),
    /--keep-itineraries has been removed.*--include-itineraries/,
  );
  assert.throws(
    () => rejectRemovedFlags({ "keep-users": "false" }),
    /--keep-users has been removed.*--include-users/,
  );
  assert.throws(
    () => rejectRemovedFlags({ region: "rajasthan" }),
    /--region has been removed.*--regions/,
  );
});

test("parseRegionSlugs validates empty and oversized region filters", () => {
  assert.throws(
    () => parseRegionSlugs({ regions: true }),
    /requires a comma-separated value/,
  );

  const manyRegions = new Array(11)
    .fill(0)
    .map((_, index) => `region_${index}`)
    .join(",");
  assert.throws(
    () => parseRegionSlugs({ regions: manyRegions }),
    /up to 10 values/,
  );
});

test("parseBooleanArg understands common true/false values", () => {
  assert.equal(parseBooleanArg(undefined, true), true);
  assert.equal(parseBooleanArg(undefined, false), false);
  assert.equal(parseBooleanArg(true, false), true);
  assert.equal(parseBooleanArg("false", true), false);
  assert.equal(parseBooleanArg("ON", false), true);
  assert.equal(parseBooleanArg("0", true), false);
  assert.throws(() => parseBooleanArg("maybe", false), /Invalid boolean value/);
});

test("buildRegionQueryFilter picks Firestore operators by field mode", () => {
  const scalarCollection: PurgeCollectionSpec = {
    name: "nodes",
    regionFilter: { field: "region", mode: "scalar" },
  };
  const arrayCollection: PurgeCollectionSpec = {
    name: "edges",
    regionFilter: { field: "regions", mode: "array" },
  };

  assert.deepEqual(buildRegionQueryFilter(scalarCollection, []), null);
  assert.deepEqual(buildRegionQueryFilter(scalarCollection, ["rajasthan"]), {
    field: "region",
    op: "==",
    value: "rajasthan",
  });
  assert.deepEqual(
    buildRegionQueryFilter(scalarCollection, ["rajasthan", "gujarat"]),
    {
      field: "region",
      op: "in",
      value: ["rajasthan", "gujarat"],
    },
  );
  assert.deepEqual(
    buildRegionQueryFilter(arrayCollection, ["rajasthan", "gujarat"]),
    {
      field: "regions",
      op: "array-contains-any",
      value: ["rajasthan", "gujarat"],
    },
  );
  assert.equal(supportsRegionScope({ name: "data_quality_issues" }), false);
});

test("describePreservedData reflects the actual opt-in flags", () => {
  assert.deepEqual(
    describePreservedData({
      includeUsers: false,
      includeItineraries: false,
      includeDataQualityIssues: false,
    }),
    [
      "users (admin role assignments stay intact)",
      "itineraries (saved trips — may reference deleted nodes if the graph is purged)",
      "data_quality_issues (admin investigation state stays intact; re-run scanner after reseed)",
    ],
  );

  assert.deepEqual(
    describePreservedData({
      includeUsers: true,
      includeItineraries: true,
      includeDataQualityIssues: true,
    }),
    [],
  );
});

test("verifyProjectConfirmation passes through non-destructive runs", () => {
  const result = verifyProjectConfirmation(
    { confirmed: false, confirmProject: null },
    "wanderbharat-prod",
  );
  assert.equal(result.ok, true);
});

test("verifyProjectConfirmation rejects mismatched project ids", () => {
  const result = verifyProjectConfirmation(
    {
      confirmed: true,
      confirmProject: "wanderbharat-staging",
    },
    "wanderbharat-prod",
  );
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /does not match the resolved Firebase project/);
});

test("verifyProjectConfirmation rejects unresolved project ids", () => {
  const result = verifyProjectConfirmation(
    {
      confirmed: true,
      confirmProject: "wanderbharat-prod",
    },
    null,
  );
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /Could not resolve the Firebase project id/);
});

test("verifyProjectConfirmation accepts matching project ids", () => {
  const result = verifyProjectConfirmation(
    {
      confirmed: true,
      confirmProject: "wanderbharat-prod",
    },
    "wanderbharat-prod",
  );
  assert.equal(result.ok, true);
});
