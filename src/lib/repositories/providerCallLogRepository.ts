import type {
  ProviderCallLog,
  ProviderCallStatus,
  ProviderName,
} from "@/lib/providers/hotels/types";
import type { Query } from "firebase-admin/firestore";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

const PROVIDER_CALL_STATUSES = new Set<ProviderCallStatus>([
  "success",
  "empty",
  "error",
  "timeout",
  "disabled",
]);
const PROVIDERS = new Set<ProviderName>(["liteapi", "google_places"]);

export interface CreateProviderCallLogInput {
  id?: string;
  provider: ProviderCallLog["provider"];
  endpoint: string;
  request_summary: Record<string, unknown>;
  status: ProviderCallStatus;
  duration_ms: number;
  result_count: number;
  error_code?: string | null;
  error_message?: string | null;
  region?: string;
  node_id?: string;
  created_at?: number;
}

function db() {
  return getAdminDb();
}

export async function createProviderCallLog(
  input: CreateProviderCallLogInput,
): Promise<ProviderCallLog> {
  const id = normaliseString(input.id) ?? db().collection(COLLECTIONS.provider_call_logs).doc().id;
  const normalised = normaliseProviderCallLog({
    ...input,
    id,
    created_at: normaliseFiniteNumber(input.created_at) ?? Date.now(),
  });

  await withFirestoreDiagnostics("createProviderCallLog", async () => {
    await db()
      .collection(COLLECTIONS.provider_call_logs)
      .doc(id)
      .set(stripUndefinedDeep(normalised), { merge: true });
  });

  return normalised;
}

export async function getProviderCallLog(
  id: string,
): Promise<ProviderCallLog | null> {
  const logId = normaliseString(id);
  if (!logId) return null;
  const snap = await db().collection(COLLECTIONS.provider_call_logs).doc(logId).get();
  if (!snap.exists) return null;
  return normaliseProviderCallLog({
    id: snap.id,
    ...(snap.data() as Partial<ProviderCallLog>),
  });
}

export async function listProviderCallLogs(args: {
  limit?: number;
  provider?: ProviderCallLog["provider"];
  endpoint?: string;
  region?: string;
  node_id?: string;
} = {}): Promise<ProviderCallLog[]> {
  let query: Query = db().collection(COLLECTIONS.provider_call_logs);
  if (args.provider) query = query.where("provider", "==", args.provider);
  if (args.endpoint) query = query.where("endpoint", "==", args.endpoint);
  if (args.region) query = query.where("region", "==", args.region);
  if (args.node_id) query = query.where("node_id", "==", args.node_id);

  const maxLimit = Math.max(1, Math.min(Math.trunc(args.limit ?? 50), 200));
  const snap = await query.get();

  return snap.docs
    .map((doc) =>
      normaliseProviderCallLog({
        id: doc.id,
        ...(doc.data() as Partial<ProviderCallLog>),
      }),
    )
    .sort((left, right) => right.created_at - left.created_at)
    .slice(0, maxLimit);
}

function normaliseProviderCallLog(
  raw: Partial<ProviderCallLog> & { id: string },
): ProviderCallLog {
  const status = PROVIDER_CALL_STATUSES.has(raw.status as ProviderCallStatus)
    ? (raw.status as ProviderCallStatus)
    : "error";
  const provider = PROVIDERS.has(raw.provider as ProviderName)
    ? (raw.provider as ProviderName)
    : "liteapi";
  return {
    id: raw.id,
    provider,
    endpoint: normaliseString(raw.endpoint) ?? "",
    request_summary: normaliseRecord(raw.request_summary),
    status,
    duration_ms: Math.max(0, Math.round(normaliseFiniteNumber(raw.duration_ms) ?? 0)),
    result_count: Math.max(0, Math.round(normaliseFiniteNumber(raw.result_count) ?? 0)),
    error_code: normaliseNullableString(raw.error_code),
    error_message: normaliseNullableString(raw.error_message),
    created_at: Math.max(
      0,
      Math.round(normaliseFiniteNumber(raw.created_at) ?? Date.now()),
    ),
    region: normaliseString(raw.region) ?? undefined,
    node_id: normaliseString(raw.node_id) ?? undefined,
  };
}

function normaliseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return stripUndefinedDeep(value as Record<string, unknown>);
}

function normaliseFiniteNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normaliseString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseNullableString(value: unknown): string | null {
  return normaliseString(value);
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      const cleaned = stripUndefinedDeep(nested);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out as T;
  }

  return value;
}
