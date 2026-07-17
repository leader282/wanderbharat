import { NextResponse } from "next/server";

import {
  createSlidingWindowRateLimiter,
  getClientIpAddress,
  type RateLimitDecision,
} from "@/lib/api/rateLimit";
import {
  generateItinerarySchema,
  type GenerateItineraryBody,
} from "@/lib/api/validation";
import { resolveRequestUserId } from "@/lib/auth/requestUser";
import { planAccommodations as runAccommodationPlanner } from "@/lib/itinerary/accommodation";
import { integrateAccommodationPlanIntoItinerary } from "@/lib/itinerary/accommodationBudget";
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
import { saveItinerary } from "@/lib/repositories/itineraryRepository";
import { precacheItineraryRouteGeometry } from "@/lib/services/itineraryMapService";
import { resolveTravelMatrix } from "@/lib/services/travelMatrixResolver";
import type { Coordinates, Itinerary, TransportMode } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERATE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const GENERATE_RATE_LIMIT_MAX_REQUESTS = 8;
const MAX_GENERATE_CONTENT_LENGTH_BYTES = 25_000;

const checkGenerateQuota = createSlidingWindowRateLimiter({
  windowMs: GENERATE_RATE_LIMIT_WINDOW_MS,
  maxRequests: GENERATE_RATE_LIMIT_MAX_REQUESTS,
});

interface GenerateRouteDependencies {
  /** Planning-aware loader. Prunes by start/end/modes/days. */
  loadEngineContextForPlan: typeof loadEngineContextForPlan;
  generateItinerary: typeof generateItinerary;
  resolveTravelMatrix?: NonNullable<EngineDependencies["resolveTravelMatrix"]>;
  saveItinerary: typeof saveItinerary;
  precacheItineraryRouteGeometry?: typeof precacheItineraryRouteGeometry;
  planAccommodations: (
    input: Parameters<typeof runAccommodationPlanner>[0],
  ) => ReturnType<typeof runAccommodationPlanner>;
  /**
   * Resolve the authenticated user (if any) for this request. Defaults to
   * trusting a supplied `Authorization: Bearer <idToken>` before the session
   * cookie so stale cookies cannot misattribute fresh client requests.
   * Tests can stub this without going through Firebase.
   */
  resolveUserId?: (request: Request) => Promise<string | null>;
  checkRateLimit?: (
    request: Request,
    userId: string | null,
  ) => RateLimitDecision;
}

const defaultDependencies: GenerateRouteDependencies = {
  loadEngineContextForPlan,
  generateItinerary,
  resolveTravelMatrix,
  saveItinerary,
  precacheItineraryRouteGeometry,
  planAccommodations: async (input) => {
    const liteApiConfig = resolveLiteApiProviderConfig();
    return runAccommodationPlanner(input, {
      getByNode,
      hotelDataProvider: new LiteApiHotelDataProvider({
        config: liteApiConfig,
      }),
      findLatestHotelSearchSnapshotByQueryKey,
      saveHotelSearchSnapshot,
      findLatestHotelOfferSnapshotByCacheKey,
      saveHotelOfferSnapshot,
      maxHotelProviderCalls: liteApiConfig.maxProviderCallsPerItinerary,
    });
  },
  resolveUserId: defaultResolveUserId,
  checkRateLimit: checkItineraryGenerationRateLimit,
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
  const payloadSizeError = rejectOversizedRequest(
    request,
    MAX_GENERATE_CONTENT_LENGTH_BYTES,
  );
  if (payloadSizeError) return payloadSizeError;

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
  const disallowedRegions = getDisallowedPublicRegions(parsed.data.regions);
  if (disallowedRegions.length > 0) {
    return NextResponse.json(
      {
        error: "region_not_available",
        reason: "region_not_available",
        message: "One or more requested regions are not available.",
      },
      { status: 422 },
    );
  }

  const resolveUserId = deps.resolveUserId ?? defaultResolveUserId;
  let authedUserId: string | null = null;
  try {
    authedUserId = await resolveUserId(request);
  } catch {
    authedUserId = null;
  }

  const checkRateLimit =
    deps.checkRateLimit ?? checkItineraryGenerationRateLimit;
  const rateLimitDecision = checkRateLimit(request, authedUserId);
  if (!rateLimitDecision.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message:
          "Too many itinerary generation attempts. Please try again shortly.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitDecision.retryAfterSeconds),
        },
      },
    );
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
    return contextLoadErrorResponse(err);
  }

  const result = await deps.generateItinerary(input, ctx, {
    resolveTravelMatrix: deps.resolveTravelMatrix ?? resolveTravelMatrix,
  });
  if (!result.ok) {
    return NextResponse.json(result.error, { status: 422 });
  }

  let itinerary = attachPlanningCriteria(result.itinerary, input);
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
  } catch {
    return NextResponse.json(
      itineraryInternalErrorPayload(
        "We couldn't finish hotel planning for this itinerary. Please try again shortly.",
      ),
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
  } catch {
    return NextResponse.json(
      {
        error: "persistence_failed",
        message: "We couldn't save the itinerary. Please try again shortly.",
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
 * Default user-id resolver. A present bearer token represents the current
 * Firebase client user and wins over any stale session cookie.
 */
async function defaultResolveUserId(request: Request): Promise<string | null> {
  return resolveRequestUserId(request);
}

function checkItineraryGenerationRateLimit(
  request: Request,
  userId: string | null,
): RateLimitDecision {
  const key = userId ? `user:${userId}` : `ip:${getClientIpAddress(request)}`;
  return checkGenerateQuota(key);
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

function rejectOversizedRequest(request: Request, maxBytes: number) {
  const contentLengthHeader = request.headers.get("content-length");
  if (!contentLengthHeader) return null;

  const contentLength = Number.parseInt(contentLengthHeader, 10);
  if (!Number.isFinite(contentLength) || contentLength <= maxBytes) {
    return null;
  }

  return NextResponse.json(
    {
      error: "payload_too_large",
      message: "Request payload is too large.",
    },
    { status: 413 },
  );
}

function attachPlanningCriteria(
  itinerary: Itinerary,
  input: Pick<GenerateItineraryBody, "regions" | "requested_city_ids">,
): Itinerary {
  const regions = dedupeStrings(input.regions);
  const requestedCityIds = dedupeStrings(input.requested_city_ids ?? []);
  return {
    ...itinerary,
    region: regions[0] ?? itinerary.region,
    regions,
    requested_city_ids:
      requestedCityIds.length > 0 ? requestedCityIds : undefined,
  };
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
    itineraryInternalErrorPayload(
      "We couldn't load planning data. Please try again shortly.",
    ),
    { status: 500 },
  );
}

function itineraryInternalErrorPayload(message: string): {
  error: "internal_error";
  message: string;
} {
  return {
    error: "internal_error",
    message,
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

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
