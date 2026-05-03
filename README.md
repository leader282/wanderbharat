# wanderbharat

A **generic travel planning engine** built with Next.js (App Router),
TypeScript, Firebase (Auth + Firestore), and Vercel.

> The engine works for any region. **Rajasthan, Gujarat, and Himachal
> Pradesh ship as seed datasets** — nothing more. There is no
> region-specific logic in any layer of the app; new regions are added by
> dropping a file under `scripts/data/`.

---

## Core design principles

1. **Data-driven** — cities, attractions, and routes are in Firestore; no
   code change is needed to add a new region.
2. **Graph-based** — cities are nodes, routes are edges. The engine runs a
   greedy nearest-neighbour TSP approximation on this graph.
3. **Extensible enums** — `travel_style`, `transport_mode`, and `node_type`
   are string-literal unions with runtime arrays, so new values are added
   in one place.
4. **Separation of concerns**
   - `lib/itinerary/engine.ts` — pure planning algorithm
   - `lib/itinerary/constraints.ts` — pure validation
   - `lib/repositories/*` — Firestore access
   - `app/api/*` — thin HTTP wrappers
5. **Deterministic** — same input → same output. No LLMs in the loop.

---

## Project layout

```
src/
  app/
    api/
      itinerary/generate/route.ts   POST /api/itinerary/generate
      itinerary/[id]/route.ts       GET  /api/itinerary/:id
      regions/route.ts              GET  /api/regions
      nodes/route.ts                GET  /api/nodes?region=&type=
      auth/session/route.ts         POST/DELETE /api/auth/session (Firebase cookie)
    itinerary/[id]/page.tsx         Itinerary view
    plan/page.tsx                   Plan form
    trips/page.tsx                  Past itineraries (signed-in users)
    page.tsx                        Landing
  components/
    PlanForm.tsx                    Data-driven (dropdowns come from DB)
    AuthHeader.tsx                  Sign-in / user menu in the layout header
  lib/
    auth/AuthProvider.tsx           Client context (Google sign-in + token)
    auth/session.ts                 Server cookie helpers + getCurrentUser()
    config/travelStyle.ts           Pacing configs per travel_style
    firebase/client.ts              Browser Firebase init
    firebase/admin.ts               Server Firebase init
    firebase/collections.ts
    repositories/
      nodeRepository.ts             Generic CRUD over `nodes`
      edgeRepository.ts             Generic CRUD over `edges`
      itineraryRepository.ts
    services/
      placesService.ts              fetchPlacesByQuery() — generic
      distanceService.ts            getTravelTime() + haversineKm()
    itinerary/
      graph.ts                      TravelGraph class + fallback speeds
      scoring.ts                    Pure scoring functions
      constraints.ts                Pure validators
      engine.ts                     The algorithm
      loadContext.ts                Wires repositories → EngineContext
    api/validation.ts               Zod schemas
  types/domain.ts                   All domain types live here
scripts/
  data/index.ts                     SeedDataset type + dynamic loader + listAvailableRegions()
  data/rajasthan.ts                 SEED DATA — default-exports a SeedDataset
  data/gujarat.ts                   SEED DATA — default-exports a SeedDataset
  data/himachal.ts                  SEED DATA — default-exports a SeedDataset
  _regions.ts                       Resolves --region / --regions / --all into a slug list
  purge.ts                          Safe scoped purge with dry-run safeguards
  seedNodes.ts                      Seeds `nodes` (cities) + `regions` summary
  seedAttractions.ts                Seeds `nodes` (type=attraction) from curated data or Places fallback
  seedAttractionHours.ts            Seeds `attraction_hours`
  seedAttractionAdmissions.ts       Seeds `attraction_admissions`
  seedEdges.ts                      Seeds `edges` (road/train/flight network)
```

---

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` → `.env.local` and fill in:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_DATABASE_ID=            # optional named DB id

FIREBASE_SERVICE_ACCOUNT_JSON=<base64-of-service-account-json>  # or SERVICE_ACCOUNT_PATH=/path/to/key.json
FIREBASE_PROJECT_ID=...

GOOGLE_MAPS_API_KEY=...                      # server: Places + Routes APIs
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY=... # browser: Maps JavaScript API
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=...          # optional; falls back to DEMO_MAP_ID locally
```

### 3. Seed Firestore

