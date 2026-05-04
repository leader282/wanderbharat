import type {
  AttractionAdmissionAudience,
  AttractionAdmissionConfidence,
  AttractionAdmissionNationality,
  AttractionAdmissionRule,
  AttractionAdmissionSourceType,
} from "@/types/domain";
import {
  ATTRACTION_ADMISSION_AUDIENCES,
  ATTRACTION_ADMISSION_CONFIDENCE_LEVELS,
  ATTRACTION_ADMISSION_NATIONALITIES,
  ATTRACTION_ADMISSION_SOURCE_TYPES,
  CURRENT_DATA_VERSION,
} from "@/types/domain";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { chunk } from "@/lib/utils/concurrency";

const AUDIENCE_SET = new Set<AttractionAdmissionAudience>(
  ATTRACTION_ADMISSION_AUDIENCES,
);
const NATIONALITY_SET = new Set<AttractionAdmissionNationality>(
  ATTRACTION_ADMISSION_NATIONALITIES,
);
const SOURCE_SET = new Set<AttractionAdmissionSourceType>(
  ATTRACTION_ADMISSION_SOURCE_TYPES,
);
const CONFIDENCE_SET = new Set<AttractionAdmissionConfidence>(
  ATTRACTION_ADMISSION_CONFIDENCE_LEVELS,
);
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_4217_PATTERN = /^[A-Z]{3}$/;

export interface MissingAttractionAdmission {
  attraction_id: string;
  reason: "no_rules" | "all_unknown";
}

function db() {
  return getAdminDb();
}

export async function listByAttractionIds(
  attractionIds: string[],
): Promise<AttractionAdmissionRule[]> {
  const ids = normaliseIdList(attractionIds);
  if (ids.length === 0) return [];

  const out: AttractionAdmissionRule[] = [];
  for (const ids10 of chunk(ids, 10)) {
    const snap = await db()
      .collection(COLLECTIONS.attraction_admissions)
      .where("attraction_node_id", "in", ids10)
      .get();
    for (const doc of snap.docs) {
      out.push(
        normaliseAdmissionRule(
          doc.id,
          doc.data() as Partial<AttractionAdmissionRule>,
        ),
      );
    }
  }

  return sortRules(out);
}

export async function findRuleById(
  ruleId: string,
): Promise<AttractionAdmissionRule | null> {
  const id = normaliseString(ruleId);
  if (!id) return null;
  const snap = await db()
    .collection(COLLECTIONS.attraction_admissions)
    .doc(id)
    .get();
  if (!snap.exists) return null;
  return normaliseAdmissionRule(
    snap.id,
    snap.data() as Partial<AttractionAdmissionRule>,
  );
}

export async function upsertRule(
  rule: AttractionAdmissionRule,
): Promise<AttractionAdmissionRule> {
  const id = normaliseString(rule.id);
  if (!id) {
    throw new Error("Attraction admission rule id is required.");
  }
  const normalised = normaliseAdmissionRule(id, rule);
  if (!normalised.attraction_node_id) {
    throw new Error("attraction_node_id is required.");
  }
  // Defence-in-depth: even if a caller bypassed the action layer, the
  // collection invariant must hold — a rule without a numeric amount can
  // only ever live as `confidence: "unknown"`.
  if (normalised.amount === null && normalised.confidence !== "unknown") {
    throw new Error(
      "Attraction admission rule with amount=null must have confidence=unknown.",
    );
  }
  if (
    normalised.amount !== null &&
    normalised.confidence === "unknown"
  ) {
    throw new Error(
      "Attraction admission rule with confidence=unknown must have amount=null.",
    );
  }

  await withFirestoreDiagnostics("upsertAttractionAdmissionRule", async () => {
    await db()
      .collection(COLLECTIONS.attraction_admissions)
      .doc(normalised.id)
      .set(stripUndefinedDeep(normalised), { merge: true });
  });

  return normalised;
}

