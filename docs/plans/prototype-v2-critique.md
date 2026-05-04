# Prototype V2 Plan — Skeptical Review

Review of `docs/plans/prototype-v2-plan.md` against the current codebase
(`src/types/domain.ts`, pure engine under `src/lib/itinerary/`, `scripts/purge.ts`,
`src/app/api/itinerary/generate/route.ts`, `src/lib/api/validation.ts`, Rajasthan
seed) and the architecture rules in `.cursor/rules/wanderbharat-architecture.mdc`.

## Critical issues

### 1) Overengineering

- **Provenance is pasted onto derived objects, not just sources.** The plan says to extend `GraphEdge`, `ItineraryBudgetLineItem`, `StayAssignment`, `ItineraryActivity`, and map/timeline DTOs with `source_type`/`confidence`/`fetched_at`/`verified_at`/`verified_by`. Those are computed outputs — they do not get "verified by a human." Budget line items should surface a *rolled-up* confidence, not carry full provenance per row. Edges resolved by Google Routes have `provider`/`resolved_at` already and don't need `verified_by`.
- **Per-field provenance scoping (`hours_source_type`, `hours_confidence`, `hours_fetched_at`, `hours_verified_at`, `hours_verified_by`).** You then propose a nested `admission` object for costs but not for hours. Two different shapes for the same concept. Pick nested: `hours: { periods: [...], source_type, confidence, fetched_at, verified_at, verified_by }`. Same for `admission`.
- **Eight admin pages on day one.** `data-quality`, `attractions`, `attraction-hours`, `attraction-costs`, `hotels`, `liteapi-test`, `import-export`, overview. Hours and costs are attributes of an attraction — collapse into one `/admin/attractions/[id]` detail view.
- **Stale/fresh rate caching logic.** For a narrow Rajasthan prototype, "snapshot keyed by trip parameters + `fetched_at`" plus a visible label is enough. Drop the freshness-policy layer until you have real demand.
- **Legacy-alias migration (`GraphNode.source` kept alongside new `source_type`).** This is a purge-and-reseed prototype. One-shot migrate, remove the old field. Dual-truth drift is a bigger cost than the one-line migrator.
- **`data_quality_runs` collection bullet** (even marked "later"). Remove it entirely from the v2 doc. If you compute on demand, say so — don't leave the schema door open.

### 2) Under-specified parts

