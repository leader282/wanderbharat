import { NextResponse } from "next/server";

import { NODE_TYPES, type NodeType } from "@/types/domain";
import { findNodes } from "@/lib/repositories/nodeRepository";

export const runtime = "nodejs";
/**
 * 5 minute revalidation. The UI uses this to populate start-city /
 * attraction dropdowns; fresh seeds become visible within minutes, which
 * is a much better trade than scanning on every render.
 */
export const revalidate = 300;

const DEFAULT_PAGE_SIZE = 200;

/**
 * GET /api/nodes?region=...&type=city&page_size=...&cursor=...
 *
 * Paginated, cached node listing. Keeps response size bounded so a 10k
 * attraction region doesn't OOM the client.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const region = url.searchParams.get("region") ?? undefined;
  const regionsParam = url.searchParams.get("regions") ?? undefined;
  const regions = regionsParam
    ? regionsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const rawType = url.searchParams.get("type");
  const type =
    rawType && (NODE_TYPES as readonly string[]).includes(rawType)
      ? (rawType as NodeType)
      : undefined;
  const pageSize = Math.max(
    1,
    Math.min(
      Number(url.searchParams.get("page_size") ?? DEFAULT_PAGE_SIZE),
      500,
    ),
  );
  const limit = Math.max(
    pageSize,
    Math.min(Number(url.searchParams.get("limit") ?? pageSize), 1000),
  );

  try {
    const nodes = await findNodes({ region, regions, type, pageSize, limit });
    return NextResponse.json({
      nodes,
      // If we hit `limit`, tell the client to fetch more (future
      // enhancement: emit a cursor from the repo). For the current UI the
      // default page size is larger than any seeded region.
      truncated: nodes.length >= limit,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "internal_error", message: (err as Error).message },
      { status: 500 },
    );
  }
}
