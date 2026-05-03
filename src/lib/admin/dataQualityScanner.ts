import type {
  AttractionAdmissionRule,
  AttractionOpeningHours,
  DataQualityEntityType,
  DataQualityIssue,
  DataQualityIssueCode,
  DataQualityIssueSeverity,
  GraphEdge,
  GraphNode,
} from "@/types/domain";
import { findEdges } from "@/lib/repositories/edgeRepository";
import { findNodes } from "@/lib/repositories/nodeRepository";
import {
  buildDataQualityIssueId,
  createIssue,
  listOpenIssues,
  resolveIssue,
  type CreateDataQualityIssueInput,
} from "@/lib/repositories/dataQualityRepository";
import { listByAttractionIds } from "@/lib/repositories/attractionAdmissionRepository";
import { getAttractionOpeningHoursByAttractionIds } from "@/lib/repositories/attractionHoursRepository";
import { listHotelOfferSnapshots } from "@/lib/repositories/hotelOfferSnapshotRepository";
import { listProviderCallLogs } from "@/lib/repositories/providerCallLogRepository";
import type { HotelOfferSnapshot, ProviderCallLog } from "@/lib/providers/hotels/types";

const SCANNER_MANAGED_CODES = new Set<DataQualityIssueCode>([
  "mock_data_present",
  "missing_google_place_id",
  "missing_opening_hours",
  "missing_admission_cost",
  "duplicate_place",
  "liteapi_error",
  "no_hotel_rates",
  "route_edge_missing",
]);

export interface DataQualityScanOptions {
  resolvedBy?: string;
}

export interface DataQualityScanDependencies {
  listNodes?: () => Promise<GraphNode[]>;
  listEdges?: () => Promise<GraphEdge[]>;
  listAttractionOpeningHoursByAttractionIds?: (
    attractionIds: string[],
  ) => Promise<AttractionOpeningHours[]>;
  listAttractionAdmissionRulesByAttractionIds?: (
    attractionIds: string[],
  ) => Promise<AttractionAdmissionRule[]>;
  listOpenIssues?: () => Promise<DataQualityIssue[]>;
  listHotelOfferSnapshots?: () => Promise<HotelOfferSnapshot[]>;
  listProviderCallLogs?: () => Promise<ProviderCallLog[]>;
  createIssue?: (
    issue: CreateDataQualityIssueInput,
  ) => Promise<DataQualityIssue>;
  resolveIssue?: (issueId: string, resolvedBy: string) => Promise<void>;
  nowMs?: () => number;
}

export interface DataQualityScanResult {
  scanned_at: number;
  scanned_nodes: number;
  scanned_attractions: number;
  scanned_edges: number;
  created_or_reopened: number;
  auto_resolved: number;
  counts_by_severity: Record<DataQualityIssueSeverity, number>;
  issue_ids: string[];
}

