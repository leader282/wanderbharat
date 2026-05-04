import { NextResponse } from "next/server";

import { generateItinerarySchema } from "@/lib/api/validation";
import { getCurrentUser } from "@/lib/auth/session";
import { getAdminAuth } from "@/lib/firebase/admin";
import { planAccommodations as runAccommodationPlanner } from "@/lib/itinerary/accommodation";
import { integrateAccommodationPlanIntoItinerary } from "@/lib/itinerary/accommodationBudget";
import { validateBudget } from "@/lib/itinerary/constraints";
import { generateItinerary } from "@/lib/itinerary/engine";
import { loadEngineContextForPlan } from "@/lib/itinerary/loadContext";
import { resolveLiteApiProviderConfig } from "@/lib/providers/hotels/liteApiConfig";
import { LiteApiHotelDataProvider } from "@/lib/providers/hotels/liteApiHotelDataProvider";
import { getByNode } from "@/lib/repositories/accommodationRepository";
import {
  findLatestHotelOfferSnapshotByCacheKey,
  saveHotelOfferSnapshot,
} from "@/lib/repositories/hotelOfferSnapshotRepository";
import {
  findLatestHotelSearchSnapshotByQueryKey,
  saveHotelSearchSnapshot,
} from "@/lib/repositories/hotelSearchSnapshotRepository";
import { saveItinerary } from "@/lib/repositories/itineraryRepository";
import { precacheItineraryRouteGeometry } from "@/lib/services/itineraryMapService";
import type { Coordinates, TransportMode } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenerateRouteDependencies {
  /** Planning-aware loader. Prunes by start/end/modes/days. */
  loadEngineContextForPlan: typeof loadEngineContextForPlan;
  generateItinerary: typeof generateItinerary;
  saveItinerary: typeof saveItinerary;
  precacheItineraryRouteGeometry?: typeof precacheItineraryRouteGeometry;
  planAccommodations: (
    input: Parameters<typeof runAccommodationPlanner>[0],
  ) => ReturnType<typeof runAccommodationPlanner>;
  /**
   * Resolve the authenticated user (if any) for this request. Defaults
   * to checking the session cookie, then the `Authorization: Bearer
   * <idToken>` header. Tests can stub this without going through Firebase.
   */
  resolveUserId?: (request: Request) => Promise<string | null>;
}

const defaultDependencies: GenerateRouteDependencies = {
  loadEngineContextForPlan,
  generateItinerary,
  saveItinerary,
  precacheItineraryRouteGeometry,
  planAccommodations: async (input) => {
    const liteApiConfig = resolveLiteApiProviderConfig();
    return runAccommodationPlanner(input, {
      getByNode,
      hotelDataProvider: new LiteApiHotelDataProvider({ config: liteApiConfig }),
      findLatestHotelSearchSnapshotByQueryKey,
      saveHotelSearchSnapshot,
      findLatestHotelOfferSnapshotByCacheKey,
      saveHotelOfferSnapshot,
      maxHotelProviderCalls: liteApiConfig.maxProviderCallsPerItinerary,
    });
  },
  resolveUserId: defaultResolveUserId,
};

/**
 * POST /api/itinerary/generate
 *
 * Thin wrapper around the engine:
 *   1. validate input
 *   2. attach the verified user_id (cookie or bearer token), ignoring
 *      any client-supplied user_id so callers can't impersonate
 *   3. load graph scoped to the *plan* (regions + start + days + modes)
 *   4. run engine
 *   5. persist + return
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
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const requestedModes: TransportMode[] =
    parsed.data.preferences.transport_modes &&
    parsed.data.preferences.transport_modes.length > 0
      ? parsed.data.preferences.transport_modes
      : ["road"];

  const resolveUserId = deps.resolveUserId ?? defaultResolveUserId;
  let authedUserId: string | null = null;
  try {
    authedUserId = await resolveUserId(request);
  } catch {
    authedUserId = null;
  }

  // Always trust the verified id over anything the client sent.
  const input = { ...parsed.data, user_id: authedUserId ?? undefined };

  let ctx;
  try {
    ctx = await deps.loadEngineContextForPlan({
      regions: input.regions,
      start_node_id: input.start_node,
      end_node_id: input.end_node,
      requested_city_ids: input.requested_city_ids,
      days: input.days,
      modes: requestedModes,
      travel_style: input.preferences.travel_style,
    });
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

  let itinerary = result.itinerary;
  try {
    const accommodationPlan = await deps.planAccommodations({
      days: itinerary.day_plan,
      budget: parsed.data.preferences.budget,
      travellers: input.preferences.travellers,
      travelStyle: input.preferences.travel_style,
      accommodationPreference: input.preferences.accommodation_preference,
      interests: input.preferences.interests,
      tripStartDate: input.preferences.trip_start_date,
      region: itinerary.region,
      cityLocationsByNodeId: buildCityLocationsByNodeId(ctx.nodes),
    });
    itinerary = integrateAccommodationPlanIntoItinerary({
      itinerary,
      stays: accommodationPlan.stays,
      warnings: accommodationPlan.warnings,
      requestedBudget: parsed.data.preferences.budget,
    });
    const finalBudgetError = validateBudget(
      itinerary.estimated_cost,
      parsed.data.preferences.budget,
    );
    if (finalBudgetError) {
      return NextResponse.json(finalBudgetError, { status: 422 });
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

  const precacheRouteGeometry =
    deps.precacheItineraryRouteGeometry ?? precacheItineraryRouteGeometry;
  try {
    await precacheRouteGeometry(itinerary, ctx.nodes);
  } catch {
    // Geometry caching is additive only; itinerary generation should still
    // succeed even if Google routing is unavailable for map polylines.
  }

  try {
    await deps.saveItinerary(itinerary);
  } catch (err) {
    return NextResponse.json(
      {
        error: "persistence_failed",
        message: (err as Error).message,
        itinerary,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ itinerary }, { status: 201 });
}

export async function POST(request: Request) {
  return handleGenerateItinerary(request);
}

/**
 * Default user-id resolver. Tries the verified session cookie first
 * (fast, already trusted), then falls back to a bearer ID token in
 * `Authorization`. Returns `null` for anonymous requests.
 */
async function defaultResolveUserId(request: Request): Promise<string | null> {
  const fromCookie = await getCurrentUser();
  if (fromCookie) return fromCookie.uid;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1].trim(), true);
    return decoded.uid;
  } catch {
    return null;
  }
}

function buildCityLocationsByNodeId(
  nodes: Array<{ id: string; location: Coordinates }>,
): Record<string, Coordinates> {
  const locationsByNodeId: Record<string, Coordinates> = {};
  for (const node of nodes) {
    locationsByNodeId[node.id] = node.location;
  }
  return locationsByNodeId;
}
