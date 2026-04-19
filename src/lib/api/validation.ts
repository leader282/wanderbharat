import { z } from "zod";

import { TRANSPORT_MODES, TRAVEL_STYLES } from "@/types/domain";

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
  days: z.number().int().min(1).max(30),
  user_id: z.string().optional(),
  preferences: z.object({
    travel_style: z.enum(TRAVEL_STYLES),
    budget: z.object({
      min: z.number().nonnegative(),
      max: z.number().nonnegative(),
      currency: z.string().optional(),
    }),
    interests: z.array(z.string()).optional(),
    transport_modes: z.array(z.enum(TRANSPORT_MODES)).optional(),
    prioritize_city_coverage: z.boolean().optional(),
  }),
});

export type GenerateItineraryBody = z.infer<typeof generateItinerarySchema>;
