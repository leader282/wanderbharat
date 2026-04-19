import { z } from "zod";

import { MAX_TRIP_DAYS } from "@/lib/itinerary/planningLimits";
import {
  ACCOMMODATION_PREFERENCES,
  TRANSPORT_MODES,
  TRAVEL_STYLES,
} from "@/types/domain";

const generateItineraryPreferencesSchema = z
  .object({
    travel_style: z.enum(TRAVEL_STYLES),
    budget: z.object({
      min: z.number().nonnegative(),
      max: z.number().nonnegative(),
      currency: z.string().optional(),
    }),
    travellers: z.object({
      adults: z.number().int().min(1).max(20),
      children: z.number().int().min(0).max(20),
    }),
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
});

export type GenerateItineraryBody = z.infer<typeof generateItinerarySchema>;

export const adjustItineraryBudgetSchema = z.object({
  total_budget: z.number().positive(),
  apply: z.boolean().optional(),
});

export type AdjustItineraryBudgetBody = z.infer<
  typeof adjustItineraryBudgetSchema
>;
