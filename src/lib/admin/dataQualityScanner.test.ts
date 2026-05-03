import assert from "node:assert/strict";
import test from "node:test";

import type {
  AttractionAdmissionRule,
  AttractionOpeningHours,
  DataQualityIssue,
  GraphEdge,
  GraphNode,
} from "@/types/domain";
import { runDataQualityScan } from "@/lib/admin/dataQualityScanner";
import type {
  HotelOfferSnapshot,
  ProviderCallLog,
} from "@/lib/providers/hotels/types";
import type { CreateDataQualityIssueInput } from "@/lib/repositories/dataQualityRepository";

test("runDataQualityScan flags missing attraction and edge fields", async () => {
  const nodes: GraphNode[] = [
    makeAttraction("attr_missing", "Amber Fort", {
      source_type: "mock",
    }),
    makeAttraction("attr_dup_one", "City Palace", {
      google_place_id: "place_city_palace",
      opening_time: "09:00",
      closing_time: "18:00",
      admission_costs: [{ category: "adult", amount: 250 }],
    }),
    makeAttraction("attr_dup_two", "City Palace Duplicate", {
      google_place_id: "place_city_palace",
      opening_time: "09:30",
      closing_time: "17:30",
      admission_costs: [{ category: "adult", amount: 250 }],
    }),
  ];

  const edges: GraphEdge[] = [
    makeEdge("edge_broken", {
      distance_km: 0,
      travel_time_hours: 0,
    }),
  ];

  const store = createIssueStore();
  const result = await runDataQualityScan(
    { resolvedBy: "admin@example.com" },
    {
      listNodes: async () => nodes,
      listEdges: async () => edges,
      listAttractionOpeningHoursByAttractionIds: async () => [],
      listAttractionAdmissionRulesByAttractionIds: async () => [],
      listHotelOfferSnapshots: async () => [],
      listProviderCallLogs: async () => [],
      listOpenIssues: store.listOpenIssues,
      createIssue: store.createIssue,
      resolveIssue: store.resolveIssue,
      nowMs: () => 1_700_000_000_000,
    },
  );

  const openIssues = store.getOpenIssues();
  const openCodes = new Set(openIssues.map((issue) => issue.code));

  assert.ok(openCodes.has("mock_data_present"));
  assert.ok(openCodes.has("missing_google_place_id"));
  assert.ok(openCodes.has("missing_opening_hours"));
  assert.ok(openCodes.has("missing_admission_cost"));
  assert.ok(openCodes.has("duplicate_place"));
  assert.ok(openCodes.has("route_edge_missing"));

  assert.equal(result.scanned_nodes, nodes.length);
  assert.equal(result.scanned_edges, edges.length);
  assert.ok(result.created_or_reopened >= 6);
  assert.equal(result.auto_resolved, 0);
});

test("runDataQualityScan remains idempotent across repeated runs", async () => {
  const nodes: GraphNode[] = [
    makeAttraction("attr_missing", "Jal Mahal", {}),
  ];
  const edges: GraphEdge[] = [makeEdge("edge_ok")];
  const store = createIssueStore();

  await runDataQualityScan(
    { resolvedBy: "admin@example.com" },
    {
      listNodes: async () => nodes,
      listEdges: async () => edges,
      listAttractionOpeningHoursByAttractionIds: async () => [],
      listAttractionAdmissionRulesByAttractionIds: async () => [],
      listHotelOfferSnapshots: async () => [],
      listProviderCallLogs: async () => [],
      listOpenIssues: store.listOpenIssues,
      createIssue: store.createIssue,
      resolveIssue: store.resolveIssue,
      nowMs: () => 2_000_000_000_000,
    },
  );
  const firstIssueCount = store.getAllIssues().length;

  await runDataQualityScan(
    { resolvedBy: "admin@example.com" },
    {
      listNodes: async () => nodes,
      listEdges: async () => edges,
      listAttractionOpeningHoursByAttractionIds: async () => [],
      listAttractionAdmissionRulesByAttractionIds: async () => [],
      listHotelOfferSnapshots: async () => [],
      listProviderCallLogs: async () => [],
      listOpenIssues: store.listOpenIssues,
      createIssue: store.createIssue,
      resolveIssue: store.resolveIssue,
      nowMs: () => 2_000_000_010_000,
    },
  );

  assert.equal(store.getAllIssues().length, firstIssueCount);
  assert.equal(store.getOpenIssues().length, firstIssueCount);
});