Three regions ship out of the box: **rajasthan**, **gujarat**, **himachal**.

```bash
# (optional) preview the Rajasthan purge scope safely:
npm run db:purge -- --regions=rajasthan --dry-run

# Seed everything (every dataset under scripts/data/) in one go:
npm run seed:all

# …or one collection at a time. Region selection is required — pass
# --all / --regions / --region (plus optional --dry-run):
npm run seed:nodes        -- --all
npm run seed:attractions  -- --region rajasthan
npm run seed:attraction-hours -- --region rajasthan
npm run seed:attraction-admissions -- --region rajasthan
npm run seed:edges        -- --regions gujarat,himachal
# Places fallback mode for datasets that do not define curated attractions():
npm run seed:attractions  -- --region himachal --per-city 8     # needs GOOGLE_MAPS_API_KEY
```

Region selection (one of these is required on every seed/purge script):

| Flag              | Meaning                                                |
| ----------------- | ------------------------------------------------------ |
| `--all`           | Every `scripts/data/<slug>.ts` on disk (auto-detected) |
| `--regions a,b,c` | Comma-separated explicit list                          |
| `--region <slug>` | Single slug (also accepts a comma list)                |

To add a new region:

1. Create `scripts/data/<region>.ts` that **default-exports** a `SeedDataset`
   (see `scripts/data/index.ts` for the type and `scripts/data/rajasthan.ts`
   for a working example).
2. Run `npm run seed:all` — it will pick up the new file automatically.

The seed scripts auto-discover datasets by filename — no registry edits, and
no changes are needed in the engine, API, or UI.

### 4. Run the dev server

```bash
npm run dev
# → http://localhost:3000
```

---

## Firestore schema

### `nodes` (generic — cities, attractions, hotels, transport hubs)

```json
{
  "id": "node_jaipur",
  "type": "city",
  "name": "Jaipur",
  "region": "rajasthan",
  "country": "india",
  "tags": ["heritage", "food"],
  "metadata": {
    "avg_daily_cost": 2800,
    "recommended_hours": 20
  },
  "location": { "lat": 26.9124, "lng": 75.7873 }
}
```

### `edges` (generic — road, train, flight)

`regions` is an array because edges may straddle a region border (e.g. a
Jaipur → Delhi flight sits in both `["rajasthan", "delhi"]`). The repos
filter with `array-contains` / `array-contains-any` against this field.

```json
{
  "id": "edge_node_jaipur__node_udaipur",
  "from": "node_jaipur",
  "to": "node_udaipur",
  "type": "road",
  "distance_km": 393,
  "travel_time_hours": 7,
  "bidirectional": true,
  "regions": ["rajasthan"],
  "metadata": { "road_quality": "good" }
}
```

### `regions` (denormalised summaries)

Written by `seedNodes` after each region's cities are upserted. The UI's
region picker reads this collection so a fresh seed shows up without a
full `nodes` scan.

```json
{
  "region": "rajasthan",
  "country": "india",
  "count": 10,
  "default_currency": "INR",
  "default_locale": "en-IN",
  "default_transport_modes": ["road", "train"],
  "bbox": {
    "min_lat": 24.59,
    "min_lng": 70.91,
    "max_lat": 28.02,
    "max_lng": 76.5
  },
  "updated_at": 1732000000000
}
```

### `itineraries`

```json
{
  "id": "it_abc",
  "user_id": null,
  "region": "rajasthan",
  "start_node": "node_jaipur",
  "end_node": "node_jaipur",
  "days": 5,
  "preferences": {
    "travel_style": "relaxed",
    "budget": { "min": 10000, "max": 30000 }
  },
  "nodes": ["node_jaipur", "node_udaipur", "node_jaipur"],
  "day_plan": [...],
  "estimated_cost": 24500,
  "score": 0.82,
  "created_at": 1732000000000
}
```

---

## How the engine works

1. **Load graph** — `loadEngineContextForPlan({ regions, start_node_id, days,
modes, travel_style })` pulls only the cities, attractions, and edges
   reachable within the trip's planning radius. The radius is derived from
   the fastest allowed mode × `maxTravelHoursPerDay × days × 1.5`, so
   large regions don't blow up the matrix.
2. **Filter** — exclude the start/end nodes from candidate destinations.
3. **Score** — every candidate is scored on
   `0.45·proximity + 0.4·tagMatch + 0.15·popularity`.
