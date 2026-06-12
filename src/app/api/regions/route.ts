import { NextResponse } from "next/server";

import { listRegions } from "@/lib/repositories/regionRepository";

export const runtime = "nodejs";
/**
 * Cache the regions list for 5 minutes. The UI uses this for the region
 * dropdown, and even a newly-seeded region only needs to become visible
 * within a few minutes. Revalidate-on-demand via Vercel Runtime Cache
 * tag `regions` (future enhancement).
 */
export const revalidate = 300;

interface RegionsRouteDependencies {
  listRegions: typeof listRegions;
}

const defaultDependencies: RegionsRouteDependencies = {
  listRegions,
};

/**
 * GET /api/regions
 *
 * Returns every region known to the system. Prefers the denormalised
 * `regions` collection (cheap single-digit reads) and falls back to a
 * `nodes` scan when the collection hasn't been populated yet.
 */
export async function handleGetRegions(
  deps: RegionsRouteDependencies = defaultDependencies,
) {
  try {
    const regions = await deps.listRegions();
    return NextResponse.json({ regions });
  } catch (err) {
    void err;
    return NextResponse.json(
      {
        error: "internal_error",
        message: "We couldn't load available regions. Please try again shortly.",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return handleGetRegions();
}
