"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminUser } from "@/lib/auth/admin";
import { hydrateAttractionOpeningHours } from "@/lib/services/attractionHoursHydrationService";

export async function hydrateAttractionHoursAction(formData: FormData): Promise<void> {
  const actor = await requireAdminIdentity();
  const attractionId = readOptionalString(formData, "attraction_id");
  const googlePlaceId = readOptionalString(formData, "google_place_id");
  let redirectStatus: "success" | "empty" | "error" = "success";
  let redirectMessage = "Opening hours hydrated from Google Places.";

  try {
    const result = await hydrateAttractionOpeningHours({
      attraction_id: attractionId,
      google_place_id: googlePlaceId,
      actor,
    });
    if (
      result.weekly_periods_count === 0 &&
      result.closed_days_count === 0
    ) {
      redirectStatus = "empty";
      redirectMessage =
        "Google Places returned no opening-hours schedule; a data quality issue was recorded.";
    } else {
      redirectMessage = `Hydrated ${result.weekly_periods_count} weekly period${result.weekly_periods_count === 1 ? "" : "s"} for ${result.attraction_id}.`;
    }
  } catch (error) {
    redirectStatus = "error";
    redirectMessage = toAdminMessage(error);
  }

  revalidatePath("/admin/attraction-hours");
  revalidatePath("/admin/data-quality");
  redirect(
    `/admin/attraction-hours?hydration_status=${redirectStatus}&hydration_message=${encodeURIComponent(redirectMessage)}`,
  );
}

async function requireAdminIdentity(): Promise<string> {
  const auth = await requireAdminUser();
  if (!auth.ok) {
    throw new Error("Admin access required.");
  }
  return auth.user.email ?? auth.user.uid;
}

function readOptionalString(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toAdminMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Google Places opening-hours hydration failed.";
  }
  if (error.message.includes("google_place_id is required")) {
    return "This attraction is missing google_place_id; a data quality issue was recorded.";
  }
  if (error.message.includes("linked to multiple attractions")) {
    return error.message;
  }
  if (error.message.includes("No attraction node is linked")) {
    return error.message;
  }
  return "Google Places opening-hours hydration failed; a data quality issue was recorded.";
}
