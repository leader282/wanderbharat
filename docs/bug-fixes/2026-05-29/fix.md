# Critical Bug Fix Audit

- Audit date: 2026-05-29
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, abuse-cost, and build-breaking bugs

## Bugs Found

1. Fresh bearer-token requests could be attributed to a stale session cookie user.
   - The itinerary generation and itinerary update/read routes checked the session cookie before `Authorization: Bearer`, while client components send bearer tokens as a fallback. If the browser had a valid stale cookie for user A and Firebase client auth for user B, requests could be saved or authorized as user A.

2. Legacy guest itineraries with missing `user_id` were not treated as guest itineraries.
   - Older or partial Firestore documents can omit `user_id`. The access path treated `undefined` as account-owned, requiring auth for guest links, and `canAccessItinerary` could call `.trim()` on a missing owner id.

3. Itinerary APIs exposed internal provider or persistence details on `500` responses.
   - Accommodation/provider and Firestore failures returned raw thrown messages, and persistence failures returned the generated itinerary body. That could leak upstream response details, collection paths, or full itinerary data during server failures.

4. The budget panel could double count estimated travel or attraction line items.
   - `totalTripCost` already includes itinerary line items, but the panel added estimated travel/attraction line items again to the displayed ceiling. This could falsely show an itinerary as over budget.

5. LiteAPI retest cooldown checks missed the provider's stored rates endpoint.
   - The admin hotel retest guard compared logs against `"/hotels/rates"`, while the LiteAPI provider records `"hotels/rates"`. The cooldown never matched successful recent probes, allowing repeated costly retests.

## Fixes Made

- Added a shared request-user resolver that prefers a verified bearer token over session cookies and does not fall back to cookies when an explicit bearer token is invalid.
- Normalized missing persisted `user_id` values to `null`, and made itinerary access logic handle `undefined` legacy guest owners safely while keeping blank owner ids private.
- Replaced raw itinerary route `500` payloads with stable public messages and removed generated itinerary bodies from persistence-failure responses.
- Removed already-included estimated travel/attraction line items from the budget panel ceiling calculation; only food and local-transport estimates are added on top.
- Centralized LiteAPI endpoint constants and added a cooldown matcher that normalizes leading slashes before comparing provider call logs.
- Added focused Node test coverage for all confirmed fixes.

## Files Changed

- `docs/bug-fixes/2026-05-29/fix.md`
- `src/app/admin/hotels/actions.ts`
- `src/app/api/itinerary/[id]/route.ts`
- `src/app/api/itinerary/[id]/route.test.ts`
- `src/app/api/itinerary/generate/route.ts`
- `src/app/api/itinerary/generate/route.test.ts`
- `src/lib/admin/hotelRetestCooldown.ts`
- `src/lib/admin/hotelRetestCooldown.test.ts`
- `src/lib/auth/requestUser.ts`
- `src/lib/auth/requestUser.test.ts`
- `src/lib/itinerary/budgetPanelPresentation.ts`
- `src/lib/itinerary/budgetPanelPresentation.test.ts`
- `src/lib/itinerary/itineraryAccess.ts`
- `src/lib/itinerary/itineraryAccess.test.ts`
- `src/lib/providers/hotels/liteApiEndpoints.ts`
- `src/lib/providers/hotels/liteApiHotelDataProvider.ts`
- `src/lib/repositories/itineraryRepository.ts`
- `src/lib/repositories/itineraryRepository.test.ts`

## Validation Run

- `node --import tsx --test src/lib/auth/requestUser.test.ts src/lib/itinerary/itineraryAccess.test.ts src/lib/repositories/itineraryRepository.test.ts src/lib/itinerary/budgetPanelPresentation.test.ts src/lib/admin/hotelRetestCooldown.test.ts src/app/api/itinerary/generate/route.test.ts 'src/app/api/itinerary/[id]/route.test.ts'`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

All validation commands completed successfully.

## Residual Risks

- Public itinerary and budget routes still use in-memory rate limiting, which does not provide durable cross-instance protection in serverless production.
- Some non-itinerary API routes still return raw internal messages on server errors. This audit fixed the itinerary paths where provider and generated-itinerary exposure were confirmed.
