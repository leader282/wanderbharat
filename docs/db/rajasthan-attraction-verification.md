# Rajasthan Attraction Verification Workflow

This playbook keeps Rajasthan prototype v2 data honest: unknown stays unknown,
estimated stays estimated, and only genuinely checked values become verified.

## Preconditions

- Run the reseed flow in `docs/db/prototype-v2-purge-and-reseed.md`.
- Confirm you can access `/admin` with an admin account.
- Start with a data quality scan so you have a clear backlog:

```bash
npx tsx scripts/runDataQualityScan.ts --resolved-by="ops:rajasthan-backlog"
```

## 1) Fix Attraction Identity Metadata

Go to `/admin/attractions?region=rajasthan`.

For each attraction:

- Ensure it is linked to the correct city (`parent_node_id`).
- Add `google_place_id` when you have a reliable match.
- Keep tags, `recommended_hours`, and descriptions concise and useful for planning.
- Keep retired/irrelevant records as `disabled` instead of deleting them blindly.

## 2) Fill Opening Hours

Go to `/admin/attraction-hours?region=rajasthan`.

- If `google_place_id` exists, use **Hydrate from Google Places** first.
- If provider data is missing or ambiguous, save a manual schedule with
  `source_type=manual` and `confidence=estimated`.
- If no trustworthy schedule exists, use **Mark unknown**.
- Never save an unknown schedule as `verified`.

## 3) Fill Admission Costs

Go to `/admin/attraction-costs?region=rajasthan`.

- Create at least one rule per attraction (usually `adult + any`).
- Keep unknown prices as `amount=null` with `confidence=unknown`.
- Use `confidence=estimated` for rough but useful planning values.
- Use `confidence=verified` only when you have a trustworthy source and save
  `source_url` (or documented internal evidence in notes).
- Do not use `0` unless the attraction is actually confirmed free.

## 4) Close The Loop

After a verification batch:

```bash
npx tsx scripts/runDataQualityScan.ts --resolved-by="ops:rajasthan-backlog"
```

Track progress by watching issue counts in `/admin/data-quality`:

- `missing_google_place_id`
- `missing_opening_hours`
- `missing_admission_cost`

The target is not "zero unknowns at all costs". The target is a reliable
planner where unresolved facts remain explicit and auditable.

## 5) What The Scan Does Not Track

The scanner only flags *missing or unknown-confidence* records. It does not
fire on records that are already present with `confidence=estimated`, which is
the default state of nearly every seeded Rajasthan attraction (hours and
admissions).

Practical consequences:

- Upgrading an attraction from `estimated` to `verified` will not shrink any
  scan counter. The backlog you see in `/admin/data-quality` is essentially
  `missing_google_place_id` (until the Places IDs are filled in) plus the
  handful of deliberately unknown lake/temple records.
- Do not assume "scan shows 0 warnings" means all data is verified. It means
  no data is *missing or unknown*.
- Verification progress on estimated records should be tracked via the
  `confidence` filter in `/admin/attraction-hours` and
  `/admin/attraction-costs`, not via scan counters.

When we add a `stale_estimated_attraction` or similar severity rule, this
section should be revisited.
