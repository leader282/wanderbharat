# Critical Bug Fix Audit

- Audit date: 2026-05-22
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, abuse-cost, and build-breaking bugs

## Bugs Found

1. Production itinerary generation did not inject the live travel matrix resolver.
   - `POST /api/itinerary/generate` called the pure engine with only cached edges, even though `resolveTravelMatrix` exists as the server-side Google Routes + edge-cache boundary. Missing cached legs could produce false `no_feasible_route` failures for otherwise reachable trips.

2. Budget preview/regeneration also skipped live travel matrix resolution.
   - `PATCH /api/itinerary/[id]` regenerated plans with cached edges only, so budget previews and saved budget updates could fail or diverge from fresh generation for trips whose required legs were not already cached.

3. LiteAPI total-only hotel rates could be ranked after more expensive explicit-nightly rates.
   - Provider offers with `nightly_amount: null` but a valid `total_amount` were sorted as if nightly cost were infinite before the planner derived the effective nightly amount. This could select a pricier stay and inflate trip cost or cause false budget failures.

4. Missing planning start nodes were returned as server crashes.
   - Known context-load validation failures such as `Start node "..." not found.` were mapped to `500 internal_error`, making invalid or stale user/data input look like a production outage.

Fewer than five critical bugs were confirmed during this audit.

## Fixes Made

- Wired `resolveTravelMatrix` through itinerary generation and budget-regeneration route handlers as an explicit engine dependency, preserving the pure engine boundary.
- Re-ranked LiteAPI hotel options after resolving effective nightly and total amounts, so total-only rates are compared by real cost.
- Mapped known context-load input failures to `422 invalid_input` responses in both affected route handlers.
- Added focused Node test coverage for travel-matrix resolver injection, total-only hotel rate ordering, and context-load validation responses.

## Files Changed

- `docs/bug-fixes/2026-05-22/fix.md`
- `src/app/api/itinerary/[id]/route.ts`
- `src/app/api/itinerary/[id]/route.test.ts`
- `src/app/api/itinerary/generate/route.ts`
- `src/app/api/itinerary/generate/route.test.ts`
- `src/lib/itinerary/accommodation.ts`
- `src/lib/itinerary/accommodation.test.ts`

## Validation Run

- `node --import tsx --test src/app/api/itinerary/generate/route.test.ts src/app/api/itinerary/[id]/route.test.ts src/lib/itinerary/accommodation.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

All validation commands completed successfully.

## Residual Risks

- Route rate limiting remains in-memory per runtime instance. That was a known limitation from the prior audit and still needs durable quota storage or stronger abuse controls for high-traffic production.
- The context loader still throws plain `Error` values for known validation failures; this audit maps the existing messages at the API boundary, but a future typed error would be less fragile.
