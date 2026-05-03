import { NextResponse } from "next/server";
import { z } from "zod";

import {
  runLiteApiProbe,
  type LiteApiProbeInput,
  type LiteApiProbeResult,
} from "@/lib/admin/liteApiProbe";
import { requireAdminUser } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LiteApiTestRouteDependencies {
  requireAdminUser: typeof requireAdminUser;
  runLiteApiProbe: (input: LiteApiProbeInput) => Promise<LiteApiProbeResult>;
}

const defaultDependencies: LiteApiTestRouteDependencies = {
  requireAdminUser,
  runLiteApiProbe,
};

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STAY_NIGHTS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const localDateSchema = z
  .string()
  .regex(LOCAL_DATE_PATTERN, "Must be in YYYY-MM-DD format.")
  .refine(isValidLocalDate, "Must be a valid calendar date.");

const liteApiProbeRequestSchema = z
  .object({
    city_name: z
      .string()
      .trim()
      .max(120, "city_name must be at most 120 characters.")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    country_code: z.string().trim().regex(/^[A-Za-z]{2}$/).default("IN"),
    latitude: z.preprocess(
      emptyToUndefined,
      z.coerce.number().min(-90).max(90).optional(),
    ),
    longitude: z.preprocess(
      emptyToUndefined,
      z.coerce.number().min(-180).max(180).optional(),
    ),
    radius_meters: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(500).max(50_000).default(5_000),
    ),
    checkin_date: localDateSchema,
    checkout_date: localDateSchema,
    adults: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(16).default(2),
    ),
    children_ages: z.preprocess(
      (value) => {
        if (value === undefined || value === null || value === "") return [];
        if (Array.isArray(value)) return value;
        if (typeof value === "string") {
          return value
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
        }
        return value;
      },
      z.array(z.coerce.number().int().min(0).max(17)).max(12),
    ),
    rooms: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(8).default(1),
    ),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/).default("INR"),
    guest_nationality: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .default("IN"),
    max_results: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(100).optional(),
    ),
  })
  .superRefine((input, ctx) => {
    const hasLat = input.latitude !== undefined;
    const hasLng = input.longitude !== undefined;
    const hasCity = Boolean(input.city_name);

    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latitude"],
        message: "Latitude and longitude must be provided together.",
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["longitude"],
        message: "Latitude and longitude must be provided together.",
      });
    }

    if (!hasCity && !(hasLat && hasLng)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["city_name"],
        message:
          "Provide city_name or both latitude/longitude for LiteAPI hotel search.",
      });
    }

    const checkin = parseLocalDate(input.checkin_date);
    const checkout = parseLocalDate(input.checkout_date);
    if (checkin !== null && checkout !== null && checkout <= checkin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkout_date"],
        message: "checkout_date must be after checkin_date.",
      });
    }

    // Reject already-past check-ins so we don't burn LiteAPI quota on
    // requests that can never produce shoppable rates. We compare to UTC
    // midnight today since the schema treats dates as local YYYY-MM-DD.
    if (checkin !== null && checkin < currentUtcMidnightMs()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkin_date"],
        message: "checkin_date must not be in the past.",
      });
    }

    // Cap stay length: an admin asking for a 4-year stay is almost
    // certainly a typo, and forwarding it to LiteAPI is wasteful.
    if (checkin !== null && checkout !== null) {
      const nights = Math.round((checkout - checkin) / MS_PER_DAY);
      if (nights > MAX_STAY_NIGHTS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checkout_date"],
          message: `Stay length cannot exceed ${MAX_STAY_NIGHTS} nights.`,
        });
      }
    }
  })
  .transform(
    (input): LiteApiProbeInput => ({
      city_name: input.city_name,
      country_code: input.country_code.toUpperCase(),
      latitude: input.latitude,
      longitude: input.longitude,
      radius_meters: input.radius_meters,
      checkin_date: input.checkin_date,
      checkout_date: input.checkout_date,
      adults: input.adults,
      children_ages: [...input.children_ages].sort((left, right) => left - right),
      rooms: input.rooms,
      currency: input.currency.toUpperCase(),
      guest_nationality: input.guest_nationality.toUpperCase(),
      max_results: input.max_results,
    }),
  );

export async function handleLiteApiTestRequest(
  request: Request,
  deps: LiteApiTestRouteDependencies = defaultDependencies,
) {
  const auth = await deps.requireAdminUser();
  if (!auth.ok) {
    if (auth.reason === "unauthenticated") {
      return NextResponse.json(
        {
          error: "unauthorized",
          message: "Sign in with an admin account to use this endpoint.",
        },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "forbidden",
        message: "Admin role is required to use the LiteAPI test endpoint.",
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = liteApiProbeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_input",
        message: "LiteAPI test request failed validation.",
        details: parsed.error.flatten(),
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const result = await deps.runLiteApiProbe(parsed.data);
  return NextResponse.json(result, { status: statusFromProbeResult(result) });
}

export async function POST(request: Request) {
  return handleLiteApiTestRequest(request);
}

function statusFromProbeResult(result: LiteApiProbeResult): number {
  if (!result.error) return 200;
  if (result.error.kind === "provider_disabled") return 503;
  if (result.error.kind === "timeout") return 504;
  if (result.error.kind === "provider_failure") return 502;
  if (result.error.kind === "internal_error") return 500;
  return 200;
}

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : value;
}

function isValidLocalDate(dateString: string): boolean {
  return parseLocalDate(dateString) !== null;
}

function parseLocalDate(dateString: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = Date.UTC(year, month - 1, day);
  const check = new Date(candidate);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate;
}

function currentUtcMidnightMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
