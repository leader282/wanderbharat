import { z } from "zod";

import { MAX_TRIP_DAYS } from "@/lib/itinerary/planningLimits";
import {
  ACCOMMODATION_PREFERENCES,
  DEFAULT_CURRENCY,
  DEFAULT_GUEST_NATIONALITY,
  TRANSPORT_MODES,
  TRAVEL_STYLES,
} from "@/types/domain";

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const NATIONALITY_PATTERN = /^[A-Za-z]{2}$/;

const localDateSchema = z
  .string()
  .regex(LOCAL_DATE_PATTERN, "Must be in YYYY-MM-DD format.")
  .refine(isValidLocalDate, "Must be a valid calendar date.");

const budgetRangeSchema = z
  .object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
    currency: z
      .string()
      .trim()
      .regex(CURRENCY_PATTERN, "Must be a 3-letter currency code.")
      .optional(),
  })
  .transform((budget) => ({
    ...budget,
    currency: budget.currency?.toUpperCase() ?? DEFAULT_CURRENCY,
  }));

const travellersSchema = z
  .object({
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20),
    children_ages: z.array(z.number().int().min(0).max(17)).max(20).optional(),
    rooms: z.number().int().min(1).max(20).optional(),
    guest_nationality: z
      .string()
      .trim()
      .regex(NATIONALITY_PATTERN, "Must be a 2-letter country code.")
      .optional(),
  })
  .superRefine((travellers, ctx) => {
    if (travellers.children > 0 && !travellers.children_ages) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["children_ages"],
        message: "children_ages is required when children is greater than 0.",
      });
    }
    if (
      travellers.children_ages !== undefined &&
      travellers.children_ages.length !== travellers.children
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["children_ages"],
        message: "children_ages length must match travellers.children.",
      });
    }
  })
  .transform((travellers) => ({
    ...travellers,
    rooms: travellers.rooms ?? 1,
    guest_nationality:
      travellers.guest_nationality?.toUpperCase() ?? DEFAULT_GUEST_NATIONALITY,
    children_ages: travellers.children_ages ?? [],
  }));

const generateItineraryPreferencesSchema = z
  .object({
    travel_style: z.enum(TRAVEL_STYLES),
    trip_start_date: localDateSchema,
    trip_end_date: localDateSchema.optional(),
    budget: budgetRangeSchema,
    travellers: travellersSchema,
    interests: z.array(z.string()).optional(),
    transport_modes: z.array(z.enum(TRANSPORT_MODES)).min(1).optional(),
    prioritize_city_coverage: z.boolean().optional(),
    accommodation_preference: z
      .enum(ACCOMMODATION_PREFERENCES)
      .optional(),
    // Backwards-compatible alias for older clients while the canonical
    // request/storage shape is normalised to snake_case.
    accommodationPreference: z
      .enum(ACCOMMODATION_PREFERENCES)
      .optional(),
    preferred_start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be 'HH:MM' (24-hour).")
      .optional(),
  })
  .superRefine((preferences, ctx) => {
    if (
      preferences.accommodation_preference &&
      preferences.accommodationPreference &&
      preferences.accommodation_preference !== preferences.accommodationPreference
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accommodation_preference"],
        message:
          "accommodation_preference and accommodationPreference must match.",
      });
    }

    const tripStartDateMs = localDateToUtcMs(preferences.trip_start_date);
    if (tripStartDateMs !== null && tripStartDateMs < currentUtcMidnightMs()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trip_start_date"],
        message: "trip_start_date must not be in the past.",
      });
    }
  })
  .transform(
    ({
      accommodationPreference,
      accommodation_preference,
      ...preferences
    }) => ({
      ...preferences,
      accommodation_preference:
        accommodation_preference ?? accommodationPreference,
    }),
  );

export const generateItinerarySchema = z.object({
  /**
   * One or more region slugs that the planner is allowed to draw
   * candidates from. The first entry is treated as the primary region for
   * persistence and trip-list filtering; additional entries widen the
   * candidate pool for cross-region trips. Must contain at least one
   * slug; capped at 10 to prevent runaway graph loads.
   */
  regions: z.array(z.string().min(1)).min(1).max(10),
  start_node: z.string().min(1),
  end_node: z.string().optional(),
  requested_city_ids: z.array(z.string().min(1)).max(10).optional(),
  days: z.number().int().min(1).max(MAX_TRIP_DAYS),
  user_id: z.string().optional(),
  preferences: generateItineraryPreferencesSchema,
})
  .superRefine((input, ctx) => {
    const tripEndDate = input.preferences.trip_end_date;
    if (!tripEndDate) return;

    const expectedEndDate = addDaysToLocalDate(
      input.preferences.trip_start_date,
      input.days - 1,
    );
    if (!expectedEndDate || tripEndDate !== expectedEndDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preferences", "trip_end_date"],
        message: `trip_end_date must equal trip_start_date + ${input.days - 1} days (${expectedEndDate ?? "unknown"}).`,
      });
    }
  })
  .transform(({ preferences, ...input }) => {
    const { trip_end_date: _tripEndDate, ...preferencesWithoutDerivedEndDate } =
      preferences;
    void _tripEndDate;
    return { ...input, preferences: preferencesWithoutDerivedEndDate };
  });

export type GenerateItineraryBody = z.infer<typeof generateItinerarySchema>;

export const adjustItineraryBudgetSchema = z.object({
  total_budget: z.number().positive(),
  apply: z.boolean().optional(),
});

export type AdjustItineraryBudgetBody = z.infer<
  typeof adjustItineraryBudgetSchema
>;

function isValidLocalDate(dateString: string): boolean {
  const [yearRaw, monthRaw, dayRaw] = dateString.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function addDaysToLocalDate(
  dateString: string,
  daysToAdd: number,
): string | null {
  if (!isValidLocalDate(dateString)) return null;
  const [yearRaw, monthRaw, dayRaw] = dateString.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  candidate.setUTCDate(candidate.getUTCDate() + daysToAdd);
  return candidate.toISOString().slice(0, 10);
}

function localDateToUtcMs(dateString: string): number | null {
  if (!isValidLocalDate(dateString)) return null;
  const [yearRaw, monthRaw, dayRaw] = dateString.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  return Date.UTC(year, month - 1, day);
}

function currentUtcMidnightMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