test("runDataQualityScan skips disabled attractions for coverage and duplicates but still flags mock contamination", async () => {
  const nodes: GraphNode[] = [
    makeAttraction("attr_disabled_missing", "Retired Stepwell", {
      disabled: true,
    }),
    makeAttraction("attr_active_missing", "Active Fort", {}),
    makeAttraction("attr_disabled_dup", "Retired Palace", {
      disabled: true,
      google_place_id: "place_shared_palace",
    }),
    makeAttraction("attr_active_dup", "Active Palace", {
      google_place_id: "place_shared_palace",
    }),
    // A disabled attraction with a mock marker should still surface as
    // mock contamination — that signal is independent of soft-delete.
    makeAttraction("attr_disabled_mock", "Mock Bazaar", {
      disabled: true,
      source_type: "mock",
    }),
  ];
  const edges: GraphEdge[] = [makeEdge("edge_ok")];
  const store = createIssueStore();

  await runDataQualityScan(
    { resolvedBy: "admin@example.com" },
    {
      listNodes: async () => nodes,
      listEdges: async () => edges,
      listAttractionOpeningHoursByAttractionIds: async () => [],
      listAttractionAdmissionRulesByAttractionIds: async () => [],
      listHotelOfferSnapshots: async () => [],
      listProviderCallLogs: async () => [],
      listOpenIssues: store.listOpenIssues,
      createIssue: store.createIssue,
      resolveIssue: store.resolveIssue,
      nowMs: () => 4_000_000_000_000,
    },
  );

  const openIssues = store.getOpenIssues();
  const entitiesByCode = (code: string) =>
    new Set(
      openIssues
        .filter((issue) => issue.code === code)
        .map((issue) => issue.entity_id),
    );

  const missingPlaceIdEntities = entitiesByCode("missing_google_place_id");
  assert.ok(missingPlaceIdEntities.has("attr_active_missing"));
  assert.ok(!missingPlaceIdEntities.has("attr_disabled_missing"));

  const missingHoursEntities = entitiesByCode("missing_opening_hours");
  assert.ok(missingHoursEntities.has("attr_active_missing"));
  assert.ok(!missingHoursEntities.has("attr_disabled_missing"));

  const missingCostsEntities = entitiesByCode("missing_admission_cost");
  assert.ok(missingCostsEntities.has("attr_active_missing"));
  assert.ok(!missingCostsEntities.has("attr_disabled_missing"));

  const duplicateIssues = openIssues.filter(
    (issue) => issue.code === "duplicate_place",
  );
  // One disabled entry sharing a place_id with one active entry leaves a
  // single active record — no duplicate warning should fire.
  assert.equal(duplicateIssues.length, 0);

  const mockEntities = entitiesByCode("mock_data_present");
  assert.ok(mockEntities.has("attr_disabled_mock"));
});

test("runDataQualityScan auto-resolves fixed scanner-managed issues", async () => {
  let nodes: GraphNode[] = [
    makeAttraction("attr_fixable", "Hawa Mahal", {}),
  ];
  const edges: GraphEdge[] = [makeEdge("edge_ok")];
  const store = createIssueStore();

  await runDataQualityScan(
    { resolvedBy: "admin@example.com" },
    {
      listNodes: async () => nodes,
      listEdges: async () => edges,
      listAttractionOpeningHoursByAttractionIds: async () => [],
      listAttractionAdmissionRulesByAttractionIds: async () => [],
      listHotelOfferSnapshots: async () => [],
      listProviderCallLogs: async () => [],
      listOpenIssues: store.listOpenIssues,
      createIssue: store.createIssue,
      resolveIssue: store.resolveIssue,
      nowMs: () => 3_000_000_000_000,
    },
  );

  const beforeFixOpen = store.getOpenIssues();
  assert.ok(beforeFixOpen.some((issue) => issue.code === "missing_google_place_id"));

  nodes = [
    makeAttraction("attr_fixable", "Hawa Mahal", {
      google_place_id: "place_hawa_mahal",
    }),
  ];
  const openingHours: AttractionOpeningHours[] = [
    makeOpeningHours("attr_fixable", "rajasthan"),
  ];
  const admissions: AttractionAdmissionRule[] = [
    makeAdmissionRule("attr_fixable"),
  ];

  const secondRun = await runDataQualityScan(
    { resolvedBy: "admin@example.com" },
    {
      listNodes: async () => nodes,
      listEdges: async () => edges,
      listAttractionOpeningHoursByAttractionIds: async () => openingHours,
      listAttractionAdmissionRulesByAttractionIds: async () => admissions,
      listHotelOfferSnapshots: async () => [],
      listProviderCallLogs: async () => [],
      listOpenIssues: store.listOpenIssues,
      createIssue: store.createIssue,
      resolveIssue: store.resolveIssue,
      nowMs: () => 3_000_000_010_000,
    },
  );

  assert.equal(store.getOpenIssues().length, 0);
  assert.ok(secondRun.auto_resolved >= 1);
  const resolvedIssues = store
    .getAllIssues()
    .filter((issue) => issue.status === "resolved");
  assert.ok(resolvedIssues.length >= 1);
  assert.ok(resolvedIssues.every((issue) => issue.resolved_by === "admin@example.com"));
});

