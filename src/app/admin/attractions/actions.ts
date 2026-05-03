"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { GraphNode } from "@/types/domain";
import { requireAdminUser } from "@/lib/auth/admin";
import { getNode, replaceNode } from "@/lib/repositories/nodeRepository";

const MAX_NAME_LENGTH = 160;
const MAX_TAGS = 24;
const MAX_TAG_LENGTH = 40;
// `recommended_hours` carries the planner's per-stop dwell budget. The HTML
// input enforces `min=0.25`; mirror that here so admins get the same error
// message regardless of where the validation fires.
const MIN_RECOMMENDED_HOURS = 0.25;
const MAX_RECOMMENDED_HOURS = 24;
const MAX_DESCRIPTION_LENGTH = 2_000;

export async function updateAttractionMetadataAction(
  formData: FormData,
): Promise<void> {
  let status: "success" | "error" = "success";
  let message = "Attraction metadata saved.";
  const requestedAttractionId = readOptionalString(formData, "attraction_id");

  try {
    await requireAdminIdentity();

    const attractionId = readRequiredString(formData, "attraction_id");
    const attraction = await getNode(attractionId);
    if (!attraction || attraction.type !== "attraction") {
      throw new Error(`Attraction "${attractionId}" was not found.`);
    }

    const name = readRequiredString(formData, "name", MAX_NAME_LENGTH);
    const tags = parseTags(readOptionalString(formData, "tags"));
    const recommendedHours = parseOptionalRecommendedHours(
      readOptionalString(formData, "recommended_hours"),
    );
    const googlePlaceId = parseOptionalStringWithMax(
      readOptionalString(formData, "google_place_id"),
      200,
    );
    const description = parseOptionalStringWithMax(
      readOptionalString(formData, "description"),
      MAX_DESCRIPTION_LENGTH,
    );
    const nextStatus = readStatus(formData);

    const metadata = { ...attraction.metadata };
    metadata.disabled = nextStatus === "disabled";

    if (recommendedHours === null) {
      delete metadata.recommended_hours;
    } else {
      metadata.recommended_hours = recommendedHours;
    }

    if (googlePlaceId === null) {
      delete metadata.google_place_id;
    } else {
      metadata.google_place_id = googlePlaceId;
    }

    if (description === null) {
      delete metadata.description;
    } else {
      metadata.description = description;
    }

    const next: GraphNode = {
      ...attraction,
      name,
      tags,
      metadata,
    };

    await replaceNode(next);
    message = `Saved metadata for ${attraction.name}.`;
  } catch (error) {
    status = "error";
    message = error instanceof Error ? error.message : "Save failed.";
  }

  revalidatePath("/admin/attractions");
  revalidatePath("/admin/attraction-hours");
  revalidatePath("/admin/data-quality");
  redirect(
    buildAttractionsRedirectUrl({
      params: { save_status: status, save_message: message },
      attractionId: requestedAttractionId,
    }),
  );
}

async function requireAdminIdentity(): Promise<string> {
  const auth = await requireAdminUser();
  if (!auth.ok) {
    throw new Error("Admin access required.");
  }
  return auth.user.email ?? auth.user.uid;
}

function readStatus(formData: FormData): "active" | "disabled" {
  const status = readOptionalString(formData, "status");
  if (status === "disabled") return "disabled";
  return "active";
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];

  const unique = new Set<string>();
  const tags: string[] = [];
  const tokens = raw
    .split(/[,\n]/g)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  for (const token of tokens) {
    if (token.length > MAX_TAG_LENGTH) {
      throw new Error(`Each tag must be <= ${MAX_TAG_LENGTH} characters.`);
    }
    if (unique.has(token)) continue;
    unique.add(token);
    tags.push(token);
  }

  if (tags.length > MAX_TAGS) {
    throw new Error(`No more than ${MAX_TAGS} tags are allowed.`);
  }

  return tags;
}

function parseOptionalRecommendedHours(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error("recommended_hours must be a valid number.");
  }
  if (parsed < MIN_RECOMMENDED_HOURS || parsed > MAX_RECOMMENDED_HOURS) {
    throw new Error(
      `recommended_hours must be between ${MIN_RECOMMENDED_HOURS} and ${MAX_RECOMMENDED_HOURS}.`,
    );
  }
  return Number(parsed.toFixed(2));
}

function buildAttractionsRedirectUrl(args: {
  params: Record<string, string>;
  attractionId?: string;
}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(args.params)) {
    search.set(key, value);
  }
  const hash = args.attractionId ? `#attr-${args.attractionId}` : "";
  return `/admin/attractions?${search.toString()}${hash}`;
}

function parseOptionalStringWithMax(
  raw: string | undefined,
  maxLength: number,
): string | null {
  if (!raw) return null;
  if (raw.length > maxLength) {
    throw new Error(`Value must be <= ${maxLength} characters.`);
  }
  return raw;
}

function readRequiredString(
  formData: FormData,
  key: string,
  maxLength = 200,
): string {
  const value = readOptionalString(formData, key);
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  if (value.length > maxLength) {
    throw new Error(`${key} must be <= ${maxLength} characters.`);
  }
  return value;
}

function readOptionalString(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
