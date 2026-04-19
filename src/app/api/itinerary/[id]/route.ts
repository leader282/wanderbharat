import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import {
  deleteItinerary,
  getItinerary,
} from "@/lib/repositories/itineraryRepository";
import { getItineraryMapData } from "@/lib/services/itineraryMapService";
import type { ItineraryDetail } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ItineraryRouteDependencies {
  getItinerary: typeof getItinerary;
  deleteItinerary: typeof deleteItinerary;
  getItineraryMapData: typeof getItineraryMapData;
  resolveCurrentUser?: () => Promise<
    Awaited<ReturnType<typeof getCurrentUser>>
  >;
}

const defaultDependencies: ItineraryRouteDependencies = {
  getItinerary,
  deleteItinerary,
  getItineraryMapData,
  resolveCurrentUser: getCurrentUser,
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleGetItinerary(id);
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