export async function runDataQualityScan(
  options: DataQualityScanOptions = {},
  deps: DataQualityScanDependencies = {},
): Promise<DataQualityScanResult> {
  const listNodesFn = deps.listNodes ?? (() => findNodes());
  const listEdgesFn = deps.listEdges ?? (() => findEdges());
  const listAttractionOpeningHoursByAttractionIdsFn =
    deps.listAttractionOpeningHoursByAttractionIds ??
    getAttractionOpeningHoursByAttractionIds;
  const listAttractionAdmissionRulesByAttractionIdsFn =
    deps.listAttractionAdmissionRulesByAttractionIds ?? listByAttractionIds;
  const listOpenIssuesFn =
    deps.listOpenIssues ??
    (() => listOpenIssues({ status: "open", limit: 2_000 }));
  const listHotelOfferSnapshotsFn =
    deps.listHotelOfferSnapshots ??
    (() => listHotelOfferSnapshots({ limit: 500 }));
  const listProviderCallLogsFn =
    deps.listProviderCallLogs ??
    (() => listProviderCallLogs({ provider: "liteapi", limit: 500 }));
  const createIssueFn = deps.createIssue ?? createIssue;
  const resolveIssueFn = deps.resolveIssue ?? resolveIssue;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const resolvedBy = (options.resolvedBy ?? "data_quality_scanner").trim();

  const [nodes, edges, currentlyOpenIssues, hotelOfferSnapshots, providerCallLogs] =
    await Promise.all([
    listNodesFn(),
    listEdgesFn(),
    listOpenIssuesFn(),
      listHotelOfferSnapshotsFn(),
      listProviderCallLogsFn(),
    ]);

  const attractions = nodes.filter((node) => node.type === "attraction");
  const attractionIds = attractions.map((attraction) => attraction.id);
  const [openingHoursRecords, attractionAdmissionRules] = await Promise.all([
    listAttractionOpeningHoursByAttractionIdsFn(attractionIds),
    listAttractionAdmissionRulesByAttractionIdsFn(attractionIds),
  ]);
  const openingHoursByAttractionId = new Map(
    openingHoursRecords.map((record) => [record.attraction_id, record]),
  );
  const admissionRulesByAttractionId = new Map<string, AttractionAdmissionRule[]>();
  for (const rule of attractionAdmissionRules) {
    const list = admissionRulesByAttractionId.get(rule.attraction_node_id) ?? [];
    list.push(rule);
    admissionRulesByAttractionId.set(rule.attraction_node_id, list);
  }
  const generated = new Map<string, CreateDataQualityIssueInput>();

  for (const issue of [
    ...buildMockDataIssues(nodes),
    ...buildAttractionCoverageIssues(
      attractions,
      openingHoursByAttractionId,
      admissionRulesByAttractionId,
    ),
    ...buildDuplicatePlaceIssues(attractions),
    ...buildRouteEdgeIssues(edges),
    ...buildHotelRateIssues(hotelOfferSnapshots, providerCallLogs),
  ]) {
    generated.set(issue.id, issue);
  }

  const issuesToUpsert = Array.from(generated.values()).sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  const counts = emptySeverityCounts();
  for (const issue of issuesToUpsert) {
    counts[issue.severity] += 1;
    await createIssueFn(issue);
  }

  const activeIssueIds = new Set(issuesToUpsert.map((issue) => issue.id));
  let autoResolved = 0;
  for (const openIssue of currentlyOpenIssues) {
    if (!SCANNER_MANAGED_CODES.has(openIssue.code)) continue;
    if (activeIssueIds.has(openIssue.id)) continue;
    await resolveIssueFn(openIssue.id, resolvedBy);
    autoResolved += 1;
  }

  return {
    scanned_at: nowMs(),
    scanned_nodes: nodes.length,
    scanned_attractions: attractions.length,
    scanned_edges: edges.length,
    created_or_reopened: issuesToUpsert.length,
    auto_resolved: autoResolved,
    counts_by_severity: counts,
    issue_ids: issuesToUpsert.map((issue) => issue.id),
  };
}

function buildMockDataIssues(nodes: GraphNode[]): CreateDataQualityIssueInput[] {
  const issues: CreateDataQualityIssueInput[] = [];

  for (const node of nodes) {
    if (!containsMockMarker(node)) continue;
    const entityType = toEntityType(node);

    issues.push({
      id: buildIssueId("mock_data_present", entityType, node.id),
      entity_type: entityType,
      entity_id: node.id,
      severity: "critical",
      code: "mock_data_present",
      message: `Mock marker found on ${entityType} "${node.name}".`,
      details: {
        node_id: node.id,
        node_type: node.type,
      },
    });
  }

  return issues;
}