- **Timezone.** "Trip date → day-of-week" is ambiguous. Pick the contract up front: day-of-week is computed in the node's region-local timezone (resolve the region's IANA zone in `regionRepository`; inject into `loadEngineContextForPlan`). Otherwise UTC-edge trips will skip/close the wrong days.
- **`trip_start_date` type** (`YYYY-MM-DD` string vs timestamp vs Firestore `Timestamp`), and how `trip_end_date` is stored versus derived. Not stated.
- **`children_ages` semantics.** Range (0–17?), infants, whether ages change room allocation, how they feed `selectOptimalRoomAllocation` (which today takes just a `children` count), and what happens on legacy reads (an old itinerary with `children: 2` → `[?, ?]`). Undefined.
- **Currency rules.** Is `preferences.budget.currency` now required? What happens if LiteAPI returns rates in a currency other than the itinerary currency (FX? reject? display verbatim)? Whose currency wins for admission costs — the node's region currency or the trip currency?
- **`guest_nationality`** is mentioned for LiteAPI but its role in picking admission-cost category (`domestic` vs `foreigner`) is not stated. That's the product-facing outcome.
- **`opening_periods` weekday convention.** 0-6 is ambiguous (Sun=0 vs Mon=0). Also: multiple intervals per day (closed for lunch), overnight spans (open until 02:00 next day), seasonal hours. Declare what's in scope and what's punted.
- **LiteAPI failure contract.** "Degrades honestly" is not a spec. Define: on provider failure do we (a) use most recent snapshot with a stale label, (b) skip rate in favor of curated `pricePerNight`, or (c) return unknown? And does itinerary generation ever block on LiteAPI? (It should not.)
- **Admin auth concretely.** One `requireAdmin()` function contract, used by both server layout and every `api/admin/*` handler. Plan says "prefer layout/helper guard" but doesn't commit to a single call site.
- **Snapshot cache key.** Stated as "keyed by ... fetched time" — **`fetched_at` must not be in the key**, otherwise every call is a cache miss. Not a throwaway nit; this is a design bug in the doc.
- **Rate limits / call budget.** No concurrency cap, retry policy, per-run LiteAPI call budget. A seeding script could burn your quota accidentally.
- **Firestore rules testing.** Mentioned only in passing. If you change rules, you need rule tests; committing to Node test runner only means you need to spell out *how* (emulator + a thin harness, not `@firebase/rules-unit-testing`'s Jest integration).
- **Traveller normalisation** across the wire. The existing `handleGenerateItinerary` throws away client `user_id`; are we similarly canonicalising `guest_nationality` / `rooms` defaults server-side? Not said.
- **`MAX_TRIP_DAYS = 7` interaction.** v2 planner sends `trip_start_date + days`; still capped at 7? Say so. (If not changing, at least note it explicitly.)

### 3) Schema mistakes

- **`opening_periods: Array<{ day, open, close }>`** can't express a single day with multiple intervals except by duplicating `day`. Document that duplicates-per-day are allowed, or adopt Google's `{ open: {day,time}, close: {day,time} }` shape for overnight spans.
- **`admission_costs[].currency` per item** without a canonical rule creates mixed-currency sums. Declare: "admission costs are stored in the node's region currency; UI converts for display if needed."
- **Shared `source_type` union** lists `liteapi` and `google_routes` alongside `manual`/`seed`. A `GraphEdge` will never have `source_type: "liteapi"`; a `hotel_rate_snapshot` will never have `google_routes`. Either split per-object unions, or keep one union and document field-specific legal subsets.
- **`hotel_rate_snapshots` cache key includes `fetched_time`.** Already flagged; keep fetched_at as data, not key.
- **`provider_call_logs` has no retention/cap policy.** Unbounded in high-failure modes. Add TTL (e.g., 30 days) and an upper row-count guard before this ships.
- **`ItineraryBudgetLineItem.amount` becoming `number | null`** forces every UI totalizer to branch. Define one `MonetaryValue = { amount: number | null; currency: string; confidence: "verified" | "estimated" | "unknown" }` and use it consistently, or keep amounts numeric and elevate the confidence to breakdown-level metadata. The plan straddles both and will cause a large, avoidable type ripple.
- **Keeping `accommodation.pricePerNight` numeric alongside LiteAPI rates** without an explicit precedence rule creates silent blending in stay selection. Write the rule: live/snapshot rate (with confidence) > curated baseline (marked legacy).
- **Preserving `GraphNode.source` as a legacy alias.** Two-field truth. In a purge/reseed world, migrate in one shot.

### 4) Deterministic engine purity risks

- **Day-of-week inside `daySchedule.ts`.** `daySchedule.ts` is pure. It cannot compute day-of-week from `trip_start_date` alone without importing a timezone. Resolve day-of-week in `loadContext.ts` (timezone injected, explicit `DayOfWeek[0..6]` array per day), and pass the *already-resolved* DOW into the engine. Do not let `daySchedule.ts` touch dates or zones.
- **Scoring with nullable costs in `selectOptimalRoute`.** Plan says "replace `avg_daily_cost ?? 0` style budget assumptions with cost states/ranges." The engine currently uses cost as a scoring/sorting signal and as a hard feasibility gate. If cost becomes nullable/ranged, you must specify the deterministic tie-breaker (e.g., unknown → treated as tuning-supplied mid estimate *for scoring only*, never for display). Otherwise ordering will change silently depending on data completeness.
- **Rate snapshots via dependencies.** `accommodation.ts` already uses DI (`{ getByNode }`). Good. But the plan's phrase "accept rate snapshots through repository dependencies" can be read as "do snapshot *fetches* from the planner" — it must not. Planner receives already-loaded snapshots; the route handler fetches.
- **`Date.now()` in `engine.ts`.** Already DI'd via `ctx.now?.() ?? Date.now()`. Fine. But if you add "snapshot freshness" logic, do *not* put `Date.now()` comparisons anywhere under `src/lib/itinerary/`.
- **`ItineraryActivity` enriched with admission cost metadata.** OK, as long as the enriched fields come from `node.metadata` that's already loaded, not a fresh read. Plan should say so.

### 5) Data-model decisions that will hurt later

- **Dropping `children: number` in favor of `children_ages: number[]` without a derived `children` field** causes a huge ripple (`selectOptimalRoomAllocation`, `totalTravellers`, existing persisted itineraries, validation, UI). Keep `children: children_ages.length` as a computed derivation stored alongside for at least v2.
- **Mixed truth for admission cost.** Raw numeric `amount` mixed with null mixed with range values makes the budget breakdown heterogeneous. Pick one value type and lift confidence to a meta-field.
- **Embedding LiteAPI `provider` / `provider_hotel_id` directly on `Accommodation`** instead of a side-table. If you ever need many providers per hotel or many hotels per curated record, you'll regret it. A `accommodation_provider_mappings` collection scales better; for prototype a single `provider_refs: Array<{ provider, external_id }>` on accommodation is fine — but pick consciously.
- **Hotel rate snapshot keyed by occupancy/children_ages format not spelled out.** You'll end up with three almost-identical cache keys. Normalize the key function (sorted, deterministic string) in a single helper and write a test.
- **No `region` denorm on `hotel_rate_snapshots`/`provider_call_logs`.** Admin dashboards will need it for per-region filtering/purging. Add it.
- **`admission_costs` using freeform `category`.** Locked unions are better; unknown categories silently break price lookup. The plan does give a finite union — keep it finite; do not let it drift.

### 6) Missing admin pages / wrong grouping

Missing from the list:

- **Cities detail** (edits `avg_daily_cost`, `recommended_hours`, description, tags — the source of today's biggest data smell).
- **Edges / routes** explorer (wrong travel times are more itinerary-breaking than wrong hotel rates).
- **Regions** management (default currency, transport modes, IANA timezone for date/DOW resolution — this *must* be editable because the plan depends on it).
- **Provider call logs viewer** (you collect them; admins need to see them when LiteAPI fails).
- **Recent itineraries inspector** (reproduce/debug bad trips).

Wrong grouping:

- Merge `attractions`, `attraction-hours`, `attraction-costs` into `/admin/attractions` with a detail page.
- `import-export` → `export` only for the prototype. Import is a footgun; document but don't implement.

### 7) LiteAPI isolation — what's missing

- **Server-only guard.** `import "server-only"` at the top of `liteApiClient.ts` (and the snapshot service) to make accidental client imports a build error. Plan doesn't mention it.
- **Type leakage rule.** LiteAPI response types must not be re-exported from `services/` or used in repositories/UI. Only internal `HotelRateSnapshot` / `HotelDiscoveryResult` types cross the boundary. Plan says "typed mapping" but doesn't forbid leakage.
- **Kill switch.** `LITEAPI_ENABLED=false` env flag short-circuits the service to "use cached snapshots only, never call provider." Needed for quota incidents.
- **Call budget per run.** Snapshot script should take `--max-calls N` and refuse to exceed it. Admin test console should also be rate-bounded.
- **Mapping layer isolation.** The curated accommodation → LiteAPI hotel mapping should be a pure function with its own tests, not inline in the client.
- **Cassettes.** The Node test runner can read fixture JSON; commit a small set of recorded LiteAPI sample responses for stable tests.

### 8) Testing gaps

- **Golden itinerary determinism test.** Given a frozen seed + fixed trip params + `ctx.now = () => 0`, same itinerary JSON every time. This is the single most valuable test and it's missing.
- **Closed-day scheduling test.** "Attraction X closed Tuesdays, trip starts Monday, day 2 is Tuesday — engine must skip X." A named end-to-end test, not a unit test buried in `daySchedule`.
- **Timezone DOW test.** Trip spanning local-midnight-vs-UTC-midnight boundary still picks the right day-of-week for attractions.
- **Legacy itinerary read test** from Firestore fixture: renders without "verified" labels, doesn't coerce unknowns to 0, budget panel shows legacy estimate.
- **Admin guard negative matrix.** Unauthed, authed-non-admin, expired session, bearer token mismatched — at minimum four explicit cases on one shared helper.
- **Provider log sanitization test.** Simulate a 401 with the API key in the response body; assert the key does not appear in the persisted log row.
- **Snapshot cache-key determinism test.** Same logical inputs → same key; whitespace/order differences don't produce duplicates.
- **Purge dry-run invariant test.** No Firestore writes when `--dry-run`; safety test for the destructive path.
- **Kill switch test.** With `LITEAPI_ENABLED=false`, snapshot service returns `kind: "disabled"` and does not touch `fetch`.
- **Firestore rule tests for the new collections.** Client read/write of `hotel_rate_snapshots`, `provider_call_logs` is rejected.
- **UI smoke for unknown-money rendering.** Budget panel, timeline, stays with `amount: null` / ranges render without NaN or "₹0" misrepresentation.

### 9) Sequence problems

- **Admin shell at phase 6 is too late.** You commit to hand-entering structured hours/costs in phase 3 — without a UI. That means editing JSON seeds, which defeats the point of moving from mock to real data.
- **LiteAPI at phase 5 is too early.** Pure data-model honesty (dates, hours, costs, UI) must land before wiring a live provider whose output you can't even label correctly yet.
- **Purge/reseed at phase 7 is too late.** You'll iterate v2 schema for weeks; a safe purge + dry-run path should exist *before* the schema work starts.
- **No explicit quality-gate milestone** before broadening beyond Rajasthan.

## Recommended changes

- Collapse all provenance to **source records only** (`GraphNode`, `Accommodation`, attraction `hours`, attraction `admission`, `hotel_rate_snapshot`) using one nested shape. Derived records (`ItineraryBudgetLineItem`, `StayAssignment`, `ItineraryActivity`) get **one rolled-up confidence** and nothing else.
- Define one `MonetaryValue` type (amount nullable, currency, confidence) and thread it through the budget breakdown. Do not sprinkle nullable numbers across unrelated fields.
- In domain types, add `trip_start_date: string (YYYY-MM-DD)` and treat `trip_end_date` as *derived* (do not persist a redundant field). Validate `trip_start_date` against the `MAX_TRIP_DAYS` window explicitly.
- Add `timezone: string` (IANA) to `RegionSummary`. Resolve day-of-week only in `loadContext.ts` using that zone. `daySchedule.ts` consumes a pre-resolved DOW per day.
- Keep `TravellerComposition.children` as **`children: number` derived from `children_ages.length`**. Room allocation keeps working unchanged; ages are additional data passed to LiteAPI and admission-tier logic.
- Add `guest_nationality` at the trip level; define the nationality → admission tier mapping as a pure helper with unit tests.
- Merge admin "attraction-hours" and "attraction-costs" into `/admin/attractions/[id]`. Add `/admin/cities/[id]`, `/admin/edges`, `/admin/regions`, `/admin/provider-logs`, `/admin/itineraries`.
- One `requireAdmin(req|request)` function. Every `api/admin/*` handler's first line calls it. `src/app/admin/layout.tsx` calls it once server-side.
- `import "server-only"` at the top of every LiteAPI file. Internal-only types. Kill switch env flag. Per-run call budget.
- Snapshot cache key excludes `fetched_at`. Add a small `hotelRateSnapshotKey.ts` pure helper with its own determinism test.
- One-shot migrator writes `source_type`, drops `source`, writes `confidence: "estimated"` + `source_type: "legacy"` for pre-existing numeric values, never writes `0` for unknown admission/hotel costs.
- `provider_call_logs` gets a region denorm and a documented retention cap. Write path strips Authorization headers and API-key params.
- Add `region` denorm on `hotel_rate_snapshots`.
- Budget UI never displays "unknown" as `0` nor estimates as verified. Centralise the label logic in one function with a test per state.
- Add a golden-file determinism test for a frozen Rajasthan input. It will catch almost every regression the rest of v2 can introduce.

## Simplified MVP path (prototype-v2 lean)

1. **Safety brake**: extend `scripts/purge.ts` (accommodations, new snapshot/log collections, dry-run default, `--yes` + typed confirmation, keep-users default). Before any schema change.
2. **Schema v2 types + validation + repository normalization** (Rajasthan only, provenance on sources only, one `MonetaryValue`, derived `children`, region timezone).
3. **One-shot migrator + reseed Rajasthan** (flag pre-existing numerics as legacy-estimated; no UI changes).
4. **Admin shell + `requireAdmin` + read-only data-quality dashboard**.
5. **Admin edit page for attractions** (hours + costs in one detail view).
6. **Date-aware scheduling**: `trip_start_date`, DOW resolved in `loadContext.ts` with injected region timezone, `daySchedule.ts` consumes pre-resolved DOW, closed-day skip logic.
7. **Traveller detail expansion**: `children_ages`, `rooms`, `guest_nationality` in UI + validation + persistence. Room allocation unchanged (driven by `children.length` derivation); ages feed admission tier + LiteAPI payload.
8. **Budget/data honesty UI**: labels and ranges and unknowns across timeline, stays, budget, map, hero/stats. All in one phase.
9. **LiteAPI v1**: server client, snapshot repository, provider call logs, admin LiteAPI test console. Read-only. Kill switch. Call budget. Never called from pure engine.
10. **Accommodation planner matches snapshots** (pure matcher over injected snapshots + labels).
11. **Regional quality gate**: `/admin/data-quality` passes a documented checklist for Rajasthan — then and only then consider broader regions.

What you cut from v2 vs the current plan: stale/fresh cache policy, separate hours/costs admin pages, per-DTO provenance, `data_quality_runs`, import, `source` legacy alias.

## Non-negotiable safety / quality gates

- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` green at the end of every phase.
- No file under `src/lib/itinerary/` imports Firestore, `fetch`, LiteAPI, Google APIs, or calls `Date.now()` outside the existing `ctx.now` fallback. New date/DOW work is injected, not intrinsic.
- `import "server-only"` at the top of every LiteAPI, snapshot service, and admin guard file.
- No `NEXT_PUBLIC_LITEAPI_*`.
- LiteAPI response types never escape `src/lib/services/liteApiClient.ts`; repositories and UI see internal types only.
- Snapshot cache key excludes `fetched_at`.
- Migrator and repositories **never** write `0` for unknown admission or hotel costs. Unknown is `null` with explicit `confidence: "unknown"`.
- Purge: default dry-run, destructive run requires `--yes` **and** a typed destination confirmation token; `users` excluded by default; `provider_call_logs` require a separate explicit flag.
- New Firestore collections (`hotel_rate_snapshots`, `provider_call_logs`) are server-write / client-deny. Rules tests exist for both.
- Every admin page + every `api/admin/*` handler goes through one `requireAdmin()` function.
- Golden-file determinism test exists and is green for a frozen Rajasthan input set with `ctx.now = () => 0`.
- LiteAPI disabled via env flag short-circuits to "cached snapshots only"; itinerary generation never blocks on provider availability.
- No UI screen claims estimated values as verified or renders unknown as `0`.
- No runtime LLM calls; no booking/payment/flight/affiliate checkout code paths land.

## Final revised phase order

0. Safety brake (purge expansion, dry-run default, export-first guidance)
1. Schema v2 foundation (domain types, validation, repository normalization, Firestore rules, region timezone)
2. One-shot migrator + Rajasthan reseed
3. Admin shell + `requireAdmin` + read-only data-quality dashboard
4. Attractions admin edit (hours + costs in one view), cities admin edit, edges + regions admin views
5. Date-aware scheduling (trip_start_date, DOW in loader, structured hours in `daySchedule.ts`, closed-day skip)
6. Traveller detail expansion (children_ages, rooms, guest_nationality)
7. Budget / data-honesty UI (labels, ranges, unknowns across all surfaces)
8. LiteAPI foundation (server client, snapshots, logs, admin test console, kill switch, call budget)
9. Accommodation planner consumes snapshots (pure matcher + labels)
10. Rajasthan quality gate; only then plan broader coverage

This sequence lets you hand-enter real Rajasthan data through the admin panel *before* the UI depends on nullable money types, and holds LiteAPI until the pure data model is honest on its own.
