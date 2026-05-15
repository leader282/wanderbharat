# Critical Bug Fix Audit

- Audit date: 2026-05-15
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, abuse-cost, and build-breaking bugs

## Bugs Found

1. Session cookie minting was vulnerable to login CSRF/session fixation.
   - `POST /api/auth/session` accepted form-compatible content types and did not reject cross-origin state-changing requests before creating an HTTP-only Firebase session cookie.

2. Public itinerary generation and guest budget previews had no abuse throttle.
   - Anonymous callers could repeatedly trigger expensive planning, provider lookups, route geometry work, and writes without a `429` guard.

3. The pure itinerary matrix module bundled live Google routing and edge persistence.
   - `src/lib/itinerary/travelMatrix.ts` imported Google distance services and Firestore edge persistence, so pure itinerary code had server/network side effects available by default.

4. Requested-city route selection could choose an over-budget route even when an under-budget route covered the same requested cities.
   - With requested cities present, `selectOptimalRoute` returned the best overall route instead of preferring the best budget-feasible route when requested-city coverage tied.

5. Lodging stay blocks counted the final trip day as an overnight stay.
   - A same-day trip produced one hotel night, and an N-day trip produced N nights instead of N-1 nights, inflating hotel searches and lodging budget totals.

## Fixes Made

- Added same-origin and `application/json` guards to session creation, and same-origin guards to session clearing.
- Added reusable sliding-window rate limiting for itinerary generation and budget update/regeneration endpoints, returning `429` with `Retry-After` before expensive planning work.
- Moved live travel matrix resolution into `src/lib/services/travelMatrixResolver.ts`; `src/lib/itinerary/travelMatrix.ts` now remains data-only/pure.
- Updated requested-city route selection to prefer a budget-feasible route when it covers the same requested-city set as the best overall route.
- Changed stay block derivation to count only overnight days, skipping final-day checkout/no-lodging blocks.
- Added and updated focused Node test coverage for all confirmed fixes.

## Files Changed

- `docs/bug-fixes/2026-05-15/fix.md`
- `src/app/api/auth/session/route.ts`
- `src/app/api/auth/session/route.test.ts`
- `src/app/api/itinerary/[id]/route.ts`
- `src/app/api/itinerary/[id]/route.test.ts`
- `src/app/api/itinerary/generate/route.ts`
- `src/app/api/itinerary/generate/route.test.ts`
- `src/lib/api/rateLimit.ts`
- `src/lib/itinerary/accommodation.test.ts`
- `src/lib/itinerary/engine.ts`
- `src/lib/itinerary/engine.test.ts`
- `src/lib/itinerary/stayBlocks.ts`
- `src/lib/itinerary/stayBlocks.test.ts`
- `src/lib/itinerary/travelMatrix.ts`
- `src/lib/itinerary/travelMatrix.test.ts`
- `src/lib/services/travelMatrixResolver.ts`

## Validation Run

- `node --import tsx --test src/app/api/auth/session/route.test.ts src/app/api/itinerary/generate/route.test.ts src/app/api/itinerary/[id]/route.test.ts src/lib/itinerary/engine.test.ts src/lib/itinerary/stayBlocks.test.ts src/lib/itinerary/accommodation.test.ts src/lib/itinerary/travelMatrix.test.ts`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

All validation commands completed successfully.

## Residual Risks

- The route throttles are in-memory per runtime instance. They reduce accidental or simple abuse, but a distributed/durable quota, CAPTCHA/App Check, or authenticated-only generation policy would be stronger for high-traffic production.
- `src/lib/itinerary/loadContext.ts` and accommodation planning still live under `src/lib/itinerary/` even though they are server-boundary orchestration. This audit removed live travel resolution from the pure matrix module, but a future folder split would make the pure-core boundary clearer.
