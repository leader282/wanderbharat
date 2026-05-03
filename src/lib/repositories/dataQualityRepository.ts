import { createHash } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";

import type {
  DataQualityEntityType,
  DataQualityIssue,
  DataQualityIssueCode,
  DataQualityIssueSeverity,
  DataQualityIssueStatus,
} from "@/types/domain";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

const DEFAULT_LIMIT = 500;

const DATA_QUALITY_STATUS_SET = new Set<DataQualityIssueStatus>([
  "open",
  "ignored",
  "resolved",
]);
const DATA_QUALITY_SEVERITY_SET = new Set<DataQualityIssueSeverity>([
  "info",
  "warning",
  "critical",
]);

export interface ListDataQualityIssuesQuery {
  status?: DataQualityIssueStatus;
  severity?: DataQualityIssueSeverity;
  entity_type?: DataQualityEntityType;
  limit?: number;
}

export interface CreateDataQualityIssueInput {
  id: string;
  entity_type: DataQualityEntityType;
  entity_id?: string;
  severity: DataQualityIssueSeverity;
  code: DataQualityIssueCode;
  message: string;
  details?: Record<string, unknown>;
  created_at?: number;
}

export function buildDataQualityIssueId(
  code: DataQualityIssueCode,
  entityType: DataQualityEntityType,
  entityId: string,
): string {
  const normalizedEntity = sanitizeForId(entityId);
  const digest = createHash("sha1")
    .update(`${code}|${entityType}|${entityId}`)
    .digest("hex")
    .slice(0, 12);
  return `dqi_${code}_${normalizedEntity}_${digest}`;
}

function db(): Firestore {
  return getAdminDb();
}

/**
 * Lists scan issues with `open` as the default status.
 * Severity/entity filters are applied in-memory to avoid index churn.
 */
export async function listOpenIssues(
  query: ListDataQualityIssuesQuery = {},
): Promise<DataQualityIssue[]> {
  const status = query.status ?? "open";
  const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_LIMIT, 2_000));

  return withFirestoreDiagnostics("listOpenIssues", async () => {
    const snap = await db()
      .collection(COLLECTIONS.data_quality_issues)
      .where("status", "==", status)
      .limit(limit)
      .get();

    const issues = snap.docs
      .map((doc) =>
        normaliseIssue(doc.id, doc.data() as Partial<DataQualityIssue>),
      )
      .filter((issue) =>
        query.severity ? issue.severity === query.severity : true,
      )
      .filter((issue) =>
        query.entity_type ? issue.entity_type === query.entity_type : true,
      )
      .sort((left, right) => right.created_at - left.created_at);

    return issues;
  });
}

/**
 * Upsert an issue and force it back to open state.
 * Stable issue ids make repeated scans idempotent.
 */
export async function createIssue(
  input: CreateDataQualityIssueInput,
): Promise<DataQualityIssue> {
  const id = input.id.trim();
  if (!id) {
    throw new Error("createIssue requires a non-empty id.");
  }

  return withFirestoreDiagnostics("createIssue", async () => {
    const ref = db().collection(COLLECTIONS.data_quality_issues).doc(id);
    const existing = await ref.get();
    const existingCreatedAt = existing.get("created_at");
    const existingStatus = existing.get("status");
    const status: DataQualityIssueStatus =
      existingStatus === "ignored" ? "ignored" : "open";
    const created_at = Number.isFinite(existingCreatedAt)
      ? Number(existingCreatedAt)
      : (input.created_at ?? Date.now());

    const issue: DataQualityIssue = {
      id,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      severity: input.severity,
      code: input.code,
      message: input.message.trim(),
      details: input.details,
      status,
      created_at,
    };

    await ref.set(
      stripUndefinedDeep({
        ...issue,
        ...(status === "open"
          ? {
              resolved_at: null,
              resolved_by: null,
            }
          : {}),
      }),
      { merge: true },
    );

    return issue;
  });
}

export async function resolveIssue(
  issueId: string,
  resolvedBy: string,
): Promise<void> {
  await updateIssueStatus(issueId, "resolved", resolvedBy);
}

export async function ignoreIssue(
  issueId: string,
  resolvedBy: string,
): Promise<void> {
  await updateIssueStatus(issueId, "ignored", resolvedBy);
}

async function updateIssueStatus(
  issueId: string,
  status: DataQualityIssueStatus,
  resolvedBy: string,
): Promise<void> {
  const id = issueId.trim();
  if (!id) {
    throw new Error("Issue id is required.");
  }

  const actor = resolvedBy.trim();
  if (!actor) {
    throw new Error("resolvedBy is required.");
  }

  await withFirestoreDiagnostics(`updateIssueStatus:${status}`, async () => {
    await db().collection(COLLECTIONS.data_quality_issues).doc(id).set(
      {
        status,
        resolved_at: Date.now(),
        resolved_by: actor,
      },
      { merge: true },
    );
  });
}

function normaliseIssue(
  docId: string,
  raw: Partial<DataQualityIssue>,
): DataQualityIssue {
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : docId,
    entity_type: raw.entity_type ?? "region",
    entity_id: normaliseOptionalString(raw.entity_id),
    severity: DATA_QUALITY_SEVERITY_SET.has(raw.severity as DataQualityIssueSeverity)
      ? (raw.severity as DataQualityIssueSeverity)
      : "warning",
    code: raw.code ?? "itinerary_warning",
    message:
      typeof raw.message === "string" && raw.message.trim()
        ? raw.message.trim()
        : "Data quality issue",
    details:
      raw.details && typeof raw.details === "object"
        ? (raw.details as Record<string, unknown>)
        : undefined,
    status: DATA_QUALITY_STATUS_SET.has(raw.status as DataQualityIssueStatus)
      ? (raw.status as DataQualityIssueStatus)
      : "open",
    created_at: Number.isFinite(raw.created_at)
      ? Number(raw.created_at)
      : Date.now(),
    resolved_at: Number.isFinite(raw.resolved_at)
      ? Number(raw.resolved_at)
      : undefined,
    resolved_by: normaliseOptionalString(raw.resolved_by),
  };
}

function normaliseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeForId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  const trimmed = normalized.replace(/^_+|_+$/g, "");
  if (trimmed.length === 0) return "unknown";
  return trimmed.slice(0, 48);
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => entry !== undefined) as T;
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      out[key] = stripUndefinedDeep(nested);
    }
    return out as T;
  }

  return value;
}
