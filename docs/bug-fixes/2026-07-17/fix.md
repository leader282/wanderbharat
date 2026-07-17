# Critical Bug Fix Audit

- Audit date: 2026-07-17
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, and build-breaking bugs

## Bugs Found

1. Budget regeneration dropped original itinerary planning constraints.
   - New itinerary requests accepted `regions` and `requested_city_ids`, and the engine used those fields to keep routes inside the selected region set and include explicitly requested cities.
   - The persisted `Itinerary` snapshot did not store those criteria. When `/api/itinerary/:id` recalculated a budget, it rebuilt the input from only `itinerary.region` and omitted `requested_city_ids`.
   - Impact: applying a budget change could silently regenerate a saved itinerary without cities the user explicitly requested, and API-created multi-region itineraries could be narrowed to the primary region during regeneration.

2. Rate limiting and Turnstile remote-IP attribution used the proxy address from `X-Forwarded-For`.
   - `getClientIpAddress()` selected the right-most valid IP from `X-Forwarded-For`, which is normally the most recent proxy in a standard client/proxy chain.
   - Impact: anonymous rate limits could collapse unrelated users behind the same proxy, and contact-form Turnstile checks received the proxy IP instead of the client IP.

3. Itinerary mutation endpoints accepted oversized bodies before rejecting requests.
   - `/api/itinerary/generate` parsed JSON before any payload-size guard, and its validation allowed several unbounded strings.
   - `PATCH /api/itinerary/:id` also parsed JSON before any payload-size guard.
   - Impact: unauthenticated callers could force avoidable CPU/memory work on expensive itinerary endpoints with oversized request bodies.

No other confirmed critical production-impacting bugs were found during this pass. The audit covered public itinerary APIs, session/auth helpers, admin authorization boundaries, Firestore rules and repositories, itinerary generation/regeneration, external provider boundaries, client/server API usage, rate-limit/IP handling, and build/type/test health.

## Fixes Made

- Added optional persisted itinerary planning metadata: `regions` and `requested_city_ids`.
- Updated the itinerary engine and generation API to attach deduped planning criteria to newly created itinerary snapshots.
- Updated stored-itinerary normalization so legacy records backfill `regions` from `region` and dedupe any persisted criteria.
- Updated budget regeneration to reuse saved `regions` and `requested_city_ids` for allowlist checks, context loading, engine input, and persisted regenerated snapshots.
- Corrected `X-Forwarded-For` parsing to use the client address while still preferring trusted direct proxy headers.
- Added pre-parse `Content-Length` guards to itinerary generation and budget update endpoints.
- Bounded itinerary request slugs, node IDs, interest tags, and transport-mode arrays in Zod validation.
- Added regression tests for generation persistence, budget-regeneration preservation, repository normalization, IP parsing, payload-size guards, and schema bounds.

## Files Changed

- `docs/bug-fixes/2026-07-17/fix.md`
- `src/app/api/itinerary/[id]/route.ts`
- `src/app/api/itinerary/[id]/route.test.ts`
- `src/app/api/itinerary/generate/route.ts`
- `src/app/api/itinerary/generate/route.test.ts`
- `src/lib/api/rateLimit.ts`
- `src/lib/api/rateLimit.test.ts`
- `src/lib/api/validation.ts`
- `src/lib/api/validation.test.ts`
- `src/lib/itinerary/engine.ts`
- `src/lib/repositories/itineraryRepository.ts`
- `src/lib/repositories/itineraryRepository.test.ts`
- `src/types/domain.ts`

## Validation Run

- `node --import tsx --test src/app/api/itinerary/generate/route.test.ts src/app/api/itinerary/[id]/route.test.ts src/lib/repositories/itineraryRepository.test.ts src/lib/itinerary/engine.test.ts`
- `node --import tsx --test src/lib/api/rateLimit.test.ts src/lib/api/validation.test.ts src/app/api/itinerary/generate/route.test.ts src/app/api/itinerary/[id]/route.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

All validation commands completed successfully.

## Residual Risks

- Existing itineraries created before this fix did not persist `requested_city_ids`, so budget regeneration can only preserve explicit city requests for itineraries created after this change or records that already contain the field.
- Legacy records without `regions` are safely treated as single-region itineraries using their existing `region` field.
- Itinerary payload-size guards rely on `Content-Length`; requests without that header still rely on platform/body-parser limits before route code runs.
- Public rate limits remain process-local best-effort counters. A shared distributed limiter should be added once the deployment chooses an atomic store and quota policy.
