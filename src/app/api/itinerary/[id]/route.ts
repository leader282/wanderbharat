import { NextResponse } from "next/server";

import {
  createSlidingWindowRateLimiter,
  getClientIpAddress,
  type RateLimitDecision,
} from "@/lib/api/rateLimit";
import {
  readJsonBodyWithLimit,
  type JsonBodyReadResult,
} from "@/lib/api/jsonBody";
import { adjustItineraryBudgetSchema } from "@/lib/api/validation";
import { buildBudgetAdjustmentPreview } from "@/lib/itinerary/budgetAdjustmentPreview";
import { resolveRequestUserId } from "@/lib/auth/requestUser";
import { getCurrentUser } from "@/lib/auth/session";
import { planAccommodations as runAccommodationPlanner } from "@/lib/itinerary/accommodation";
import { integrateAccommodationPlanIntoItinerary } from "@/lib/itinerary/accommodationBudget";
import { canAccessItinerary } from "@/lib/itinerary/itineraryAccess";
import { validateBudget } from "@/lib/itinerary/constraints";
import {
  generateItinerary,
  type EngineDependencies,
} from "@/lib/itinerary/engine";
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
import { getDisallowedPublicRegions } from "@/lib/repositories/regionRepository";
import {
  deleteItinerary,
  getItinerary,
  saveItinerary,
} from "@/lib/repositories/itineraryRepository";
import {
  getItineraryMapData,
  precacheItineraryRouteGeometry,
} from "@/lib/services/itineraryMapService";
import { resolveTravelMatrix } from "@/lib/services/travelMatrixResolver";
import type {
  Coordinates,
  Itinerary,
  ItineraryDetail,
  TransportMode,
} from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUDGET_UPDATE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const BUDGET_UPDATE_RATE_LIMIT_MAX_REQUESTS = 8;
const MAX_BUDGET_UPDATE_CONTENT_LENGTH_BYTES = 2_000;

const checkBudgetUpdateQuota = createSlidingWindowRateLimiter({
  windowMs: BUDGET_UPDATE_RATE_LIMIT_WINDOW_MS,
  maxRequests: BUDGET_UPDATE_RATE_LIMIT_MAX_REQUESTS,
});

interface ItineraryRouteDependencies {
  getItinerary: typeof getItinerary;
  deleteItinerary: typeof deleteItinerary;
  saveItinerary?: typeof saveItinerary;
  getItineraryMapData: typeof getItineraryMapData;
  loadEngineContextForPlan?: typeof loadEngineContextForPlan;
  generateItinerary?: typeof generateItinerary;
  resolveTravelMatrix?: NonNullable<EngineDependencies["resolveTravelMatrix"]>;
  precacheItineraryRouteGeometry?: typeof precacheItineraryRouteGeometry;
  planAccommodations?: (
    input: Parameters<typeof runAccommodationPlanner>[0],
  ) => ReturnType<typeof runAccommodationPlanner>;
  resolveCurrentUser?: () => Promise<
    Awaited<ReturnType<typeof getCurrentUser>>
  >;
  resolveUserIdFromRequest?: (request: Request) => Promise<string | null>;
  checkBudgetUpdateRateLimit?: (
    request: Request,
    userId: string | null,
  ) => RateLimitDecision;
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
  resolveTravelMatrix,
  precacheItineraryRouteGeometry,
  planAccommodations: defaultPlanAccommodations,
  resolveCurrentUser: getCurrentUser,
  resolveUserIdFromRequest: defaultResolveUserIdFromRequest,
  checkBudgetUpdateRateLimit: checkItineraryBudgetUpdateRateLimit,
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

    if (itinerary.user_id != null) {
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
          {
            error: "unauthorized",
            message: "Sign in to view saved itineraries.",
          },
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
  } catch {
    return NextResponse.json(
      {
        error: "internal_error",
        message: "We couldn't load this itinerary. Please try again shortly.",
      },
      { status: 500 },
    );
  }
}