test("runDataQualityScan surfaces and resolves hotel rate/provider issues from latest LiteAPI data", async () => {
  const store = createIssueStore();
  let snapshots: HotelOfferSnapshot[] = [
    makeOfferSnapshot({
      id: "offer_empty_latest",
      node_id: "node_jaipur",
      status: "empty",
      result_count: 0,
      offers: [],
      fetched_at: 5_000_000_000_200,
    }),
    makeOfferSnapshot({
      id: "offer_error_latest",
      node_id: "node_udaipur",
      status: "error",
      result_count: 0,
      offers: [],
      error_code: "liteapi_timeout",
      error_message: "upstream timeout",
      fetched_at: 5_000_000_000_300,
    }),
  ];
  let providerLogs: ProviderCallLog[] = [
    makeProviderCallLog({
      id: "log_timeout_latest",
      node_id: "node_jodhpur",
      endpoint: "/hotels/rates",
      status: "timeout",
      created_at: 5_000_000_000_400,
    }),
  ];

  const firstRun = await runDataQualityScan(
    { resolvedBy: "admin@example.com" },
    {
      listNodes: async () => [],
      listEdges: async () => [],
      listAttractionOpeningHoursByAttractionIds: async () => [],
      listAttractionAdmissionRulesByAttractionIds: async () => [],
      listHotelOfferSnapshots: async () => snapshots,
      listProviderCallLogs: async () => providerLogs,
      listOpenIssues: store.listOpenIssues,
      createIssue: store.createIssue,
      resolveIssue: store.resolveIssue,
      nowMs: () => 5_000_000_001_000,
    },
  );

  assert.ok(firstRun.issue_ids.some((id) => id.includes("no_hotel_rates")));
  assert.ok(firstRun.issue_ids.some((id) => id.includes("liteapi_error")));
  const openAfterFirstRun = store.getOpenIssues();
  assert.ok(openAfterFirstRun.some((issue) => issue.code === "no_hotel_rates"));
  assert.ok(openAfterFirstRun.some((issue) => issue.code === "liteapi_error"));

  snapshots = [
    makeOfferSnapshot({
      id: "offer_success_latest",
      node_id: "node_jaipur",
      status: "success",
      result_count: 3,
      offers: [makeOffer("hotel_a"), makeOffer("hotel_b"), makeOffer("hotel_c")],
      fetched_at: 5_000_000_001_200,
    }),
    makeOfferSnapshot({
      id: "offer_success_udaipur",
      node_id: "node_udaipur",
      status: "success",
      result_count: 2,
      offers: [makeOffer("hotel_u1"), makeOffer("hotel_u2")],
      fetched_at: 5_000_000_001_300,
    }),
  ];
  providerLogs = [
    makeProviderCallLog({
      id: "log_success_latest",
      node_id: "node_jodhpur",
      endpoint: "/hotels/rates",
      status: "success",
      created_at: 5_000_000_001_400,
    }),
  ];

  const secondRun = await runDataQualityScan(
    { resolvedBy: "admin@example.com" },
    {
      listNodes: async () => [],
      listEdges: async () => [],
      listAttractionOpeningHoursByAttractionIds: async () => [],
      listAttractionAdmissionRulesByAttractionIds: async () => [],
      listHotelOfferSnapshots: async () => snapshots,
      listProviderCallLogs: async () => providerLogs,
      listOpenIssues: store.listOpenIssues,
      createIssue: store.createIssue,
      resolveIssue: store.resolveIssue,
      nowMs: () => 5_000_000_002_000,
    },
  );

  assert.equal(store.getOpenIssues().length, 0);
  assert.ok(secondRun.auto_resolved >= 2);
});

function createIssueStore() {
  const issues = new Map<string, DataQualityIssue>();
  let now = 1_650_000_000_000;

  return {
    listOpenIssues: async () =>
      Array.from(issues.values()).filter((issue) => issue.status === "open"),

    createIssue: async (input: CreateDataQualityIssueInput) => {
      const existing = issues.get(input.id);
      const next: DataQualityIssue = {
        id: input.id,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        severity: input.severity,
        code: input.code,
        message: input.message,
        details: input.details,
        status: "open",
        created_at: existing?.created_at ?? input.created_at ?? now++,
      };
      issues.set(input.id, next);
      return next;
    },

    resolveIssue: async (issueId: string, resolvedBy: string) => {
      const existing = issues.get(issueId);
      if (!existing) return;
      issues.set(issueId, {
        ...existing,
        status: "resolved",
        resolved_at: now++,
        resolved_by: resolvedBy,
      });
    },

    getOpenIssues: () =>
      Array.from(issues.values()).filter((issue) => issue.status === "open"),

    getAllIssues: () => Array.from(issues.values()),
  };
}

