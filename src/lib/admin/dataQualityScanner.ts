import type {
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

const SCANNER_MANAGED_CODES = new Set<DataQualityIssueCode>([
  "mock_data_present",
  "missing_google_place_id",
  "missing_opening_hours",
  "missing_admission_cost",
  "duplicate_place",
  "route_edge_missing",
]);

export interface DataQualityScanOptions {
  resolvedBy?: string;
}

export interface DataQualityScanDependencies {
  listNodes?: () => Promise<GraphNode[]>;
  listEdges?: () => Promise<GraphEdge[]>;
  listOpenIssues?: () => Promise<DataQualityIssue[]>;
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
  const listOpenIssuesFn =
    deps.listOpenIssues ??
    (() => listOpenIssues({ status: "open", limit: 2_000 }));
  const createIssueFn = deps.createIssue ?? createIssue;
  const resolveIssueFn = deps.resolveIssue ?? resolveIssue;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const resolvedBy = (options.resolvedBy ?? "data_quality_scanner").trim();

  const [nodes, edges, currentlyOpenIssues] = await Promise.all([
    listNodesFn(),
    listEdgesFn(),
    listOpenIssuesFn(),
  ]);

  const attractions = nodes.filter((node) => node.type === "attraction");
  const generated = new Map<string, CreateDataQualityIssueInput>();

  // Hotel-rate quality checks are intentionally deferred until LiteAPI
  // snapshot persistence lands in the next phase.
  for (const issue of [
    ...buildMockDataIssues(nodes),
    ...buildAttractionCoverageIssues(attractions),
    ...buildDuplicatePlaceIssues(attractions),
    ...buildRouteEdgeIssues(edges),
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
): CreateDataQualityIssueInput[] {
  const issues: CreateDataQualityIssueInput[] = [];

  for (const attraction of attractions) {
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

    if (!hasOpeningHours(metadata)) {
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

    if (!hasAdmissionCostData(metadata)) {
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

function toEntityType(node: GraphNode): DataQualityEntityType {
  if (node.type === "city") return "city";
  if (node.type === "attraction") return "attraction";
  if (node.type === "hotel") return "hotel";
  return "region";
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

function hasAdmissionCostData(metadata: Record<string, unknown>): boolean {
  if (Array.isArray(metadata.admission_costs) && metadata.admission_costs.length > 0) {
    return true;
  }

  if (asRecord(metadata.admission)) {
    return true;
  }

  return (
    isFiniteNumber(metadata.admission_cost) ||
    isFiniteNumber(metadata.entry_fee) ||
    isFiniteNumber(metadata.ticket_price)
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
