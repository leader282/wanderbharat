# Critical Bug Fix Audit

- Audit date: 2026-07-31
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, and build-breaking bugs

## Bugs Found

1. The admin LiteAPI probe endpoint accepted cross-origin and non-JSON POST requests before any route-level request guard.
   - `POST /api/admin/liteapi-test` required an admin session before running LiteAPI probes, but it did not verify same-origin request metadata, require `application/json`, or reject oversized bodies before auth and JSON parsing.
   - Impact: a forged browser request from another site could attempt to invoke an authenticated admin-only provider probe and spend LiteAPI quota if browser cookie policy allowed the admin session to accompany the request. Oversized bodies also forced avoidable server work before rejection.

2. Itinerary planning accepted non-city start and end nodes.
   - `loadEngineContextForPlan()` verified that pinned start/end nodes existed and belonged to an allowed region, but did not require them to be city nodes. The pure itinerary engine also accepted those nodes as route endpoints.
   - Impact: malformed or hostile requests could generate itineraries anchored on attractions or other non-city records, breaking route semantics and downstream accommodation/map assumptions.

3. One-way route presentation could drop the origin stop.
   - `getDisplayRouteStops()` required every stored node id to have a day-plan base name. In normal one-way trips, the start city can appear only as `travel.from_node_id`, so the helper discarded the stored node sequence and rendered a destination-only route.
   - Impact: itinerary summaries could show misleading endpoints such as destination-to-destination for a real one-way route.

4. Itinerary map DTO construction crashed when cached edge reads failed.
   - `getItineraryMapData()` let `loadCachedEdges()` rejections propagate before building fallback legs.
   - Impact: an itinerary detail page/API response could return 500 during an edge-cache outage even though the itinerary had enough day-plan travel data to render direct fallback lines.

No other confirmed critical production-impacting bugs were found during this pass. The audit covered public itinerary APIs, session/auth helpers, admin authorization boundaries and mutation surfaces, Firestore repository normalization, itinerary generation/regeneration, route presentation, itinerary map DTO construction, external provider boundaries, client/server API usage, payload-size handling, and build/type/test health.

## Fixes Made

- Added a pre-auth request guard to `POST /api/admin/liteapi-test`.
- Rejected cross-origin admin probe requests with `csrf_rejected` before admin lookup or provider execution.
- Required `Content-Type: application/json` before parsing admin probe bodies.
- Added a `Content-Length` guard for admin probe requests before auth, JSON parsing, or provider work.
- Added regression tests proving cross-origin, non-JSON, and oversized admin probe requests do not reach admin auth or LiteAPI probe execution.
- Rejected non-city start/end nodes in both `loadEngineContextForPlan()` and `generateItinerary()`.
- Mapped non-city endpoint loader errors to controlled `invalid_input` 422 API responses for generation and budget regeneration.
- Preserved route node sequences in one-way display output with safe fallback names derived from node ids when no day-plan base name exists.
- Made map DTO construction catch cached-edge read failures and return direct fallback legs instead of crashing.
- Added focused regression tests for non-city endpoints, one-way route display, and map-cache fallback behavior.

## Files Changed

- `docs/bug-fixes/2026-07-31/fix.md`
- `src/app/api/admin/liteapi-test/route.ts`
- `src/app/api/admin/liteapi-test/route.test.ts`
- `src/app/api/itinerary/[id]/route.ts`
- `src/app/api/itinerary/[id]/route.test.ts`
- `src/app/api/itinerary/generate/route.ts`
- `src/app/api/itinerary/generate/route.test.ts`
- `src/lib/itinerary/engine.ts`
- `src/lib/itinerary/engine.test.ts`
- `src/lib/itinerary/loadContext.ts`
- `src/lib/itinerary/routeDisplay.ts`
- `src/lib/itinerary/routeDisplay.test.ts`
- `src/lib/services/itineraryMapService.ts`
- `src/lib/services/itineraryMapService.test.ts`

## Validation Run

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- `node scripts/runNodeTests.mjs src/app/api/admin/liteapi-test/route.test.ts`
- `node --import tsx --test src/lib/itinerary/engine.test.ts src/lib/itinerary/routeDisplay.test.ts src/lib/services/itineraryMapService.test.ts src/app/api/itinerary/generate/route.test.ts src/app/api/itinerary/[id]/route.test.ts src/app/api/admin/liteapi-test/route.test.ts`

All validation commands completed successfully.

## Residual Risks

- The admin probe endpoint still depends on browser cookie policy and Firebase session verification for authentication; the added same-origin guard is a route-level defense-in-depth check.
- The request-size guard relies on `Content-Length`; requests without that header still rely on platform/body-parser limits before route code finishes reading JSON.
- Route display can only derive missing stop names from node ids when the route node was not a day-plan base. This preserves the origin stop but may produce a less polished label for legacy/non-slug ids until richer route-stop names are persisted.
- Map detail pages still depend on node and accommodation reads. This fix only makes edge-cache failures non-fatal.
- Public and admin rate limits remain process-local best-effort counters. A durable distributed limiter would provide stronger abuse protection in multi-instance deployments.
