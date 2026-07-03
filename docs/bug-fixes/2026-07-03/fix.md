# Critical Bug Fix Audit

- Audit date: 2026-07-03
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, abuse-cost, and build-breaking bugs

## Bugs Found

1. Public session-cookie creation failures exposed raw backend exception text.
   - `POST /api/auth/session` verified the Firebase ID token correctly, but if Firebase Admin failed while minting the session cookie, the route returned `(err as Error).message` directly to the caller.
   - Impact: public callers could receive Firebase/Admin operational details such as credential paths, project configuration, or provider failure text during sign-in outages.

2. Public rate limiting trusted the caller-controlled first `X-Forwarded-For` value.
   - Shared itinerary generation/budget update rate limiting and the contact route used the left-most `X-Forwarded-For` entry as the client IP. Behind proxies that append the observed client address, an attacker could send a spoofed leading value to rotate rate-limit buckets.
   - The contact route also had its own duplicate parser, so it would have remained inconsistent with itinerary endpoints if only the shared helper was fixed.
   - Impact: abuse protections for public, provider-backed flows could be weakened, increasing the risk of excess itinerary generation, hotel/routing provider calls, or contact submission spam.

No other confirmed critical production-impacting bugs were found during this pass. The audit covered public API routes, auth/session handling, itinerary generation/regeneration boundaries, rate limiting, client/server provider boundaries, Firebase repository normalization, external provider integrations, and build/type/test health.

## Fixes Made

- Replaced the session-cookie creation failure response with a stable generic sign-in error.
- Added a focused route test proving Firebase/Admin exception text is not exposed by `POST /api/auth/session`.
- Hardened `getClientIpAddress` to validate IP header values, prefer trusted single-IP proxy headers, and use the right-most valid `X-Forwarded-For` entry so caller-supplied leading spoof values do not select the rate-limit key.
- Updated `/api/contact` to use the shared IP parser instead of maintaining a duplicate implementation.
- Added focused tests for proxy-appended forwarded chains, trusted direct proxy headers, and malformed forwarded values.

## Files Changed

- `docs/bug-fixes/2026-07-03/fix.md`
- `src/app/api/auth/session/route.ts`
- `src/app/api/auth/session/route.test.ts`
- `src/app/api/contact/route.ts`
- `src/lib/api/rateLimit.ts`
- `src/lib/api/rateLimit.test.ts`

## Validation Run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `node --import tsx --test "src/lib/api/rateLimit.test.ts" "src/app/api/auth/session/route.test.ts" "src/app/api/contact/route.test.ts" "src/app/api/itinerary/generate/route.test.ts" "src/app/api/itinerary/[id]/route.test.ts"`
- `npm run build`

All validation commands completed successfully.

## Residual Risks

- Rate limiting remains process-local in memory, so multi-instance/serverless deployments still need a durable shared limiter for stronger abuse protection.
- IP-header parsing depends on deployment proxies appending or setting trusted headers correctly; direct deployments without a trusted proxy cannot make caller-provided IP headers authoritative.
