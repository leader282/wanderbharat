# Critical Bug Fix Audit

- Audit date: 2026-06-26
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, and build-breaking bugs

## Bugs Found

1. Budget-adjustment itinerary reads could crash the route and bypass the API's redacted error contract.
   - `PATCH /api/itinerary/:id` read the existing itinerary before entering any route-level backend failure handling. A Firestore outage or repository exception during `getItinerary(id)` would escape the handler instead of returning a controlled JSON 500 response.
   - Impact: users adjusting an itinerary budget could hit an unhandled server error, and the route did not consistently guarantee that backend details were hidden from clients.

2. Contact mail delivery exceptions could crash the contact endpoint.
   - `POST /api/contact` handled structured mailer failures but assumed `sendContactEmail` would always resolve to a result object. If the Resend SDK or transport layer threw, the exception escaped the route.
   - Impact: contact submissions could fail as unhandled server errors during provider/network failures instead of returning the existing safe `delivery_failed` response.

No other confirmed critical production-impacting bugs were found during this pass. The audit covered itinerary generation/regeneration boundaries, auth/session helpers, admin-only routes and server actions, repository normalization, external provider boundaries, client/server secret boundaries, and build/type/test health.

## Fixes Made

- Wrapped budget-update itinerary reads in route-level error handling and return the same safe `internal_error` shape used by the itinerary API for backend read failures.
- Added a regression test proving `PATCH /api/itinerary/:id` redacts thrown Firestore/repository details when the initial itinerary read fails.
- Wrapped contact mail delivery in a route-level `try/catch` and map thrown provider failures to the existing `delivery_failed` 502 response.
- Added a regression test proving thrown mail delivery errors are handled without leaking provider exception details.

## Files Changed

- `docs/bug-fixes/2026-06-26/fix.md`
- `src/app/api/contact/route.ts`
- `src/app/api/contact/route.test.ts`
- `src/app/api/itinerary/[id]/route.ts`
- `src/app/api/itinerary/[id]/route.test.ts`

## Validation Run

- `npm test`
- `node scripts/runNodeTests.mjs src/app/api/itinerary/[id]/route.test.ts src/app/api/contact/route.test.ts`
- `npm run lint && npm run typecheck && npm test && npm run build`
  - `npm run lint`, `npm run typecheck`, and `npm test` completed successfully.
  - The first `npm run build` attempt was blocked by an already-running Next build lock.
- `npm run build`

All validation commands completed successfully after rerunning `npm run build` once the competing build process exited.

## Residual Risks

- Itinerary and contact rate limiting remains process-local in memory, so serverless multi-instance deployments may still need durable rate limiting for stronger abuse protection.
- The audit was code- and test-based; live Firebase, Resend, Google Routes, Turnstile, and LiteAPI service behavior was not exercised against production credentials.