export async function deleteRule(ruleId: string): Promise<void> {
  const id = normaliseString(ruleId);
  if (!id) {
    throw new Error("Attraction admission rule id is required.");
  }
  await withFirestoreDiagnostics("deleteAttractionAdmissionRule", async () => {
    await db().collection(COLLECTIONS.attraction_admissions).doc(id).delete();
  });
}

export async function listMissingForAttractions(
  attractionIds: string[],
): Promise<MissingAttractionAdmission[]> {
  const ids = normaliseIdList(attractionIds);
  if (ids.length === 0) return [];

  const rules = await listByAttractionIds(ids);
  const byAttractionId = new Map<string, AttractionAdmissionRule[]>();
  for (const rule of rules) {
    const list = byAttractionId.get(rule.attraction_node_id) ?? [];
    list.push(rule);
    byAttractionId.set(rule.attraction_node_id, list);
  }

  const missing: MissingAttractionAdmission[] = [];
  for (const attractionId of ids) {
    const rulesForAttraction = byAttractionId.get(attractionId) ?? [];
    if (rulesForAttraction.length === 0) {
      missing.push({ attraction_id: attractionId, reason: "no_rules" });
      continue;
    }
    if (!rulesForAttraction.some((rule) => hasUsableAmount(rule))) {
      missing.push({ attraction_id: attractionId, reason: "all_unknown" });
    }
  }
  return missing;
}

/**
 * Stable, deterministic doc id derived from a rule's structured pricing
 * axes. New rules created via the admin UI use this so quick-actions like
 * "Mark unknown (adult)" target a single canonical bucket per attraction.
 */
export function buildAdmissionRuleId(args: {
  attractionNodeId: string;
  audience: AttractionAdmissionAudience;
  nationality: AttractionAdmissionNationality;
  isStudent?: boolean;
}): string {
  const suffix = args.isStudent ? "__student" : "";
  return `${args.attractionNodeId}__${args.audience}__${args.nationality}${suffix}`;
}

function hasUsableAmount(rule: AttractionAdmissionRule): boolean {
  return rule.amount !== null && rule.confidence !== "unknown";
}

function normaliseAdmissionRule(
  docId: string,
  raw: Partial<AttractionAdmissionRule> & {
    /** Legacy single-field category persisted before structured axes existed. */
    category?: string;
  },
): AttractionAdmissionRule {
  const id = normaliseString(raw.id) ?? docId;
  const sourceType = SOURCE_SET.has(raw.source_type as AttractionAdmissionSourceType)
    ? (raw.source_type as AttractionAdmissionSourceType)
    : "system";
  const amount = normaliseNullableAmount(raw.amount);
  // Audience + nationality are authoritative going forward. If a legacy doc
  // only carries `category`, derive the structured fields from it so the
  // engine and admin UI never see an unexpected enum value.
  const legacyDerived = deriveStructuredFromLegacyCategory(
    typeof raw.category === "string" ? raw.category : undefined,
  );
  const audience = AUDIENCE_SET.has(raw.audience as AttractionAdmissionAudience)
    ? (raw.audience as AttractionAdmissionAudience)
    : (legacyDerived?.audience ?? "adult");
  const nationality = NATIONALITY_SET.has(
    raw.nationality as AttractionAdmissionNationality,
  )
    ? (raw.nationality as AttractionAdmissionNationality)
    : (legacyDerived?.nationality ?? "any");
  const isStudent =
    typeof raw.is_student === "boolean"
      ? raw.is_student
      : (legacyDerived?.is_student ?? undefined);
  // Enforce the invariant on read so downstream code can rely on it without
  // re-checking. amount=null is *always* unknown, even if persisted records
  // disagreed in older revisions.
  const persistedConfidence = CONFIDENCE_SET.has(
    raw.confidence as AttractionAdmissionConfidence,
  )
    ? (raw.confidence as AttractionAdmissionConfidence)
    : amount === null
      ? "unknown"
      : sourceType === "estimated"
        ? "estimated"
        : "verified";
  const confidence: AttractionAdmissionConfidence =
    amount === null ? "unknown" : persistedConfidence;

  return {
    id,
    attraction_node_id: normaliseString(raw.attraction_node_id) ?? "",
    region: normaliseString(raw.region),
    currency: normaliseCurrency(raw.currency),
    amount,
    audience,
    nationality,
    is_student: isStudent,
    source_type: sourceType,
    confidence,
    source_url: normaliseNullableString(raw.source_url),
    notes: normaliseNullableString(raw.notes),
    valid_from: normaliseNullableLocalDate(raw.valid_from),
    valid_until: normaliseNullableLocalDate(raw.valid_until),
    fetched_at: normaliseNullableNumber(raw.fetched_at),
    verified_at: normaliseNullableNumber(raw.verified_at),
    verified_by: normaliseNullableString(raw.verified_by),
    data_version: normaliseDataVersion(raw.data_version),
  };
}

