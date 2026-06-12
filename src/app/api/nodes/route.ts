import { NextResponse } from "next/server";

import { NODE_TYPES, type NodeType } from "@/types/domain";
import { findNodes } from "@/lib/repositories/nodeRepository";
import {
  getDisallowedPublicRegions,
  getPublicAllowedRegionSlugs,
} from "@/lib/repositories/regionRepository";

export const runtime = "nodejs";
/**
 * 5 minute revalidation. The UI uses this to populate start-city /
 * attraction dropdowns; fresh seeds become visible within minutes, which
 * is a much better trade than scanning on every render.
 */
export const revalidate = 300;

const DEFAULT_PAGE_SIZE = 200;

interface NodesRouteDependencies {
  findNodes: typeof findNodes;
  getDisallowedPublicRegions: typeof getDisallowedPublicRegions;
  getPublicAllowedRegionSlugs: typeof getPublicAllowedRegionSlugs;
}

const defaultDependencies: NodesRouteDependencies = {
  findNodes,
  getDisallowedPublicRegions,
  getPublicAllowedRegionSlugs,
};

/**
 * GET /api/nodes?region=...&type=city&page_size=...&cursor=...
 *
 * Paginated, cached node listing. Keeps response size bounded so a 10k
 * attraction region doesn't OOM the client.
 */
export async function handleGetNodes(
  request: Request,
  deps: NodesRouteDependencies = defaultDependencies,
) {
  const url = new URL(request.url);
  const region = url.searchParams.get("region") ?? undefined;
  const regionsParam = url.searchParams.get("regions") ?? undefined;
  const regions = regionsParam
    ? regionsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const rawType = url.searchParams.get("type");
  const type =
    rawType && (NODE_TYPES as readonly string[]).includes(rawType)
      ? (rawType as NodeType)
      : undefined;
  const pageSize = parseBoundedPositiveInteger(
    url.searchParams.get("page_size"),
    DEFAULT_PAGE_SIZE,
    500,
  );
  const limit = Math.max(
    pageSize,
    parseBoundedPositiveInteger(url.searchParams.get("limit"), pageSize, 1000),
  );

  try {
    const requestedRegions = [...(region ? [region] : []), ...(regions ?? [])];
    const disallowedRegions =
      deps.getDisallowedPublicRegions(requestedRegions);
    if (disallowedRegions.length > 0) {
      return NextResponse.json(
        {
          error: "region_not_available",
          message: "One or more requested regions are not available.",
        },
        { status: 404 },
      );
    }

    const allowedRegions = deps.getPublicAllowedRegionSlugs();
    const effectiveRegions =
      regions ??
      (!region && allowedRegions ? Array.from(allowedRegions) : undefined);
    const nodes = await deps.findNodes({
      region,
      regions: effectiveRegions,
      type,
      pageSize,
      limit,
    });
    return NextResponse.json({
      nodes,
      // If we hit `limit`, tell the client to fetch more (future
      // enhancement: emit a cursor from the repo). For the current UI the
      // default page size is larger than any seeded region.
      truncated: nodes.length >= limit,
    });
  } catch (err) {
    void err;
    return NextResponse.json(
      {
        error: "internal_error",
        message: "We couldn't load available destinations. Please try again shortly.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleGetNodes(request);
}

function parseBoundedPositiveInteger(
  raw: string | null,
  fallback: number,
  max: number,
): number {
  if (raw === null || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.trunc(parsed), max));
}