4. **Select** — target `days × travelStyleConfig.destinationDensity`
   destinations (rounded, clamped to graph size).
5. **Route** — greedy nearest-neighbour over the top-scoring candidates,
   respecting `maxTravelHoursPerDay` per leg.
6. **Day plan** — distribute days across stops by `recommended_hours`,
   then fill each day with attractions up to
   `(maxTotalHoursPerDay − travel) × activityFillRatio`.
7. **Constraints** — validate every day against the travel-style caps and
   the user's budget. Structured `constraint_violation` errors (with a
   suggested fix) are returned to the API.
8. **Score** — composite itinerary score from destination scores, pacing,
   and budget utilisation.

Everything in steps 2–8 is a pure function. The engine is testable
without any infrastructure — construct a `TravelGraph` in memory and
call `generateItinerary`.

---

## API

### `POST /api/itinerary/generate`

Request body:

```json
{
  "regions": ["rajasthan"],
  "start_node": "node_jaipur",
  "end_node": "node_jaipur",
  "days": 5,
  "preferences": {
    "travel_style": "balanced",
    "budget": { "min": 15000, "max": 45000, "currency": "INR" },
    "interests": ["heritage", "food"],
    "transport_modes": ["road"]
  }
}
```

`regions` must contain at least one slug (max 10). The first entry is
the primary region — persisted on the resulting itinerary doc and used
for trip-list filtering. Additional entries widen the candidate pool
for cross-region trips.

Responses:

- `201 Created` — `{ itinerary: Itinerary }`
- `400` — `{ error: "invalid_input", ... }`
- `422` — `{ error: "constraint_violation", reason, message, suggestion }`
- `500` — `{ error: "internal_error" | "persistence_failed", message }`

### `GET /api/itinerary/:id`

Returns `{ itinerary, map }` or `404`. `map` is the
`ItineraryMapData` DTO consumed by the itinerary page's Google Map —
stop/stay/attraction markers plus pre-decoded travel-leg polylines
where route geometry has been cached.

### `POST /api/auth/session`

Exchanges a freshly-minted Firebase ID token for an HTTP-only session
cookie (`wb_session`, 14-day max age). The client signs in with Google
via the Firebase Web SDK, then POSTs `{ idToken }`. Tokens older than
five minutes are rejected to mitigate replay.

### `DELETE /api/auth/session`

Clears the session cookie. The client also calls `firebase/auth`
`signOut()` so the SDK forgets the user too.

---

## Authentication

- **Provider**: Google, via Firebase Authentication.
- **Client**: `lib/auth/AuthProvider.tsx` exposes `useAuth()` with
  `user`, `signInWithGoogle()`, `signOut()`, and `getIdToken()`.
- **Server**: `lib/auth/session.ts` `getCurrentUser()` reads the
  `wb_session` cookie and verifies it with `firebase-admin`. Use it
  from server components, route handlers, and server actions.
- **Itineraries**: `POST /api/itinerary/generate` resolves the user
  from the session cookie first, falling back to a
  `Authorization: Bearer <idToken>` header. The verified `uid` is
  always written to `Itinerary.user_id` — any client-supplied
  `user_id` in the request body is ignored.
- **Past trips**: `/trips` is server-rendered for the signed-in user
  and uses the existing composite index on `(user_id, created_at)`.

To enable Google sign-in:

1. **Firebase Console** → Authentication → Sign-in method → enable
   **Google**.
2. Add your local + Vercel domains under
   Authentication → Settings → **Authorized domains**.
3. Make sure the Firebase web config (`NEXT_PUBLIC_FIREBASE_*`) and
   the admin service account (`FIREBASE_SERVICE_ACCOUNT_JSON` or
   `…_PATH`) are set — both halves are required because the cookie
   is minted on the server. On Vercel, prefer the base64-encoded
   service-account JSON in `FIREBASE_SERVICE_ACCOUNT_JSON`.

---

## Testing

The project uses **Node's built-in test runner** (no Jest, no Vitest) — every
`*.test.ts` file under `src/` is discovered automatically.

```bash
npm test               # run all tests once
npm run test:watch     # re-run on file changes
npm run test:coverage  # write coverage/lcov.info + print a per-file summary
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run ci             # lint + typecheck + test (the CI gate, locally)
```

