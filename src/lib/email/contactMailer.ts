import { Resend } from "resend";

import type { ContactSubmissionBody } from "@/lib/api/contactValidation";

const DEFAULT_CONTACT_TO_EMAIL = "chakrabortyaritra.2002@gmail.com";

type ContactConfigVar = "RESEND_API_KEY" | "CONTACT_FROM_EMAIL";

type ContactMailerConfig = {
  ok: true;
  apiKey: string;
  fromEmail: string;
  toEmail: string;
};

type MissingConfigResult = {
  ok: false;
  reason: "missing_config";
  missing: ContactConfigVar[];
};

export type SendContactEmailResult =
  | {
      ok: true;
      id: string | null;
    }
  | MissingConfigResult
  | {
      ok: false;
      reason: "provider_error";
    };

export function resolveContactMailerConfig(
  env: Record<string, string | undefined> = process.env,
): ContactMailerConfig | MissingConfigResult {
  const apiKey = env.RESEND_API_KEY?.trim();
  const fromEmail = env.CONTACT_FROM_EMAIL?.trim();
  const toEmail = env.CONTACT_TO_EMAIL?.trim() || DEFAULT_CONTACT_TO_EMAIL;
  if (!apiKey || !fromEmail) {
    const missing: ContactConfigVar[] = [];
    if (!apiKey) {
      missing.push("RESEND_API_KEY");
    }
    if (!fromEmail) {
      missing.push("CONTACT_FROM_EMAIL");
    }
    return {
      ok: false,
      reason: "missing_config",
      missing,
    };
  }

  return {
    ok: true,
    apiKey,
    fromEmail,
    toEmail,
  };
}

export async function sendContactEmail(
  submission: ContactSubmissionBody,
  env: Record<string, string | undefined> = process.env,
): Promise<SendContactEmailResult> {
  const config = resolveContactMailerConfig(env);
  if (!config.ok) {
    return config;
  }

  const resend = new Resend(config.apiKey);
  const subject = `WanderBharat query: ${submission.queryType}`;

  const { data, error } = await resend.emails.send({
    from: config.fromEmail,
    to: config.toEmail,
    replyTo: submission.email,
    subject,
    text: buildContactTextBody(submission),
    html: buildContactHtmlBody(submission),
  });

  if (error) {
    return {
      ok: false,
      reason: "provider_error",
    };
  }

  return {
    ok: true,
    id: data?.id ?? null,
  };
}

function buildContactTextBody(submission: ContactSubmissionBody): string {
  const lines = [
    "New WanderBharat contact query",
    "",
    `Name: ${submission.name}`,
    `Email: ${submission.email}`,
    `Query type: ${submission.queryType}`,
    `Destination/Region: ${formatOptional(submission.destinationOrRegion)}`,
    `Trip dates: ${formatOptional(submission.tripDates)}`,
    `Number of people: ${formatOptionalNumber(submission.numberOfPeople)}`,
    `Budget: ${formatOptional(submission.budget)}`,
    "",
    "Message:",
    submission.message,
  ];

  return lines.join("\n");
}

function buildContactHtmlBody(submission: ContactSubmissionBody): string {
  const rows: Array<[string, string]> = [
    ["Name", submission.name],
    ["Email", submission.email],
    ["Query type", submission.queryType],
    ["Destination/Region", formatOptional(submission.destinationOrRegion)],
    ["Trip dates", formatOptional(submission.tripDates)],
    ["Number of people", formatOptionalNumber(submission.numberOfPeople)],
    ["Budget", formatOptional(submission.budget)],
  ];

  const renderedRows = rows
    .map(([label, value]) => {
      return `<tr><th align="left" style="padding:6px 10px 6px 0;">${escapeHtml(label)}</th><td style="padding:6px 0;">${escapeHtml(value)}</td></tr>`;
    })
    .join("");

  return [
    "<div style=\"font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111827;\">",
    "<h2 style=\"margin:0 0 12px;\">New WanderBharat contact query</h2>",
    "<table style=\"border-collapse:collapse;\">",
    renderedRows,
    "</table>",
    "<h3 style=\"margin:16px 0 6px;\">Message</h3>",
    `<pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:0;">${escapeHtml(submission.message)}</pre>`,
    "</div>",
  ].join("");
}

function formatOptional(value: string | undefined): string {
  return value && value.trim().length > 0 ? value : "Not provided";
}

function formatOptionalNumber(value: number | undefined): string {
  if (typeof value !== "number") {
    return "Not provided";
  }
  return String(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
