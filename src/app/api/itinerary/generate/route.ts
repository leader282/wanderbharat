import { NextResponse } from "next/server";

import { generateItinerarySchema } from "@/lib/api/validation";
import { generateItinerary } from "@/lib/itinerary/engine";
import {
  loadEngineContextForPlan,
  loadEngineContextForRegion,
} from "@/lib/itinerary/loadContext";
import { saveItinerary } from "@/lib/repositories/itineraryRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenerateRouteDependencies {
  /** @deprecated kept for tests that want to stub the entire region load. */
  loadEngineContextForRegion: typeof loadEngineContextForRegion;
  /** Planning-aware loader. Prefer this: it prunes by start/end/modes/days. */
  loadEngineContextForPlan?: typeof loadEngineContextForPlan;
  generateItinerary: typeof generateItinerary;
  saveItinerary: typeof saveItinerary;
}

const defaultDependencies: GenerateRouteDependencies = {
  loadEngineContextForRegion,
  loadEngineContextForPlan,
  generateItinerary,
  saveItinerary,
};

/**
 * POST /api/itinerary/generate
 *
 * Thin wrapper around the engine:
 *   1. validate input
 *   2. load graph scoped to the *plan* (regions + start + days + modes)
 *   3. run engine
 *   4. persist + return
 */
export async function handleGenerateItinerary(
  request: Request,
  deps: GenerateRouteDependencies = defaultDependencies,
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = generateItinerarySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_input",
        message: "Request body failed validation.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const input = parsed.data;

  let ctx;
  try {
    if (deps.loadEngineContextForPlan) {
      ctx = await deps.loadEngineContextForPlan({
        regions:
          input.regions && input.regions.length > 0
            ? input.regions
            : [input.region],
        start_node_id: input.start_node,
        end_node_id: input.end_node,
        days: input.days,
        modes: input.preferences.transport_modes ?? ["road"],
        travel_style: input.preferences.travel_style,
      });
    } else {
      ctx = await deps.loadEngineContextForRegion(input.region);
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "internal_error",
        message: (err as Error).message,
      },
      { status: 500 },
    );
  }

  const result = await deps.generateItinerary(input, ctx);
  if (!result.ok) {
    return NextResponse.json(result.error, { status: 422 });
  }

  try {
    await deps.saveItinerary(result.itinerary);
  } catch (err) {
    return NextResponse.json(
      {
        error: "persistence_failed",
        message: (err as Error).message,
        itinerary: result.itinerary,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ itinerary: result.itinerary }, { status: 201 });
}

export async function POST(request: Request) {
  return handleGenerateItinerary(request);
}