function buildAttractionCoverageIssues(
  attractions: GraphNode[],
  openingHoursByAttractionId: Map<string, AttractionOpeningHours>,
  admissionRulesByAttractionId: Map<string, AttractionAdmissionRule[]>,
): CreateDataQualityIssueInput[] {
  const issues: CreateDataQualityIssueInput[] = [];

  for (const attraction of attractions) {
    // Disabled attractions are soft-deleted retirees. The planner already
    // skips them (see loadContext.ts), so admins shouldn't keep seeing
    // missing-data warnings on records they intentionally retired. Mock
    // contamination is intentionally not gated on `disabled` — that signal
    // belongs in `buildMockDataIssues` even for retired records, since
    // mock leakage anywhere is worth surfacing.
    if (isAttractionDisabled(attraction)) continue;

    const metadata = asRecord(attraction.metadata) ?? {};
    const placeId = normaliseString(metadata.google_place_id);

    if (!placeId) {
      issues.push({
        id: buildIssueId(
          "missing_google_place_id",
          "attraction",
          attraction.id,
        ),
        entity_type: "attraction",
        entity_id: attraction.id,
        severity: "warning",
        code: "missing_google_place_id",
        message: `Attraction "${attraction.name}" is missing google_place_id.`,
        details: {
          attraction_name: attraction.name,
          parent_node_id: attraction.parent_node_id,
        },
      });
    }

    const openingHoursRecord = openingHoursByAttractionId.get(attraction.id);
    const hasHoursCoverage =
      hasUsableOpeningHoursRecord(openingHoursRecord) || hasOpeningHours(metadata);
    if (!hasHoursCoverage) {
      issues.push({
        id: buildIssueId("missing_opening_hours", "attraction", attraction.id),
        entity_type: "attraction",
        entity_id: attraction.id,
        severity: "warning",
        code: "missing_opening_hours",
        message: `Attraction "${attraction.name}" has no opening-hours data.`,
        details: {
          attraction_name: attraction.name,
          parent_node_id: attraction.parent_node_id,
        },
      });
    }

    const admissionRules = admissionRulesByAttractionId.get(attraction.id) ?? [];
    const hasAdmissionCoverage =
      hasUsableAdmissionRules(admissionRules) || hasAdmissionCostData(metadata);
    if (!hasAdmissionCoverage) {
      issues.push({
        id: buildIssueId("missing_admission_cost", "attraction", attraction.id),
        entity_type: "attraction",
        entity_id: attraction.id,
        severity: "warning",
        code: "missing_admission_cost",
        message: `Attraction "${attraction.name}" is missing admission-cost metadata.`,
        details: {
          attraction_name: attraction.name,
          parent_node_id: attraction.parent_node_id,
        },
      });
    }
  }

  return issues;
}

function buildDuplicatePlaceIssues(
  attractions: GraphNode[],
): CreateDataQualityIssueInput[] {
  const placeIdMap = new Map<string, GraphNode[]>();

  for (const attraction of attractions) {
    // Skip disabled records on the duplicate axis too: an active and a
    // retired entry that share a place_id should not raise a duplicate
    // warning since the retired one is not a planning candidate. Two
    // active duplicates still flag.
    if (isAttractionDisabled(attraction)) continue;

    const metadata = asRecord(attraction.metadata) ?? {};
    const placeId = normaliseString(metadata.google_place_id);
    if (!placeId) continue;
    const existing = placeIdMap.get(placeId) ?? [];
    existing.push(attraction);
    placeIdMap.set(placeId, existing);
  }

  const issues: CreateDataQualityIssueInput[] = [];
  for (const [placeId, duplicates] of placeIdMap.entries()) {
    if (duplicates.length < 2) continue;

    issues.push({
      id: buildIssueId("duplicate_place", "attraction", placeId),
      entity_type: "attraction",
      entity_id: placeId,
      severity: "warning",
      code: "duplicate_place",
      message: `google_place_id "${placeId}" is duplicated across ${duplicates.length} attractions.`,
      details: {
        duplicate_node_ids: duplicates.map((node) => node.id),
        duplicate_names: duplicates.map((node) => node.name),
      },
    });
  }

  return issues;
}

