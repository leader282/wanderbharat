import { NextResponse } from "next/server";

import { adjustItineraryBudgetSchema } from "@/lib/api/validation";
import { buildBudgetAdjustmentPreview } from "@/lib/itinerary/budgetAdjustmentPreview";
import { getCurrentUser } from "@/lib/auth/session";
import { getAdminAuth } from "@/lib/firebase/admin";
import { planAccommodations as runAccommodationPlanner } from "@/lib/itinerary/accommodation";
import { integrateAccommodationPlanIntoItinerary } from "@/lib/itinerary/accommodationBudget";
import { canAccessItinerary } from "@/lib/itinerary/itineraryAccess";
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
import {
  deleteItinerary,
  getItinerary,
  saveItinerary,
} from "@/lib/repositories/itineraryRepository";
import {
  getItineraryMapData,
  precacheItineraryRouteGeometry,
} from "@/lib/services/itineraryMapService";
import type {
  Coordinates,
  Itinerary,
  ItineraryDetail,
  TransportMode,
} from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ItineraryRouteDependencies {
  getItinerary: typeof getItinerary;
  deleteItinerary: typeof deleteItinerary;
  saveItinerary?: typeof saveItinerary;
  getItineraryMapData: typeof getItineraryMapData;
  loadEngineContextForPlan?: typeof loadEngineContextForPlan;
  generateItinerary?: typeof generateItinerary;
  precacheItineraryRouteGeometry?: typeof precacheItineraryRouteGeometry;
  planAccommodations?: (
    input: Parameters<typeof runAccommodationPlanner>[0],
  ) => ReturnType<typeof runAccommodationPlanner>;
  resolveCurrentUser?: () => Promise<
    Awaited<ReturnType<typeof getCurrentUser>>
  >;
  resolveUserIdFromRequest?: (request: Request) => Promise<string | null>;
}

async function defaultPlanAccommodations(
  input: Parameters<typeof runAccommodationPlanner>[0],
) {
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
}

const defaultDependencies: ItineraryRouteDependencies = {
  getItinerary,
  deleteItinerary,
  saveItinerary,
  getItineraryMapData,
  loadEngineContextForPlan,
  generateItinerary,
  precacheItineraryRouteGeometry,
  planAccommodations: defaultPlanAccommodations,
  resolveCurrentUser: getCurrentUser,
  resolveUserIdFromRequest: defaultResolveUserIdFromRequest,
};

/**
 * GET /api/itinerary/:id
 *
 * Returns {@link ItineraryDetail} (`{ itinerary, map }`). The `map` payload
 * is map-render-ready: stop/stay/attraction markers and travel legs with
 * pre-decoded polylines when geometry is cached. Falls back to a direct
 * line on legs whose geometry is not yet cached.
 */
