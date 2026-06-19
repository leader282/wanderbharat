# Critical Bug Fix Audit

- Audit date: 2026-06-19
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, and build-breaking bugs

## Bugs Found

1. Saved-itinerary deletion trusted only the session cookie while other itinerary mutation paths trust the request bearer token first.
   - `DELETE /api/itinerary/:id` resolved the requester through `getCurrentUser()` only. If a browser had a stale valid session cookie for one account while the active Firebase client user was another account, deletion could be authorized as the stale cookie user.
   - The client delete button also did not attach the current Firebase ID token, so the server had no way to prefer the active client identity.
   - Impact: account-owned itinerary deletion could be attributed to the wrong signed-in identity in mixed-session/stale-cookie scenarios, creating a data-loss risk.

No other confirmed critical production-impacting bugs were found during this pass. The audit covered itinerary generation/regeneration boundaries, admin mutation actions, auth/session helpers, repository normalization, external provider boundaries, client/server secret boundaries, and build/type/test health.

## Fixes Made

- Updated itinerary deletion to resolve the requester from the incoming request when available, matching `GET` and `PATCH` behavior and allowing bearer-token auth to win over stale cookies.
- Preserved existing delete semantics for guest itineraries: guest links remain readable but are not deletable through this endpoint.
- Updated `DeleteItineraryButton` to attach `Authorization: Bearer <idToken>` when the active Firebase client user has a token.
- Added route tests for stale-cookie precedence, bearer-authenticated owner deletion, and guest-itinerary delete protection.

## Files Changed

- `docs/bug-fixes/2026-06-19/fix.md`
- `src/app/api/itinerary/[id]/route.ts`
- `src/app/api/itinerary/[id]/route.test.ts`
- `src/components/DeleteItineraryButton.tsx`

## Validation Run

- `npm run typecheck`
- `npm run lint`
- `npm test -- --test-name-pattern "handleDeleteItinerary"`
- `npm test`
- `npm run build`

All validation commands completed successfully.

## Residual Risks

- Itinerary generation and budget update rate limiting is still process-local in memory, so serverless multi-instance deployments may need durable rate limiting for stronger abuse protection.
- Session-cookie and bearer-token identity can still diverge briefly until the client session sync finishes; the fixed delete path now prefers the active request bearer token when the client supplies it.
