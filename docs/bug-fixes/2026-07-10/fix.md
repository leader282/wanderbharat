# Critical Bug Fix Audit

- Audit date: 2026-07-10
- Model: gpt-5.5-extra-high
- Scope: production-impacting correctness, security, data-loss, crash, and build-breaking bugs

## Bugs Found

1. Guest itineraries were enumerable through Firestore client queries.
   - `firestore.rules` allowed `read` on `itineraries` whenever `resource.data.user_id == null`.
   - Because `read` includes both direct document `get` and collection/query `list`, an unauthenticated Firebase client could query guest itineraries instead of only opening a known shared itinerary ID.
   - Impact: guest trip details such as destinations, dates, budget, travellers, preferences, and route data could be discovered through client-side Firestore enumeration.

No other confirmed critical production-impacting bugs were found during this pass. The audit covered public itinerary APIs, session/auth helpers, admin authorization checks, Firestore rules, itinerary generation and persistence boundaries, client/server provider boundaries, and build/type/test health.

## Fixes Made

- Split itinerary client read rules into explicit `get` and `list` operations.
- Preserved direct reads for guest itineraries and owner-owned itineraries so shared links and signed-in reads continue to work.
- Denied all client-side `list` operations on `itineraries` to prevent guest itinerary enumeration.
- Added a Node-runner regression test that guards the direct-read/list-deny rule shape and confirms itinerary/user writes remain server-only.

## Files Changed

- `docs/bug-fixes/2026-07-10/fix.md`
- `firestore.rules`
- `src/lib/firebase/firestoreRules.test.ts`

## Validation Run

- `node --import tsx --test src/lib/firebase/firestoreRules.test.ts`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

All repository validation commands completed successfully.

Firebase MCP rule validation could not run because this environment is not authenticated to the Firebase CLI or Application Default Credentials. A local Firebase emulator syntax check also could not run because the installed Java runtime is older than the Java 21 requirement from `firebase-tools`.

## Residual Risks

- The new regression test is a static rule-shape test, not an emulator-backed allow/deny test. Add emulator-based Firestore rules tests once the CI/runtime environment has Firebase credentials where needed and Java 21+.
- The live Firestore database edition could not be verified from this runner because Firebase authentication is unavailable.