export async function handleGetItinerary(
  id: string,
  deps: ItineraryRouteDependencies = defaultDependencies,
  request?: Request,
) {
  if (!id) {
    return NextResponse.json(
      { error: "invalid_input", message: "id is required." },
      { status: 400 },
    );
  }

  try {
    const itinerary = await deps.getItinerary(id);
    if (!itinerary) {
      return NextResponse.json(
        { error: "not_found", message: `Itinerary ${id} not found.` },
        { status: 404 },
      );
    }

    if (itinerary.user_id !== null) {
      const resolveUserIdFromRequest =
        deps.resolveUserIdFromRequest ?? defaultResolveUserIdFromRequest;
      const resolveCurrentUser = deps.resolveCurrentUser ?? getCurrentUser;
      let requesterUserId: string | null = null;
      try {
        requesterUserId = request
          ? await resolveUserIdFromRequest(request)
          : ((await resolveCurrentUser())?.uid ?? null);
      } catch {
        requesterUserId = null;
      }

      if (!requesterUserId) {
        return NextResponse.json(
          { error: "unauthorized", message: "Sign in to view saved itineraries." },
          { status: 401 },
        );
      }
      if (
        !canAccessItinerary({
          itineraryUserId: itinerary.user_id,
          requesterUserId,
        })
      ) {
        return NextResponse.json(
          {
            error: "forbidden",
            message: "You can only view itineraries saved to your account.",
          },
          { status: 403 },
        );
      }
    }

    const map = await deps.getItineraryMapData(itinerary);
    const payload: ItineraryDetail = { itinerary, map };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: "internal_error", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function handleDeleteItinerary(
  id: string,
  deps: ItineraryRouteDependencies = defaultDependencies,
) {
  if (!id) {
    return NextResponse.json(
      { error: "invalid_input", message: "id is required." },
      { status: 400 },
    );
  }

  try {
    const resolveCurrentUser = deps.resolveCurrentUser ?? getCurrentUser;
    const user = await resolveCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Sign in to delete itineraries." },
        { status: 401 },
      );
    }

    const itinerary = await deps.getItinerary(id);
    if (!itinerary) {
      return NextResponse.json(
        { error: "not_found", message: `Itinerary ${id} not found.` },
        { status: 404 },
      );
    }

    if (itinerary.user_id !== user.uid) {
      return NextResponse.json(
        {
          error: "forbidden",
          message: "You can only delete itineraries saved to your account.",
        },
        { status: 403 },
      );
    }

    await deps.deleteItinerary(id);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json(
      { error: "internal_error", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function handleUpdateItineraryBudget(
  id: string,
  request: Request,
  deps: ItineraryRouteDependencies = defaultDependencies,
) {
  if (!id) {
    return NextResponse.json(
      { error: "invalid_input", message: "id is required." },
      { status: 400 },
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

  const parsed = adjustItineraryBudgetSchema.safeParse(body);
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

  const existingItinerary = await deps.getItinerary(id);
  if (!existingItinerary) {
    return NextResponse.json(
      { error: "not_found", message: `Itinerary ${id} not found.` },
      { status: 404 },
    );
  }

  if (existingItinerary.user_id === null && parsed.data.apply) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message: "Guest itineraries are read-only. Sign in to save updates.",
      },
      { status: 401 },
    );
  }

  if (existingItinerary.user_id !== null) {
    const resolveUserIdFromRequest =
      deps.resolveUserIdFromRequest ?? defaultResolveUserIdFromRequest;
    let requesterUserId: string | null = null;
    try {
      requesterUserId = await resolveUserIdFromRequest(request);
    } catch {
      requesterUserId = null;
    }

    if (!requesterUserId) {
      return NextResponse.json(
        {
          error: "unauthorized",
          message: "Sign in to update itineraries saved to your account.",
        },
        { status: 401 },
      );
    }

    if (
      !canAccessItinerary({
        itineraryUserId: existingItinerary.user_id,
        requesterUserId,
      })
    ) {
      return NextResponse.json(
        {
          error: "forbidden",
          message: "You can only update itineraries saved to your account.",
        },
        { status: 403 },
      );
    }
  }

  const requestedBudgetMax = Math.round(parsed.data.total_budget);
  const requestedBudget = {
    ...existingItinerary.preferences.budget,
    min: Math.min(existingItinerary.preferences.budget.min, requestedBudgetMax),
    max: requestedBudgetMax,
  };
  const requestedModes: TransportMode[] =
    existingItinerary.preferences.transport_modes &&
    existingItinerary.preferences.transport_modes.length > 0
      ? existingItinerary.preferences.transport_modes
      : ["road"];
  const input = {
    regions: [existingItinerary.region],
    start_node: existingItinerary.start_node,
    end_node: existingItinerary.end_node,
    days: existingItinerary.days,
    user_id: existingItinerary.user_id ?? undefined,
    preferences: {
      ...existingItinerary.preferences,
      budget: requestedBudget,
      transport_modes: requestedModes,
    },
  };

  const loadContext = deps.loadEngineContextForPlan ?? loadEngineContextForPlan;
  let ctx;
  try {
    ctx = await loadContext({
      regions: input.regions,
      start_node_id: input.start_node,
      end_node_id: input.end_node,
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

  const runItineraryGeneration = deps.generateItinerary ?? generateItinerary;
  const result = await runItineraryGeneration(input, ctx);
  if (!result.ok) {
    return NextResponse.json(result.error, { status: 422 });
  }

  const planAccommodations =
    deps.planAccommodations ?? defaultPlanAccommodations;
  let hydratedItinerary = result.itinerary;
  try {
    const accommodationPlan = await planAccommodations({
      days: hydratedItinerary.day_plan,
      budget: requestedBudget,
      travellers: input.preferences.travellers,
      travelStyle: input.preferences.travel_style,
      accommodationPreference: input.preferences.accommodation_preference,
      interests: input.preferences.interests,
      tripStartDate: input.preferences.trip_start_date,
      region: hydratedItinerary.region,
      cityLocationsByNodeId: buildCityLocationsByNodeId(ctx.nodes),
    });
    hydratedItinerary = integrateAccommodationPlanIntoItinerary({
      itinerary: hydratedItinerary,
      stays: accommodationPlan.stays,
      warnings: accommodationPlan.warnings,
      requestedBudget,
    });
    const finalBudgetError = validateBudget(
      hydratedItinerary.estimated_cost,
      requestedBudget,
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

  const updatedItinerary: Itinerary = {
    ...hydratedItinerary,
    id: existingItinerary.id,
    user_id: existingItinerary.user_id,
    created_at: existingItinerary.created_at,
  };
  const preview = buildBudgetAdjustmentPreview({
    current: existingItinerary,
    proposed: updatedItinerary,
    requestedBudget: requestedBudget.max,
    currency: requestedBudget.currency,
  });

  if (!parsed.data.apply) {
    return NextResponse.json({ preview }, { status: 200 });
  }

  const precacheRoute =
    deps.precacheItineraryRouteGeometry ?? precacheItineraryRouteGeometry;
  try {
    await precacheRoute?.(updatedItinerary, ctx.nodes);
  } catch {
    // Geometry caching is additive only; applying the new itinerary should
    // still succeed even if polyline generation is temporarily unavailable.
  }

  const persistItinerary = deps.saveItinerary ?? saveItinerary;
  try {
    await persistItinerary(updatedItinerary);
  } catch (err) {
    return NextResponse.json(
      {
        error: "persistence_failed",
        message: (err as Error).message,
        itinerary: updatedItinerary,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      itinerary: updatedItinerary,
      preview,
    },
    { status: 200 },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleGetItinerary(id, defaultDependencies, request);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleUpdateItineraryBudget(id, request);
}

/**
 * DELETE /api/itinerary/:id
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleDeleteItinerary(id);
}

async function defaultResolveUserIdFromRequest(
  request: Request,
): Promise<string | null> {
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
