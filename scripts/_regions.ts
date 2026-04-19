import { listAvailableRegions } from "./data";

/**
 * Resolve which regions a seed/purge script should iterate over, given the
 * parsed CLI args. Precedence (first match wins):
 *
 *   1. `--all`              → every dataset under `scripts/data/`
 *   2. `--regions a,b,c`    → exact list (comma-separated)
 *   3. `--region <slug>`    → single slug (or comma list, for convenience)
 *
 * If none of the three flags are present the script errors out with a
 * usage-style message — there is no implicit default region. Slugs are
 * de-duplicated and validated against the on-disk dataset list so typos
 * fail fast instead of silently no-oping.
 */
export function resolveRegions(
  args: Record<string, string | boolean>,
): string[] {
  const available = listAvailableRegions();

  if (args.all === true || args.all === "true") {
    if (available.length === 0) {
      throw new Error(
        "No datasets found under scripts/data/. Add a <slug>.ts file with a default-exported SeedDataset.",
      );
    }
    return available;
  }

  const raw =
    typeof args.regions === "string"
      ? args.regions
      : typeof args.region === "string"
        ? args.region
        : undefined;

  if (!raw) {
    throw new Error(
      `No regions selected. Pass one of:\n` +
        `  --all                       seed every dataset on disk\n` +
        `  --regions <a,b,c>           seed an explicit list\n` +
        `  --region <slug>             seed a single region\n` +
        `Available regions: ${available.join(", ") || "(none)"}.`,
    );
  }

  const requested = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    throw new Error(
      "Empty region list. Pass at least one slug, e.g. --region rajasthan.",
    );
  }

  const unique = Array.from(new Set(requested));
  const unknown = unique.filter((slug) => !available.includes(slug));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown region slug(s): ${unknown.join(", ")}. Available: ${available.join(", ") || "(none)"}.`,
    );
  }
  return unique;
}
