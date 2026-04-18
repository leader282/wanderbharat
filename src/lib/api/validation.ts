import { z } from "zod";

import { TRANSPORT_MODES, TRAVEL_STYLES } from "@/types/domain";

export const generateItinerarySchema = z.object({
  region: z.string().min(1),
  /**
   * Optional extra regions to include in the candidate pool. The primary
   * `region` is still used for persistence / scoping; adding more regions
   * lets a plan cross borders without changing the seed data.
   */
  regions: z.array(z.string().min(1)).max(10).optional(),
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
  }),
});

export type GenerateItineraryBody = z.infer<typeof generateItinerarySchema>;
