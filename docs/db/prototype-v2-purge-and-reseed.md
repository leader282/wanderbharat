# Prototype v2: Safe Purge and Reseed

This runbook resets prototype data for schema v2 without accidentally deleting user/admin configuration or pointing at the wrong project.

## Safety Defaults

- `scripts/purge.ts` preserves `users`, `itineraries`, and `data_quality_issues` by default.
- Admin role assignments live in `users`, so they stay intact unless `--include-users` is passed explicitly.
- Optional v2 collections (`attraction_hours`, `attraction_admissions`, `hotel_search_snapshots`, `hotel_offer_snapshots`, `provider_call_logs`) are skipped when absent.
- The `regions` collection is never touched by the purge script — admin-managed region defaults survive untouched.
- Destructive runs require all of:
  1. `--yes`
  2. an explicit scope (`--regions=<slug,...>` OR `--all-regions`)
  3. `--confirm-project=<projectId>` matching the resolved Firebase project
- `--dry-run` and `--yes` cannot be combined. Pick exactly one.
- The pre-purge summary always prints the resolved `project` and `database` ids — verify them before passing `--yes`.

### Removed flags (will hard-error)

| Removed flag         | Replacement                  |
| -------------------- | ---------------------------- |
| `--keep-itineraries` | `--include-itineraries`      |
| `--keep-users`       | `--include-users`            |
| `--region`           | `--regions`                  |

### Behavior changes versus prototype v1

- `data_quality_issues` is no longer wiped automatically. Pass `--include-data-quality-issues` to opt in.
- `regions` is no longer wiped — region metadata (timezone, default currency) survives every purge.
- Region-scoped purges now also report:
  - cross-region edges that span the purged region plus another, and will be removed,
  - itineraries that reference soon-to-be-deleted nodes (sampled, capped at 2000 docs scanned).

## 1) Backup / Export Before Purge

Set your project and backup destination, then export Firestore:

```bash
export FIREBASE_PROJECT_ID="<your-project-id>"
export BACKUP_BUCKET="gs://<your-backup-bucket>"
gcloud firestore export "${BACKUP_BUCKET}/wanderbharat-prototype-v2-$(date +%Y%m%d-%H%M%S)" --project "${FIREBASE_PROJECT_ID}"
```

Verify the export operation completed (`gcloud firestore operations list --project "${FIREBASE_PROJECT_ID}"`) before continuing. If `gcloud` is unavailable locally, run an equivalent export from the Firebase/GCP console first.

## 2) Dry-Run (No Deletes)

Dry-run is fully read-only. It executes `count()` aggregates and a bounded scan for cross-region risk, but never writes. On large collections, it can incur significant **read** cost — prefer running scoped previews on prod-sized data.

Preview everything across all regions:

```bash
npx tsx scripts/purge.ts --dry-run
```

Preview only Rajasthan-scoped records:

```bash
npx tsx scripts/purge.ts --regions=rajasthan --dry-run
```

Preview Rajasthan with itineraries and data quality issues included:

```bash
npx tsx scripts/purge.ts --regions=rajasthan --include-itineraries --include-data-quality-issues --dry-run
```

Inspect the printed summary carefully:

- `project="..."` and `database="..."` — confirm both before progressing.
- `estimated total docs affected` — sanity-check the magnitude.
- `preserved by default` — confirm the right collections are being kept.
- `cross-region risk` — if listed, decide whether to expand the scope.

## 3) Purge

Destructive runs require `--yes`, an explicit scope, and `--confirm-project=<projectId>` matching the project printed in the summary.

Purge Rajasthan prototype data while preserving users, itineraries, and data quality issues:

```bash
npx tsx scripts/purge.ts --regions=rajasthan --yes --confirm-project=<projectId>
```

Purge Rajasthan and clean up its itineraries too (recommended when changing the node/edge graph):

```bash
npx tsx scripts/purge.ts \
  --regions=rajasthan \
  --include-itineraries \
  --yes \
  --confirm-project=<projectId>
```

Full wipe across every region — only intentionally:

```bash
npx tsx scripts/purge.ts \
  --all-regions \
  --include-itineraries \
  --include-data-quality-issues \
  --yes \
  --confirm-project=<projectId>
```

Include users (also deletes admin role assignments — be very careful):

```bash
npx tsx scripts/purge.ts \
  --all-regions \
  --include-itineraries \
  --include-data-quality-issues \
  --include-users \
  --yes \
  --confirm-project=<projectId>
```

Notes on partial failures:

- Each collection is deleted in 400-doc batches. If a batch fails (network, quota), the script exits with a non-zero status. Re-running the same command is safe — it picks up the remaining docs.
- Cross-region edges (e.g. `regions: ["rajasthan", "delhi"]`) are deleted by a region-scoped Rajasthan purge even though the Delhi endpoint survives. This is reported in the summary's "cross-region risk" section.
- Cross-region itineraries (primary `region` differs from the purged region but `nodes` overlap) are reported, but only deleted if `--include-itineraries` is also passed AND the itinerary's primary region matches the scope. If they're flagged, prefer expanding the scope or include itineraries explicitly.

## 4) Seed Rajasthan Only

Run seed scripts in deterministic order:

```bash
npx tsx scripts/seedNodes.ts --region rajasthan
npx tsx scripts/seedAttractions.ts --region rajasthan
npx tsx scripts/seedAttractionHours.ts --region rajasthan
npx tsx scripts/seedAttractionAdmissions.ts --region rajasthan
npx tsx scripts/seedEdges.ts --region rajasthan
npx tsx scripts/seedAccommodations.ts --region rajasthan
```

Rajasthan now seeds curated attraction records directly from `scripts/data/rajasthan.ts`, so the baseline reseed does not require live Google calls. `seedEdges --use-google` remains optional for route refreshes.

## 5) Run Data Quality Scan

The wrapper script keeps the data quality scanner reachable from the CLI without ESM-vs-CJS surprises:

```bash
npx tsx scripts/runDataQualityScan.ts
```

Pass an explicit operator id when running from automation:

```bash
npx tsx scripts/runDataQualityScan.ts --resolved-by="ops:prototype-v2-reseed"
```

The scan auto-resolves any orphan `data_quality_issues` left behind by the purge.

## 6) Validate Build Health

```bash
npm run typecheck
npm test
```

## 7) Continue Manual Attraction Verification

Use the admin verification playbook after reseed to fill remaining unknowns:

- [Rajasthan attraction verification workflow](./rajasthan-attraction-verification.md)