export async function handleDeleteItinerary(
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
    const requesterUserId = await resolveDeleteRequesterUserId(request, deps);
    if (!requesterUserId) {
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

    if (
      itinerary.user_id == null ||
      !canAccessItinerary({
        itineraryUserId: itinerary.user_id,
        requesterUserId,
      })
    ) {
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
  } catch {
    return NextResponse.json(
      {
        error: "internal_error",
        message: "We couldn't delete this itinerary. Please try again shortly.",
      },
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

  const bodyResult = await readJsonBodyWithLimit(
    request,
    MAX_BUDGET_UPDATE_CONTENT_LENGTH_BYTES,
  );
  if (!bodyResult.ok) {
    return NextResponse.json(
      jsonBodyErrorPayload(bodyResult, "Request body must be JSON."),
      { status: bodyResult.status },
    );
  }

  const body = bodyResult.body;
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

  const checkBudgetUpdateRateLimit =
    deps.checkBudgetUpdateRateLimit ?? checkItineraryBudgetUpdateRateLimit;
  const rateLimitDecision = checkBudgetUpdateRateLimit(request, null);
  if (!rateLimitDecision.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: "Too many itinerary budget updates. Please try again shortly.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitDecision.retryAfterSeconds),
        },
      },
    );
  }

  let existingItinerary: Itinerary | null;
  try {
    existingItinerary = await deps.getItinerary(id);
  } catch {
    return NextResponse.json(
      {
        error: "internal_error",
        message: "We couldn't load this itinerary. Please try again shortly.",
      },
      { status: 500 },
    );
  }
  if (!existingItinerary) {
    return NextResponse.json(
      { error: "not_found", message: `Itinerary ${id} not found.` },
      { status: 404 },
    );
  }

  const itineraryUserId = existingItinerary.user_id ?? null;

  if (itineraryUserId === null && parsed.data.apply) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message: "Guest itineraries are read-only. Sign in to save updates.",
      },
      { status: 401 },
    );
  }

  let requesterUserId: string | null = null;
  if (itineraryUserId !== null) {
    const resolveUserIdFromRequest =
      deps.resolveUserIdFromRequest ?? defaultResolveUserIdFromRequest;
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
        itineraryUserId,
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
  const planningRegions = normalisePlanningRegions(existingItinerary);
  const requestedCityIds = normaliseStringList(
    existingItinerary.requested_city_ids,
  );
  const disallowedRegions = getDisallowedPublicRegions(planningRegions);
  if (disallowedRegions.length > 0) {
    return NextResponse.json(
      {
        error: "region_not_available",
        reason: "region_not_available",
        message: "This itinerary's region is not available for regeneration.",
      },
      { status: 422 },
    );
  }
  const requestedModes: TransportMode[] =
    existingItinerary.preferences.transport_modes &&
    existingItinerary.preferences.transport_modes.length > 0
      ? existingItinerary.preferences.transport_modes
      : ["road"];
  const input = {
    regions: planningRegions,
    start_node: existingItinerary.start_node,
    end_node: existingItinerary.end_node,
    requested_city_ids:
      requestedCityIds.length > 0 ? requestedCityIds : undefined,
    days: existingItinerary.days,
    user_id: itineraryUserId ?? undefined,
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
      requested_city_ids: input.requested_city_ids,
      days: input.days,
      modes: requestedModes,
      travel_style: input.preferences.travel_style,
    });
  } catch (err) {
    return contextLoadErrorResponse(err);
  }

  const runItineraryGeneration = deps.generateItinerary ?? generateItinerary;
  const result = await runItineraryGeneration(input, ctx, {
    resolveTravelMatrix: deps.resolveTravelMatrix ?? resolveTravelMatrix,
  });
  if (!result.ok) {
    return NextResponse.json(result.error, { status: 422 });
  }

  const planAccommodations =
    deps.planAccommodations ?? defaultPlanAccommodations;
  let hydratedItinerary = attachPlanningCriteria(result.itinerary, input);
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
  } catch {
    return NextResponse.json(
      {
        error: "internal_error",
        message:
          "We couldn't finish hotel planning for this itinerary. Please try again shortly.",
      },
      { status: 500 },
    );
  }

  const updatedItinerary: Itinerary = {
    ...hydratedItinerary,
    id: existingItinerary.id,
    user_id: itineraryUserId,
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
  } catch {
    return NextResponse.json(
      {
        error: "persistence_failed",
        message: "We couldn't save the itinerary. Please try again shortly.",
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
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleDeleteItinerary(id, defaultDependencies, request);
}

async function resolveDeleteRequesterUserId(
  request: Request | undefined,
  deps: ItineraryRouteDependencies,
): Promise<string | null> {
  try {
    if (request) {
      const resolveUserIdFromRequest =
        deps.resolveUserIdFromRequest ?? defaultResolveUserIdFromRequest;
      return resolveUserIdFromRequest(request);
    }

    const resolveCurrentUser = deps.resolveCurrentUser ?? getCurrentUser;
    return (await resolveCurrentUser())?.uid ?? null;
  } catch {
    return null;
  }
}

function checkItineraryBudgetUpdateRateLimit(
  request: Request,
  userId: string | null,
): RateLimitDecision {
  const key = userId ? `user:${userId}` : `ip:${getClientIpAddress(request)}`;
  return checkBudgetUpdateQuota(key);
}

async function defaultResolveUserIdFromRequest(
  request: Request,
): Promise<string | null> {
  return resolveRequestUserId(request);
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

function attachPlanningCriteria(
  itinerary: Itinerary,
  input: Pick<Itinerary, "regions" | "requested_city_ids">,
): Itinerary {
  const regions = normaliseStringList(input.regions);
  const requestedCityIds = normaliseStringList(input.requested_city_ids);
  return {
    ...itinerary,
    region: regions[0] ?? itinerary.region,
    regions,
    requested_city_ids:
      requestedCityIds.length > 0 ? requestedCityIds : undefined,
  };
}

function normalisePlanningRegions(itinerary: Itinerary): string[] {
  const regions = normaliseStringList(itinerary.regions);
  const primary = itinerary.region.trim();
  if (primary && !regions.includes(primary)) return [primary, ...regions];
  return regions.length > 0 ? regions : [itinerary.region];
}

function normaliseStringList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function contextLoadErrorResponse(err: unknown) {
  const message =
    err instanceof Error ? err.message : "Failed to load planning data.";
  if (isContextInputError(message)) {
    return NextResponse.json(
      {
        error: "invalid_input",
        reason: "invalid_input",
        message,
      },
      { status: 422 },
    );
  }

  return NextResponse.json(
    {
      error: "internal_error",
      message: "We couldn't load planning data. Please try again shortly.",
    },
    { status: 500 },
  );
}

function jsonBodyErrorPayload(
  result: Extract<JsonBodyReadResult, { ok: false }>,
  invalidJsonMessage: string,
) {
  if (result.error === "payload_too_large") {
    return {
      error: result.error,
      message: result.message,
    };
  }

  return {
    error: "invalid_input",
    message: invalidJsonMessage,
  };
}

function isContextInputError(message: string): boolean {
  return (
    message === "At least one region is required." ||
    /^Start node ".+" not found\.$/.test(message) ||
    /^Start node ".+" is not in an allowed region\.$/.test(message) ||
    /^End node ".+" not found\.$/.test(message) ||
    /^End node ".+" is not in an allowed region\.$/.test(message) ||
    /^Requested city ".+" not found\.$/.test(message) ||
    /^Requested city ".+" is not in an allowed region\.$/.test(message)
  );
}