function deriveStructuredFromLegacyCategory(
  category: string | undefined,
): {
  audience: AttractionAdmissionAudience;
  nationality: AttractionAdmissionNationality;
  is_student?: boolean;
} | null {
  if (!category) return null;
  switch (category) {
    case "adult":
      return { audience: "adult", nationality: "any" };
    case "child":
      return { audience: "child", nationality: "any" };
    case "senior":
      return { audience: "senior", nationality: "any" };
    case "domestic":
      return { audience: "adult", nationality: "domestic" };
    case "foreigner":
      return { audience: "adult", nationality: "foreigner" };
    case "student":
      return { audience: "adult", nationality: "any", is_student: true };
    default:
      return null;
  }
}

function sortRules(rules: AttractionAdmissionRule[]): AttractionAdmissionRule[] {
  const audienceIndex = new Map<AttractionAdmissionAudience, number>(
    ATTRACTION_ADMISSION_AUDIENCES.map((value, index) => [value, index]),
  );
  const nationalityIndex = new Map<AttractionAdmissionNationality, number>(
    ATTRACTION_ADMISSION_NATIONALITIES.map((value, index) => [value, index]),
  );

  return [...rules].sort((left, right) => {
    const attractionDiff = left.attraction_node_id.localeCompare(
      right.attraction_node_id,
    );
    if (attractionDiff !== 0) return attractionDiff;

    const audienceDiff =
      (audienceIndex.get(left.audience) ?? 0) -
      (audienceIndex.get(right.audience) ?? 0);
    if (audienceDiff !== 0) return audienceDiff;

    const nationalityDiff =
      (nationalityIndex.get(left.nationality) ?? 0) -
      (nationalityIndex.get(right.nationality) ?? 0);
    if (nationalityDiff !== 0) return nationalityDiff;

    const studentDiff = Number(left.is_student ?? false) - Number(right.is_student ?? false);
    if (studentDiff !== 0) return studentDiff;

    return left.id.localeCompare(right.id);
  });
}

function normaliseIdList(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => normaliseString(value)).filter(Boolean)),
  ) as string[];
}

function normaliseString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normaliseNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return normaliseString(value);
}

function normaliseCurrency(value: unknown): string {
  const currency = normaliseString(value);
  if (!currency) return "INR";
  const upper = currency.toUpperCase();
  // Defensive: keep the exact uppercase form even if it isn't ISO 4217 yet,
  // so admins can save stub values during onboarding without losing data,
  // but reject obviously broken inputs (numbers, accidental whitespace).
  return ISO_4217_PATTERN.test(upper) ? upper : upper.replace(/[^A-Z]/g, "");
}

function normaliseNullableAmount(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  return Number(Math.max(0, Number(value)).toFixed(2));
}

function normaliseNullableLocalDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  const date = normaliseString(value);
  if (!date) return undefined;
  return LOCAL_DATE_PATTERN.test(date) ? date : undefined;
}

function normaliseNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (!Number.isFinite(value)) return undefined;
  return Number(value);
}

function normaliseDataVersion(value: unknown): number {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : CURRENT_DATA_VERSION;
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