function buildRouteEdgeIssues(edges: GraphEdge[]): CreateDataQualityIssueInput[] {
  const issues: CreateDataQualityIssueInput[] = [];

  for (const edge of edges) {
    const missingFields: string[] = [];
    if (!isPositiveNumber(edge.distance_km)) {
      missingFields.push("distance_km");
    }
    if (!isPositiveNumber(edge.travel_time_hours)) {
      missingFields.push("travel_time_hours");
    }
    if (!normaliseString(edge.from)) {
      missingFields.push("from");
    }
    if (!normaliseString(edge.to)) {
      missingFields.push("to");
    }

    if (missingFields.length === 0) continue;

    issues.push({
      id: buildIssueId("route_edge_missing", "route_edge", edge.id),
      entity_type: "route_edge",
      entity_id: edge.id,
      severity: "critical",
      code: "route_edge_missing",
      message: `Route edge "${edge.id}" is missing required routing fields.`,
      details: {
        from: edge.from,
        to: edge.to,
        missing_fields: missingFields,
      },
    });
  }

  return issues;
}

function buildHotelRateIssues(
  offerSnapshots: HotelOfferSnapshot[],
  providerCallLogs: ProviderCallLog[],
): CreateDataQualityIssueInput[] {
  const issues: CreateDataQualityIssueInput[] = [];

  const latestOfferByNode = new Map<string, HotelOfferSnapshot>();
  for (const snapshot of offerSnapshots) {
    if (snapshot.provider !== "liteapi") continue;
    const nodeId = normaliseString(snapshot.node_id);
    if (!nodeId) continue;
    const existing = latestOfferByNode.get(nodeId);
    if (!existing || snapshot.fetched_at > existing.fetched_at) {
      latestOfferByNode.set(nodeId, snapshot);
    }
  }

  for (const [nodeId, snapshot] of latestOfferByNode.entries()) {
    const hasNoRates =
      snapshot.status !== "error" &&
      snapshot.result_count <= 0 &&
      snapshot.offers.length === 0;
    if (hasNoRates) {
      issues.push({
        id: buildIssueId("no_hotel_rates", "hotel", nodeId),
        entity_type: "hotel",
        entity_id: nodeId,
        severity: "warning",
        code: "no_hotel_rates",
        message: `No hotel rates are available for city node "${nodeId}" in the latest LiteAPI snapshot.`,
        details: {
          snapshot_id: snapshot.id,
          status: snapshot.status,
          region: snapshot.region,
          fetched_at: snapshot.fetched_at,
        },
      });
    }

    if (snapshot.status === "error") {
      const errorCode = normaliseString(snapshot.error_code) ?? "provider_error";
      issues.push({
        id: buildIssueId("liteapi_error", "provider_call", nodeId),
        entity_type: "provider_call",
        entity_id: nodeId,
        severity: "critical",
        code: "liteapi_error",
        message: `Latest LiteAPI rate snapshot for "${nodeId}" failed (${errorCode}).`,
        details: {
          snapshot_id: snapshot.id,
          status: snapshot.status,
          error_code: snapshot.error_code ?? null,
          error_message: snapshot.error_message ?? null,
          fetched_at: snapshot.fetched_at,
        },
      });
    }
  }

  const latestLogsByTarget = new Map<string, ProviderCallLog>();
  for (const log of providerCallLogs) {
    if (log.provider !== "liteapi") continue;
    const endpoint = normaliseString(log.endpoint);
    if (!endpoint) continue;
    const nodeId = normaliseString(log.node_id);
    const region = normaliseString(log.region) ?? "global";
    const key = nodeId ? `${nodeId}:${endpoint}` : `${region}:${endpoint}`;
    const existing = latestLogsByTarget.get(key);
    if (!existing || log.created_at > existing.created_at) {
      latestLogsByTarget.set(key, log);
    }
  }

  for (const log of latestLogsByTarget.values()) {
    if (
      log.status !== "error" &&
      log.status !== "timeout" &&
      log.status !== "disabled"
    ) {
      continue;
    }
    const endpoint = normaliseString(log.endpoint) ?? "unknown_endpoint";
    const nodeId = normaliseString(log.node_id);
    const region = normaliseString(log.region) ?? "global";
    const issueEntityId = nodeId ?? `${region}:${endpoint}`;
    const errorCode = normaliseString(log.error_code) ?? log.status;
    const targetLabel = nodeId ?? `${region} (${endpoint})`;

    issues.push({
      id: buildIssueId("liteapi_error", "provider_call", issueEntityId),
      entity_type: "provider_call",
      entity_id: issueEntityId,
      severity: "critical",
      code: "liteapi_error",
      message: `Latest LiteAPI call for "${targetLabel}" failed (${errorCode}).`,
      details: {
        provider_call_log_id: log.id,
        endpoint,
        status: log.status,
        error_code: log.error_code ?? null,
        error_message: log.error_message ?? null,
        created_at: log.created_at,
      },
    });
  }

  return issues;
}