Tests are pure: they construct in-memory `GraphNode` / `GraphEdge` fixtures and
inject fakes for any I/O (Firestore, Google Routes). **Do not hit Firebase or
Google APIs from a test** — every entry point that touches the network accepts
a dependency-injection seam (`fetchTravelTime`, `persistEdges`,
`saveItinerary`, …) precisely so tests stay hermetic.

What's covered:

| Module                                                   | Test file                                            |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `lib/api/validation.ts`                                  | `validation.test.ts`                                 |
| `lib/itinerary/engine.ts`                                | `engine.test.ts`                                     |
| `lib/itinerary/constraints.ts`                           | `constraints.test.ts`                                |
| `lib/itinerary/scoring.ts`                               | `scoring.test.ts`                                    |
| `lib/itinerary/graph.ts`                                 | `graph.test.ts`                                      |
| `lib/itinerary/travelMatrix.ts`                          | `travelMatrix.test.ts` + `buildTravelMatrix.test.ts` |
| `lib/services/distanceService.ts`                        | `distanceService.test.ts` (mocks `globalThis.fetch`) |
| `lib/utils/concurrency.ts`                               | `concurrency.test.ts`                                |
| `lib/config/{transportMode,travelStyle,engineTuning}.ts` | one `*.test.ts` per file                             |
| `lib/repositories/itineraryRepository.ts`                | `itineraryRepository.test.ts`                        |
| `app/api/itinerary/generate/route.ts`                    | `route.test.ts`                                      |

Adding a new module? Drop a `<module>.test.ts` next to it and the runner will
pick it up.

---

## Continuous integration

`.github/workflows/ci.yml` runs on every push and PR against `main`:

1. `npm ci` (Node 20.x **and** 22.x — the matrix protects against
   version-drift on Vercel).
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run test:coverage` (Node 22 only — uploads `coverage/lcov.info` as a
   workflow artifact).
6. `npm run build` (with stub env vars — production env vars live in Vercel).

`.github/dependabot.yml` opens grouped weekly PRs for `npm` deps and monthly
PRs for GitHub Actions versions, so the CI itself stays patched.

---

## Deploying to Vercel

1. Push to GitHub and import the repo in Vercel — the included `vercel.json`
   pins the framework and the `/api/itinerary/generate` route to a 1 GB
   Node.js function with a 60 s timeout.
2. Set every env var from `.env.example` in the Vercel project settings
   (Production **and** Preview):
   - `NEXT_PUBLIC_FIREBASE_*` — browser-safe Firebase web config.
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — paste the base64-encoded
     service-account JSON here (do **not** use
     `FIREBASE_SERVICE_ACCOUNT_PATH` on Vercel; it points at a local
     file that doesn't exist in the build container).
   - `FIREBASE_PROJECT_ID` — usually the same as
     `NEXT_PUBLIC_FIREBASE_PROJECT_ID`.

- `GOOGLE_MAPS_API_KEY` — server-only, restricted to Routes + Places APIs.
- `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` — shipped to the browser for
  the Maps JavaScript API on the itinerary page. Use a **separate** key
  from the server one and lock it down in Google Cloud Console with HTTP
  referrer restrictions (your prod + preview + localhost domains) and an
  API restriction to the Maps JavaScript API only. Without this, anyone
  can scrape the key out of the bundle and exhaust your quota.
- `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` — optional but recommended once you move
  to Advanced Markers. The app falls back to Google’s `DEMO_MAP_ID` for
  local/dev, but production should use a project-owned map ID.

3. Pull env vars locally with the Vercel CLI when you need parity:

   ```bash
   npm i -g vercel
   vercel link             # one-time
   vercel env pull .env.local
   ```

4. Deploy. Every push to `main` ships to Production; every PR gets a Preview
   URL. The CI workflow above is the gate — Vercel will still build, but a
   red CI on the PR is your signal not to merge.

---

## Future-proofing hooks

- `transport_mode` on edges supports `"road" | "train" | "flight"`; add a
  new value to `TRANSPORT_MODES` and the engine will pick it up.
- `hotel` and `transport_hub` already exist as `NodeType`s — seed them and
  wire them into `ItineraryDay.activities` / cost estimation.
- `EdgeMetadata.base_price` is already a dynamic-pricing hook.
- `nodeRepository.findNodes({ tags: [...] })` uses `array-contains-any` so
  cross-region queries by preference tag are a free add-on.
