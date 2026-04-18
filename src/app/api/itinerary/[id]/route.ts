import { NextResponse } from "next/server";

import { getItinerary } from "@/lib/repositories/itineraryRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/itinerary/:id
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: "invalid_input", message: "id is required." },
      { status: 400 },
    );
  }

  try {
    const itinerary = await getItinerary(id);
    if (!itinerary) {
      return NextResponse.json(
        { error: "not_found", message: `Itinerary ${id} not found.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ itinerary });
  } catch (err) {
    return NextResponse.json(
      { error: "internal_error", message: (err as Error).message },
      { status: 500 },
    );
  }
}
