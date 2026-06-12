# Critical Bug Fix Audit

- Audit date: 2026-06-12
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, abuse-cost, and build-breaking bugs

## Bugs Found

1. Public catalogue routes could leak backend exception details and let malformed pagination trigger server errors.
   - `/api/regions` and `/api/nodes` returned raw thrown messages on `500` responses. Firestore/index/project details could be exposed to public callers during backend failures.
   - `/api/nodes` passed non-finite `page_size`/`limit` query values through to the repository layer. Malformed values such as `page_size=wat` could become invalid Firestore limits instead of being safely normalized.

## Fixes Made

- Added testable route handlers for `/api/regions` and `/api/nodes` while preserving the exported Next.js `GET` handlers.
- Replaced raw public `500` messages on catalogue routes with stable generic responses.
- Normalized `/api/nodes` `page_size` and `limit` parameters to bounded positive integers before repository access.
- Added focused Node tests for pagination normalization and backend-error redaction.

## Files Changed

- `docs/bug-fixes/2026-06-12/fix.md`
- `src/app/api/nodes/route.ts`
- `src/app/api/nodes/route.test.ts`
- `src/app/api/regions/route.ts`
- `src/app/api/regions/route.test.ts`

## Validation Run

- `node --import tsx --test "src/app/api/nodes/route.test.ts" "src/app/api/regions/route.test.ts"`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

All validation commands completed successfully.

## Residual Risks

- Public itinerary and budget routes still use in-memory rate limiting, which does not provide durable cross-instance protection in serverless production.
- Some authenticated/admin-only UI surfaces intentionally show operational errors to signed-in or admin users; this audit only redacted public catalogue API failures.