function makeAttraction(
  id: string,
  name: string,
  metadata: Record<string, unknown>,
): GraphNode {
  return {
    id,
    type: "attraction",
    name,
    region: "rajasthan",
    country: "india",
    tags: ["heritage"],
    metadata,
    location: { lat: 26.9, lng: 75.8 },
    parent_node_id: "node_jaipur",
  };
}

function makeEdge(id: string, overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id,
    from: "node_jaipur",
    to: "node_udaipur",
    type: "road",
    distance_km: 390,
    travel_time_hours: 7,
    regions: ["rajasthan"],
    metadata: {},
    ...overrides,
  };
}

function makeOpeningHours(
  attractionId: string,
  region: string,
): AttractionOpeningHours {
  return {
    id: attractionId,
    attraction_id: attractionId,
    region,
    timezone: "Asia/Kolkata",
    weekly_periods: [{ day: "mon", opens: "09:00", closes: "17:00" }],
    source_type: "manual",
    confidence: "verified",
    fetched_at: 3_000_000_000_000,
    verified_at: 3_000_000_000_000,
  };
}

function makeAdmissionRule(attractionNodeId: string): AttractionAdmissionRule {
  return {
    id: `${attractionNodeId}__adult__any`,
    attraction_node_id: attractionNodeId,
    region: "rajasthan",
    currency: "INR",
    amount: 50,
    audience: "adult",
    nationality: "any",
    source_type: "manual",
    confidence: "verified",
    source_url: null,
    notes: null,
    valid_from: null,
    valid_until: null,
    fetched_at: 3_000_000_000_000,
    verified_at: 3_000_000_000_000,
    verified_by: "admin@example.com",
    data_version: 2,
  };
}

function makeOfferSnapshot(
  overrides: Partial<HotelOfferSnapshot> & Pick<HotelOfferSnapshot, "id" | "node_id">,
): HotelOfferSnapshot {
  return {
    id: overrides.id,
    cache_key: overrides.cache_key ?? `cache_${overrides.id}`,
    provider: "liteapi",
    region: overrides.region ?? "rajasthan",
    node_id: overrides.node_id,
    hotel_ids: overrides.hotel_ids ?? ["hotel_1"],
    checkin: overrides.checkin ?? "2099-06-10",
    checkout: overrides.checkout ?? "2099-06-12",
    nights: overrides.nights ?? 2,
    currency: overrides.currency ?? "INR",
    guest_nationality: overrides.guest_nationality ?? "IN",
    occupancies: overrides.occupancies ?? [{ adults: 2, children_ages: [] }],
    offers: overrides.offers ?? [],
    min_total_amount: overrides.min_total_amount ?? null,
    min_nightly_amount: overrides.min_nightly_amount ?? null,
    result_count: overrides.result_count ?? 0,
    status: overrides.status ?? "empty",
    fetched_at: overrides.fetched_at ?? 5_000_000_000_000,
    expires_at: overrides.expires_at ?? 5_000_000_030_000,
    error_code: overrides.error_code ?? null,
    error_message: overrides.error_message ?? null,
  };
}

function makeOffer(hotelId: string) {
  return {
    provider: "liteapi" as const,
    provider_hotel_id: hotelId,
    room_type_id: `${hotelId}_room`,
    room_name: "Deluxe",
    board_type: null,
    board_name: null,
    total_amount: 12_000,
    nightly_amount: 6_000,
    currency: "INR",
    max_occupancy: 2,
    adult_count: 2,
    child_count: 0,
    refundable_tag: null,
    provider_offer_id_hash: `${hotelId}_hash`,
  };
}

function makeProviderCallLog(
  overrides: Partial<ProviderCallLog> &
    Pick<ProviderCallLog, "id" | "endpoint" | "status" | "created_at">,
): ProviderCallLog {
  return {
    id: overrides.id,
    provider: "liteapi",
    endpoint: overrides.endpoint,
    request_summary: overrides.request_summary ?? {},
    status: overrides.status,
    duration_ms: overrides.duration_ms ?? 500,
    result_count: overrides.result_count ?? 0,
    error_code: overrides.error_code ?? null,
    error_message: overrides.error_message ?? null,
    created_at: overrides.created_at,
    region: overrides.region ?? "rajasthan",
    node_id: overrides.node_id,
  };
}
