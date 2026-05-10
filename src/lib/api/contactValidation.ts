import { z } from "zod";

export const CONTACT_QUERY_TYPES = [
  "Trip help",
  "Destination request",
  "Bug report",
  "Partnership",
  "General",
] as const;

export const CONTACT_MESSAGE_MIN_LENGTH = 20;
export const CONTACT_MESSAGE_MAX_LENGTH = 4000;

const OPTIONAL_TEXT_MAX_LENGTH = 120;
const NAME_MAX_LENGTH = 120;
const EMAIL_MAX_LENGTH = 254;
const TURNSTILE_TOKEN_MAX_LENGTH = 2_048;

const optionalTrimmedString = (maxLength: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, z.string().max(maxLength).optional());

const optionalNumberOfPeople = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    if (!/^\d+$/.test(trimmed)) {
      return value;
    }
    return Number.parseInt(trimmed, 10);
  }
  return value;
}, z.number().int().min(1).max(30).optional());

export const contactSubmissionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(NAME_MAX_LENGTH, "Name is too long."),
  email: z
    .string()
    .trim()
    .email("Please enter a valid email address.")
    .max(EMAIL_MAX_LENGTH, "Email is too long."),
  queryType: z.enum(CONTACT_QUERY_TYPES),
  destinationOrRegion: optionalTrimmedString(OPTIONAL_TEXT_MAX_LENGTH),
  tripDates: optionalTrimmedString(OPTIONAL_TEXT_MAX_LENGTH),
  numberOfPeople: optionalNumberOfPeople,
  budget: optionalTrimmedString(OPTIONAL_TEXT_MAX_LENGTH),
  message: z
    .string()
    .trim()
    .min(
      CONTACT_MESSAGE_MIN_LENGTH,
      `Message must be at least ${CONTACT_MESSAGE_MIN_LENGTH} characters.`,
    )
    .max(
      CONTACT_MESSAGE_MAX_LENGTH,
      `Message cannot exceed ${CONTACT_MESSAGE_MAX_LENGTH} characters.`,
    ),
  consent: z.boolean().refine((value) => value, {
    message: "Consent is required.",
  }),
  company: optionalTrimmedString(200),
  turnstileToken: optionalTrimmedString(TURNSTILE_TOKEN_MAX_LENGTH),
});

export type ContactSubmissionBody = z.infer<typeof contactSubmissionSchema>;

export type ContactFieldErrors = Partial<
  Record<keyof ContactSubmissionBody, string[]>
>;

export function flattenContactFieldErrors(
  error: z.ZodError<ContactSubmissionBody>,
): ContactFieldErrors {
  const fieldErrors = error.flatten().fieldErrors;
  const normalized: ContactFieldErrors = {};

  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (!messages || messages.length === 0) {
      continue;
    }
    normalized[field as keyof ContactSubmissionBody] = messages;
  }

  return normalized;
}
