# Critical Bug Audit And Fixes

- Audit date: 2026-05-08
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, and build-breaking bugs in the WanderBharat codebase.

## Bugs Found

1. Live travel matrix resolution persisted provider results as sorted, bidirectional edges. Google Routes results are directional, so an A-to-B result could be reused for B-to-A even when the reverse route is slower, unavailable, or geometrically different.
2. The pure itinerary engine had wall-clock and random ID fallbacks. Production generation could run without an injected clock or ID generator, violating the pure-engine boundary and making core planning non-deterministic.

## Fixes Made

- Live matrix resolution now resolves and caches missing directions independently, stores provider-resolved legs with their actual `from`/`to` direction, marks them `bidirectional: false`, and treats legacy Google-routed edges as directional.
- Itinerary map geometry caching now writes directional live geometry, does not reuse reverse-direction cached polylines or stale Google-routed reverse edges, and keeps exact-direction cached geometry reuse intact.
- The engine context now requires an injected clock and ID generator. The server-side context loader supplies those dependencies, while the pure engine no longer calls `Date.now()`, `Math.random()`, or `crypto.randomUUID()`.
- Tests now cover asymmetric provider travel times, directional route geometry caching, and updated API route stubs for the stricter engine context.

## Files Changed

- `src/app/api/itinerary/[id]/route.test.ts`
- `src/app/api/itinerary/generate/route.test.ts`
- `src/lib/itinerary/engine.ts`
- `src/lib/itinerary/loadContext.ts`
- `src/lib/itinerary/travelMatrix.ts`
- `src/lib/itinerary/travelMatrix.test.ts`
- `src/lib/services/itineraryMapService.ts`
- `src/lib/services/itineraryMapService.test.ts`
- `docs/bug-fixes/2026-05-08/fix.md`

## Validation Run

- `npm test -- src/lib/itinerary/travelMatrix.test.ts src/lib/services/itineraryMapService.test.ts src/app/api/itinerary/generate/route.test.ts src/app/api/itinerary/[id]/route.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

All validation commands passed.

## Residual Risks

- Existing bidirectional edges already persisted from older live provider results may remain in Firestore until refreshed or cleaned up. The updated code treats Google-routed legacy edges as directional so reverse legs can be re-resolved instead of reused.
- Anonymous itinerary generation remains intentionally supported by the current product flow. This audit did not add a durable distributed rate limiter or App Check enforcement.
