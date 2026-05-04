"use server";

import { revalidatePath } from "next/cache";

import { requireAdminUser } from "@/lib/auth/admin";
import { runDataQualityScan } from "@/lib/admin/dataQualityScanner";
import {
  ignoreIssue,
  resolveIssue,
} from "@/lib/repositories/dataQualityRepository";

export async function runDataQualityScanAction(): Promise<void> {
  const resolvedBy = await requireAdminIdentity();
  await runDataQualityScan({ resolvedBy });
  revalidatePath("/admin/data-quality");
}

export async function resolveIssueAction(formData: FormData): Promise<void> {
  const resolvedBy = await requireAdminIdentity();
  const issueId = readIssueId(formData);
  await resolveIssue(issueId, resolvedBy);
  revalidatePath("/admin/data-quality");
}

export async function ignoreIssueAction(formData: FormData): Promise<void> {
  const resolvedBy = await requireAdminIdentity();
  const issueId = readIssueId(formData);
  await ignoreIssue(issueId, resolvedBy);
  revalidatePath("/admin/data-quality");
}

async function requireAdminIdentity(): Promise<string> {
  const auth = await requireAdminUser();
  if (!auth.ok) {
    throw new Error("Admin access required.");
  }

  return auth.user.email ?? auth.user.uid;
}

function readIssueId(formData: FormData): string {
  const raw = formData.get("issue_id");
  if (typeof raw !== "string") {
    throw new Error("issue_id is required.");
  }
  const issueId = raw.trim();
  if (!issueId) {
    throw new Error("issue_id is required.");
  }
  return issueId;
}
