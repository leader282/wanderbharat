"use server";

import { revalidatePath } from "next/cache";

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
import { requireAdminUser } from "@/lib/auth/admin";
import {
  buildAdmissionRuleId,
  deleteRule,
  findRuleById,
  upsertRule,
} from "@/lib/repositories/attractionAdmissionRepository";

const DEFAULT_CURRENCY = "INR";
// Plausibility ceiling on a single-rule amount. Anything past this is almost
// certainly a typo; surfacing a clear error beats silently accepting a
// 100,000,000 rupee admission ticket.
const MAX_ADMISSION_AMOUNT = 200_000;
const ISO_4217_PATTERN = /^[A-Z]{3}$/;

export async function upsertAttractionAdmissionRuleAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireAdminIdentity();
  const now = Date.now();
  const attractionNodeId = readRequiredString(formData, "attraction_node_id");
  const audience = readEnumValue(
    formData,
    "audience",
    ATTRACTION_ADMISSION_AUDIENCES,
    "adult",
  );
  const nationality = readEnumValue(
    formData,
    "nationality",
    ATTRACTION_ADMISSION_NATIONALITIES,
    "any",
  );
  const isStudent = readBoolean(formData, "is_student");
  const sourceType = readEnumValue(
    formData,
    "source_type",
    ATTRACTION_ADMISSION_SOURCE_TYPES,
    "manual",
  );
  const confidence = readEnumValue(
    formData,
    "confidence",
    ATTRACTION_ADMISSION_CONFIDENCE_LEVELS,
    "verified",
  );
  const amount = resolveAmount(formData, confidence);
  // resolveAmount already enforces the unknown↔null relationship; mirror it
  // here so the persisted record can never disagree (e.g. someone hitting
  // the action with a non-DOM client).
  const resolvedConfidence: AttractionAdmissionConfidence =
    amount === null ? "unknown" : confidence;
  const ruleId =
    readOptionalString(formData, "rule_id") ??
    buildAdmissionRuleId({
      attractionNodeId,
      audience,
      nationality,
      isStudent,
    });
  const currency = readCurrency(formData, "currency");
  const validFrom = readOptionalLocalDate(formData, "valid_from");
  const validUntil = readOptionalLocalDate(formData, "valid_until");
  const sourceUrl = readOptionalString(formData, "source_url") ?? null;
  const notes = readOptionalString(formData, "notes") ?? null;

  // Read the existing rule so we don't bump verified_at on incidental edits
  // (notes-only saves, source URL fixes, etc). The source-of-truth signal
  // is "an admin reaffirmed this exact amount", so we only refresh the
  // verification timestamp when the amount or confidence actually changed.
  const existing = await findRuleById(ruleId);
  const verifiedSnapshot = computeVerifiedSnapshot({
    existing,
    nextAmount: amount,
    nextConfidence: resolvedConfidence,
    actor,
    now,
  });

  const next: AttractionAdmissionRule = {
    id: ruleId,
    attraction_node_id: attractionNodeId,
    region: readOptionalString(formData, "region"),
    currency,
    amount,
    audience,
    nationality,
    is_student: isStudent ? true : undefined,
    source_type: sourceType,
    confidence: resolvedConfidence,
    source_url: sourceUrl,
    notes,
    valid_from: validFrom,
    valid_until: validUntil,
    fetched_at: now,
    verified_at: verifiedSnapshot.verified_at,
    verified_by: verifiedSnapshot.verified_by,
    data_version: CURRENT_DATA_VERSION,
  };

  await upsertRule(next);

  revalidatePath("/admin/attraction-costs");
}

export async function deleteAttractionAdmissionRuleAction(
  formData: FormData,
): Promise<void> {
  await requireAdminIdentity();
  const ruleId = readRequiredString(formData, "rule_id");
  await deleteRule(ruleId);
  revalidatePath("/admin/attraction-costs");
}

export async function markAttractionAdmissionUnknownAction(
  formData: FormData,
): Promise<void> {
  await requireAdminIdentity();
  const now = Date.now();
  const attractionNodeId = readRequiredString(formData, "attraction_node_id");
  const audience = readEnumValue(
    formData,
    "audience",
    ATTRACTION_ADMISSION_AUDIENCES,
    "adult",
  );
  const nationality = readEnumValue(
    formData,
    "nationality",
    ATTRACTION_ADMISSION_NATIONALITIES,
    "any",
  );
  const isStudent = readBoolean(formData, "is_student");
  const ruleId =
    readOptionalString(formData, "rule_id") ??
    buildAdmissionRuleId({
      attractionNodeId,
      audience,
      nationality,
      isStudent,
    });

  await upsertRule({
    id: ruleId,
    attraction_node_id: attractionNodeId,
    region: readOptionalString(formData, "region"),
    currency: readCurrency(formData, "currency"),
    amount: null,
    audience,
    nationality,
    is_student: isStudent ? true : undefined,
    source_type: "manual",
    confidence: "unknown",
    source_url: readOptionalString(formData, "source_url") ?? null,
    notes:
      readOptionalString(formData, "notes") ??
      "Marked unknown in admin panel pending verified source.",
    valid_from: readOptionalLocalDate(formData, "valid_from"),
    valid_until: readOptionalLocalDate(formData, "valid_until"),
    fetched_at: now,
    verified_at: null,
    verified_by: null,
    data_version: CURRENT_DATA_VERSION,
  });

  revalidatePath("/admin/attraction-costs");
}

export async function markAttractionAdmissionFreeAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireAdminIdentity();
  const now = Date.now();
  const attractionNodeId = readRequiredString(formData, "attraction_node_id");
  const audience = readEnumValue(
    formData,
    "audience",
    ATTRACTION_ADMISSION_AUDIENCES,
    "adult",
  );
  const nationality = readEnumValue(
    formData,
    "nationality",
    ATTRACTION_ADMISSION_NATIONALITIES,
    "any",
  );
  const isStudent = readBoolean(formData, "is_student");
  const ruleId =
    readOptionalString(formData, "rule_id") ??
    buildAdmissionRuleId({
      attractionNodeId,
      audience,
      nationality,
      isStudent,
    });

  // Only stamp verified_at fresh if the rule isn't already a verified-free
  // record. Toggling "Mark free" repeatedly shouldn't keep refreshing the
  // verification timestamp.
  const existing = await findRuleById(ruleId);
  const isAlreadyVerifiedFree =
    existing?.amount === 0 && existing.confidence === "verified";
  const verifiedAt = isAlreadyVerifiedFree
    ? (existing.verified_at ?? now)
    : now;
  const verifiedBy = isAlreadyVerifiedFree
    ? (existing?.verified_by ?? actor)
    : actor;

  await upsertRule({
    id: ruleId,
    attraction_node_id: attractionNodeId,
    region: readOptionalString(formData, "region"),
    currency: readCurrency(formData, "currency"),
    amount: 0,
    audience,
    nationality,
    is_student: isStudent ? true : undefined,
    source_type: "manual",
    confidence: "verified",
    source_url: readOptionalString(formData, "source_url") ?? null,
    notes:
      readOptionalString(formData, "notes") ??
      "Marked as free with manual verification in admin panel.",
    valid_from: readOptionalLocalDate(formData, "valid_from"),
    valid_until: readOptionalLocalDate(formData, "valid_until"),
    fetched_at: now,
    verified_at: verifiedAt,
    verified_by: verifiedBy,
    data_version: CURRENT_DATA_VERSION,
  });

  revalidatePath("/admin/attraction-costs");
}

async function requireAdminIdentity(): Promise<string> {
  const auth = await requireAdminUser();
  if (!auth.ok) {
    throw new Error("Admin access required.");
  }
  return auth.user.email ?? auth.user.uid;
}

function readEnumValue<T extends string>(
  formData: FormData,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = readOptionalString(formData, key);
  if (!value) return fallback;
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readBoolean(formData: FormData, key: string): boolean {
  const value = readOptionalString(formData, key);
  if (!value) return false;
  const normalised = value.toLowerCase();
  return normalised === "true" || normalised === "on" || normalised === "1";
}

function readRequiredString(formData: FormData, key: string): string {
  const value = readOptionalString(formData, key);
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function readOptionalString(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readCurrency(formData: FormData, key: string): string {
  const value = readOptionalString(formData, key);
  const upper = (value ?? DEFAULT_CURRENCY).toUpperCase();
  if (!ISO_4217_PATTERN.test(upper)) {
    throw new Error(
      `${key} must be a 3-letter ISO 4217 currency code (e.g. INR).`,
    );
  }
  return upper;
}

function readOptionalLocalDate(
  formData: FormData,
  key: string,
): string | null | undefined {
  const value = readOptionalString(formData, key);
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function resolveAmount(
  formData: FormData,
  confidence: AttractionAdmissionConfidence,
): number | null {
  if (confidence === "unknown") {
    return null;
  }

  const raw = readOptionalString(formData, "amount");
  if (!raw) {
    // Refuse to silently downgrade a verified/estimated rule into unknown.
    // The form has a clear "Mark unknown" path; missing the amount on a
    // priced rule is almost always an admin mistake.
    throw new Error(
      "Amount is required when confidence is verified or estimated. Use 'Mark unknown' to record a missing price.",
    );
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("amount must be a non-negative number.");
  }
  if (parsed > MAX_ADMISSION_AMOUNT) {
    throw new Error(
      `amount cannot exceed ${MAX_ADMISSION_AMOUNT}; double-check the value.`,
    );
  }

  return Number(parsed.toFixed(2));
}

function computeVerifiedSnapshot(args: {
  existing: AttractionAdmissionRule | null;
  nextAmount: number | null;
  nextConfidence: AttractionAdmissionConfidence;
  actor: string;
  now: number;
}): { verified_at: number | null; verified_by: string | null } {
  if (args.nextConfidence !== "verified") {
    return { verified_at: null, verified_by: null };
  }
  // No prior record (or existing record disagrees on amount/confidence) →
  // this is a fresh verification, stamp now.
  const reaffirmation =
    args.existing &&
    args.existing.confidence === "verified" &&
    args.existing.amount === args.nextAmount;
  if (!reaffirmation) {
    return { verified_at: args.now, verified_by: args.actor };
  }
  return {
    verified_at: args.existing?.verified_at ?? args.now,
    verified_by: args.existing?.verified_by ?? args.actor,
  };
}

// Keep these exported types local for readability in form builders.
export type AdmissionAudience = AttractionAdmissionAudience;
export type AdmissionNationality = AttractionAdmissionNationality;
export type AdmissionSourceType = AttractionAdmissionSourceType;
