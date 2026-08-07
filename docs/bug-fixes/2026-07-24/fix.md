# Critical Bug Fix Audit

- Audit date: 2026-07-24
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, and build-breaking bugs

## Bugs Found

1. Public JSON endpoints only trusted `Content-Length` for payload-size limits.
   - `/api/itinerary/generate`, `PATCH /api/itinerary/:id`, `/api/contact`, and `/api/auth/session` either checked only the declared content length or had no body-size guard before JSON parsing.
   - Headerless or chunked oversized requests could still be streamed into memory and parsed before rejection.
   - Impact: unauthenticated callers could force avoidable CPU and memory work on public itinerary, contact, and session endpoints.

2. Budget updates read itinerary documents before quota checks.
   - `PATCH /api/itinerary/:id` loaded the itinerary document before applying its update rate limiter.
   - Requests for random or non-existent itinerary IDs could force Firestore reads without hitting the intended quota path.
   - Impact: anonymous callers could amplify document reads and use the endpoint for avoidable backend load before rate limiting took effect.

3. The signed-in trips page exposed raw backend read errors.
   - `/trips` rendered `listItinerariesForUser()` exception messages directly in the page.
   - Other API routes already redact Firestore/provider details, but this server component could show project, database, or credential-path details to users when trip loading failed.
   - Impact: backend implementation details could leak through a public user-facing page during Firestore or repository failures.

4. Legacy persisted itinerary normalization missed critical planning and lodging fields.
   - `normaliseStoredItinerary()` repaired budgets and travellers but passed missing or invalid `preferences.travel_style` and `preferences.transport_modes` through unchanged.
   - Budget regeneration later passed those values into the planner context and engine config.
   - Stored stays such as `{ accommodationId: null, nightlyCost: 0, totalCost: 0 }` were preserved as finite costs on read.
   - That lost the unknown-lodging signal used by budget breakdowns.
   - Impact: older saved itineraries could 500 during budget recalculation, and itinerary budget panels could undercount unknown hotel costs by presenting incomplete lodging as free.

5. One-way route displays could drop the departure city.
   - `getDisplayRouteStops()` named `itinerary.nodes` only from day base names.
   - For direct one-way trips where the first rendered day is based at the destination, the departure node had no name and the helper fell back to displaying only day bases.
   - Impact: trip cards, stats, and budget-regeneration previews could omit the start city.

No other confirmed critical production-impacting bugs were found during this pass. The audit covered public API routes, auth/session handling, itinerary generation and budget regeneration, Firestore repository access patterns, Firestore rules, client/server boundaries, external provider call sites, persisted itinerary normalization, route display helpers, and the pure itinerary engine boundary.

## Fixes Made

- Added `readJsonBodyWithLimit()` to enforce byte limits while streaming request bodies, including requests without `Content-Length`.
- Replaced header-only or unbounded JSON parsing in public itinerary generation, itinerary budget update, contact, and session routes.
- Added regression tests proving headerless oversized requests stop before downstream planning, Firestore reads, Firebase token verification, Turnstile checks, or email sends.
- Moved budget-update rate limiting ahead of itinerary document reads.
- Replaced raw `/trips` load-error rendering with generic retry copy.
- Normalized missing legacy `travel_style` and `transport_modes` values to safe defaults when reading persisted itineraries.
- Normalized legacy zero-cost unassigned stays back to unknown lodging before deriving budget metadata.
- Updated route display reconstruction to recover one-way departure stops from travel legs.

## Files Changed

- `docs/bug-fixes/2026-07-24/fix.md`
- `src/app/api/auth/session/route.ts`
- `src/app/api/auth/session/route.test.ts`
- `src/app/api/contact/route.ts`
- `src/app/api/contact/route.test.ts`
- `src/app/api/itinerary/[id]/route.ts`
- `src/app/api/itinerary/[id]/route.test.ts`
- `src/app/api/itinerary/generate/route.ts`
- `src/app/api/itinerary/generate/route.test.ts`
- `src/app/trips/page.tsx`
- `src/lib/itinerary/routeDisplay.ts`
- `src/lib/itinerary/routeDisplay.test.ts`
- `src/lib/api/jsonBody.ts`
- `src/lib/repositories/itineraryRepository.ts`
- `src/lib/repositories/itineraryRepository.test.ts`

## Validation Run

- `node --import tsx --test "src/app/api/auth/session/route.test.ts" "src/app/api/contact/route.test.ts" "src/app/api/itinerary/generate/route.test.ts"`
- `node --import tsx --test "src/lib/repositories/itineraryRepository.test.ts" "src/lib/itinerary/routeDisplay.test.ts"`
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

All validation commands completed successfully.

## Residual Risks

- Public rate limits remain process-local best-effort counters; a distributed atomic limiter would provide stronger protection across horizontally scaled deployments.
- The admin-only LiteAPI probe route still uses standard JSON parsing after admin authorization. This is not public unauthenticated exposure, but it can be migrated to the bounded parser for defense in depth.
