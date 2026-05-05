# Critical Bug Audit And Fixes

- Audit date: 2026-05-05
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, and build-breaking bugs in the WanderBharat codebase.

## Bugs Found

1. Guest itinerary budget updates could be applied by anyone with the itinerary link. Guest itinerary reads are intentionally public, but `PATCH /api/itinerary/[id]` also allowed `apply: true`, which regenerated and persisted changes without ownership.
2. Malformed saved itineraries with a blank `user_id` were treated as public because access checks used a broad falsy check.
3. Live travel matrix resolution sent missing pair lists as both origins and destinations, causing Google Routes to compute the Cartesian product of missing pairs while only diagonal cells were used.
4. Legacy accommodation planning represented unassigned stays as `0` cost, which made unknown lodging look free and allowed persisted budget totals to understate trip cost.
5. LiteAPI hotel-rate lookup for legacy family itineraries with missing child ages silently dropped children from occupancies, risking adult-only rate discovery for parties with children.

## Fixes Made

- Guest itineraries remain previewable, but applied budget updates are rejected before regeneration or persistence.
- Itinerary access now treats only `null` owner IDs as public; blank strings are private/malformed and denied unless a valid owner matches.
- Travel matrix resolution now requests a unique-node origin/destination matrix and maps cells back to node pairs, avoiding missing-pair-squared provider calls.
- Unassigned legacy stays now carry `null` lodging costs and unknown rate metadata. Integration also normalises unassigned zero-cost stays defensively before persistence.
- Hotel-rate resolution now marks stays unknown when child ages are missing and skips provider calls instead of pricing children as absent.

## Files Changed

- `src/app/api/itinerary/[id]/route.ts`
- `src/app/api/itinerary/[id]/route.test.ts`
- `src/lib/itinerary/accommodation.ts`
- `src/lib/itinerary/accommodation.test.ts`
- `src/lib/itinerary/accommodationBudget.ts`
- `src/lib/itinerary/accommodationBudget.test.ts`
- `src/lib/itinerary/itineraryAccess.ts`
- `src/lib/itinerary/itineraryAccess.test.ts`
- `src/lib/itinerary/travelMatrix.ts`
- `src/lib/itinerary/travelMatrix.test.ts`
- `src/lib/services/hotelRateSnapshotService.ts`
- `src/types/domain.ts`
- `docs/bug-fixes/2026-05-05/fix.md`

## Validation Run

- `node --import tsx --test src/lib/itinerary/itineraryAccess.test.ts src/app/api/itinerary/[id]/route.test.ts src/lib/itinerary/travelMatrix.test.ts src/lib/itinerary/accommodation.test.ts src/lib/itinerary/accommodationBudget.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

All validation commands passed.

## Residual Risks

- This audit did not add a durable distributed rate limiter for anonymous generation. Existing per-request bounds remain in place, but stronger abuse controls would require shared infrastructure beyond these focused bug fixes.
- Travel matrix resolution still depends on live provider availability when cached edges are missing; failures remain best-effort and can produce infeasible routes rather than crashing.