function toEntityType(node: GraphNode): DataQualityEntityType {
  if (node.type === "city") return "city";
  if (node.type === "attraction") return "attraction";
  if (node.type === "hotel") return "hotel";
  return "region";
}

function isAttractionDisabled(attraction: GraphNode): boolean {
  return attraction.metadata?.disabled === true;
}

function hasOpeningHours(metadata: Record<string, unknown>): boolean {
  const hasLegacyWindow =
    Boolean(normaliseString(metadata.opening_time)) &&
    Boolean(normaliseString(metadata.closing_time));
  if (hasLegacyWindow) {
    return true;
  }

  const openingPeriods = metadata.opening_periods;
  return Array.isArray(openingPeriods) && openingPeriods.length > 0;
}

function hasUsableOpeningHoursRecord(
  record: AttractionOpeningHours | undefined,
): boolean {
  if (!record) return false;
  if (record.confidence === "unknown") return false;
  if (record.weekly_periods.length > 0) return true;
  return (record.closed_days?.length ?? 0) > 0;
}

function hasAdmissionCostData(metadata: Record<string, unknown>): boolean {
  if (Array.isArray(metadata.admission_costs)) {
    for (const entry of metadata.admission_costs) {
      if (isFiniteNumber(entry)) return true;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const amount = (entry as Record<string, unknown>).amount;
      if (isFiniteNumber(amount)) return true;
    }
  }

  const admission = asRecord(metadata.admission);
  if (admission) {
    return Object.values(admission).some((value) => isFiniteNumber(value));
  }

  return (
    isFiniteNumber(metadata.admission_cost) ||
    isFiniteNumber(metadata.entry_fee) ||
    isFiniteNumber(metadata.ticket_price)
  );
}

function hasUsableAdmissionRules(rules: AttractionAdmissionRule[]): boolean {
  return rules.some(
    (rule) => rule.amount !== null && rule.confidence !== "unknown",
  );
}

function containsMockMarker(value: unknown): boolean {
  const visited = new WeakSet<object>();

  const visit = (candidate: unknown): boolean => {
    if (candidate === null || candidate === undefined) {
      return false;
    }
    if (typeof candidate !== "object") {
      return false;
    }

    if (visited.has(candidate)) {
      return false;
    }
    visited.add(candidate);

    if (Array.isArray(candidate)) {
      return candidate.some((entry) => visit(entry));
    }

    const record = candidate as Record<string, unknown>;
    if (record.source_type === "mock" || record.source === "mock") {
      return true;
    }

    return Object.values(record).some((entry) => visit(entry));
  };

  return visit(value);
}

function buildIssueId(
  code: DataQualityIssueCode,
  entityType: DataQualityEntityType,
  entityId: string,
): string {
  return buildDataQualityIssueId(code, entityType, entityId);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normaliseString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPositiveNumber(value: unknown): boolean {
  return isFiniteNumber(value) && Number(value) > 0;
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function emptySeverityCounts(): Record<DataQualityIssueSeverity, number> {
  return {
    info: 0,
    warning: 0,
    critical: 0,
  };
}
