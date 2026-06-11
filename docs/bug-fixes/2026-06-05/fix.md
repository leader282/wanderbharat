# Critical Bug Fix Audit

- Audit date: 2026-06-05
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, abuse-cost, and build-breaking bugs

## Bugs Found

1. Public region allowlists were only applied to `/api/regions`.
   - When `WB_ALLOWED_REGIONS` was set, callers could still query hidden regions through `/api/nodes` or submit itinerary generation requests for those regions. That could expose unreleased seeded data and trigger provider/planning work outside the public rollout boundary.

2. Valid multi-region itinerary requests could exceed Firestore disjunction limits.
   - Planning edge loads combined `regions array-contains-any` with `from in`. With several requested regions and a full 10-city chunk, Firestore can exceed its compound disjunction limit and turn valid requests into planning failures.

3. Map geometry caching could corrupt bidirectional manual route edges.
   - Enriching an existing edge with a Google polyline overwrote `metadata.provider` with `google_routes`. The itinerary matrix treats Google provider edges as directional, so a manual bidirectional edge could stop resolving in reverse after map precaching.

4. LiteAPI hotel rates in the wrong currency were counted as the itinerary currency.
   - Rate options preserved their provider currency, but accommodation selection and budget integration did not filter against the requested budget currency. A `USD 100` rate could be summed as `100 INR`, understating lodging cost and budget validation.

5. Admin/provider history reads were bounded only after fetching all matching Firestore documents.
   - Provider call logs and hotel search/offer snapshots were fetched in full, sorted in memory, then sliced. In production these collections grow with traffic, so admin pages and data-quality scans could time out, OOM, or incur excessive reads during incidents.

## Fixes Made

- Reused the public region allowlist across `/api/nodes`, itinerary generation, and budget regeneration, and added loader-level validation for pinned start/end/requested cities outside the requested regions.
- Changed planning edge loading to fan out by region and 10-city chunks, keeping each Firestore query below compound disjunction limits while deduping returned edges.
- Preserved manual edge provider metadata when adding route geometry, recording geometry provenance separately unless the edge was already Google-resolved.
- Filtered hotel rate options by requested budget currency before ranking or adding lodging totals, leaving mismatched-currency stays unknown with a warning.
- Added Firestore-side ordering and limits to provider log and hotel snapshot reads, plus the required composite indexes for the new ordered query shapes.
- Added focused Node test coverage for the confirmed fixes.

## Files Changed

- `docs/bug-fixes/2026-06-05/fix.md`
- `firestore.indexes.json`
- `src/app/api/itinerary/[id]/route.ts`
- `src/app/api/itinerary/[id]/route.test.ts`
- `src/app/api/itinerary/generate/route.ts`
- `src/app/api/itinerary/generate/route.test.ts`
- `src/app/api/nodes/route.ts`
- `src/app/api/nodes/route.test.ts`
- `src/lib/itinerary/accommodation.ts`
- `src/lib/itinerary/accommodation.test.ts`
- `src/lib/itinerary/loadContext.ts`
- `src/lib/itinerary/loadContext.test.ts`
- `src/lib/repositories/hotelOfferSnapshotRepository.ts`
- `src/lib/repositories/hotelSearchSnapshotRepository.ts`
- `src/lib/repositories/providerCallLogRepository.ts`
- `src/lib/repositories/regionRepository.ts`
- `src/lib/repositories/regionRepository.test.ts`
- `src/lib/services/itineraryMapService.ts`
- `src/lib/services/itineraryMapService.test.ts`

## Validation Run

- `node --import tsx --test "src/lib/repositories/regionRepository.test.ts" "src/app/api/nodes/route.test.ts" "src/app/api/itinerary/generate/route.test.ts" "src/app/api/itinerary/[id]/route.test.ts" "src/lib/itinerary/loadContext.test.ts" "src/lib/services/itineraryMapService.test.ts" "src/lib/itinerary/accommodation.test.ts"`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

All validation commands completed successfully.

## Residual Risks

- Public itinerary and budget routes still use in-memory rate limiting, which does not provide durable cross-instance protection in serverless production.
- The new Firestore composite indexes in `firestore.indexes.json` must be deployed before relying on the newly ordered filtered admin queries in production.
