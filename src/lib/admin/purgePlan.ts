export type CliArgs = Record<string, string | boolean>;

type RegionFilterMode = "scalar" | "array";

export type PurgeCollectionName =
  | "nodes"
  | "edges"
  | "accommodations"
  | "itineraries"
  | "attraction_hours"
  | "attraction_admissions"
  | "hotel_search_snapshots"
  | "hotel_offer_snapshots"
  | "provider_call_logs"
  | "data_quality_issues"
  | "users";

export interface PurgeCollectionSpec {
  name: PurgeCollectionName;
  optional?: boolean;
  regionFilter?: {
    field: string;
    mode: RegionFilterMode;
  };
}

export interface PurgeOptions {
  dryRun: boolean;
  confirmed: boolean;
  allRegions: boolean;
  includeUsers: boolean;
  includeItineraries: boolean;
  includeDataQualityIssues: boolean;
  regionSlugs: string[];
  confirmProject: string | null;
}

export interface RegionQueryFilter {
  field: string;
  op: "==" | "in" | "array-contains" | "array-contains-any";
  value: string | string[];
}

const BASE_COLLECTIONS: PurgeCollectionSpec[] = [
  {
    name: "nodes",
    regionFilter: { field: "region", mode: "scalar" },
  },
  {
    name: "edges",
    regionFilter: { field: "regions", mode: "array" },
  },
  {
    name: "accommodations",
    regionFilter: { field: "regionId", mode: "scalar" },
  },
  {
    name: "attraction_hours",
    optional: true,
    regionFilter: { field: "region", mode: "scalar" },
  },
  {
    name: "attraction_admissions",
    optional: true,
    regionFilter: { field: "region", mode: "scalar" },
  },
  {
    name: "hotel_search_snapshots",
    optional: true,
    regionFilter: { field: "region", mode: "scalar" },
  },
  {
    name: "hotel_offer_snapshots",
    optional: true,
    regionFilter: { field: "region", mode: "scalar" },
  },
  {
    name: "provider_call_logs",
    optional: true,
    regionFilter: { field: "region", mode: "scalar" },
  },
];

const ITINERARY_COLLECTION: PurgeCollectionSpec = {
  name: "itineraries",
  regionFilter: { field: "region", mode: "scalar" },
};

const DATA_QUALITY_ISSUES_COLLECTION: PurgeCollectionSpec = {
  name: "data_quality_issues",
};

const USERS_COLLECTION: PurgeCollectionSpec = {
  name: "users",
};

const TRUTHY_STRINGS = new Set(["1", "true", "yes", "y", "on"]);
const FALSY_STRINGS = new Set(["0", "false", "no", "n", "off"]);

/**
 * Old flag names that are intentionally rejected to avoid silent behavior
 * changes. The map value is the supported replacement spelling.
 */
const REMOVED_FLAGS: Record<string, string> = {
  "keep-itineraries": "--include-itineraries",
  "keep-users": "--include-users",
  region: "--regions",
};

export function parseBooleanArg(
  rawValue: string | boolean | undefined,
  defaultValue: boolean,
): boolean {
  if (rawValue === undefined) return defaultValue;
  if (typeof rawValue === "boolean") return rawValue;

  const normalized = rawValue.trim().toLowerCase();
  if (TRUTHY_STRINGS.has(normalized)) return true;
  if (FALSY_STRINGS.has(normalized)) return false;

  throw new Error(
    `Invalid boolean value "${rawValue}". Use true/false (or 1/0).`,
  );
}

export function parseRegionSlugs(args: CliArgs): string[] {
  const fromRegions = parseRegionFlagValue(args.regions, "regions");

  if (fromRegions.length > 10) {
    throw new Error(
      "Firestore supports up to 10 values for --regions filters. Pass 10 or fewer region slugs.",
    );
  }
  return fromRegions;
}

function parseRegionFlagValue(
  rawValue: string | boolean | undefined,
  flagName: "regions",
): string[] {
  if (rawValue === undefined) return [];
  if (rawValue === true) {
    throw new Error(`--${flagName} requires a comma-separated value.`);
  }
  if (typeof rawValue !== "string") return [];

  const values = rawValue
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error(`--${flagName} requires at least one region slug.`);
  }

  return Array.from(new Set(values));
}

export function rejectRemovedFlags(args: CliArgs): void {
  for (const [flag, replacement] of Object.entries(REMOVED_FLAGS)) {
    if (args[flag] !== undefined) {
      throw new Error(
        `Flag --${flag} has been removed. Use ${replacement} instead.`,
      );
    }
  }
}

export function resolvePurgeOptions(args: CliArgs): PurgeOptions {
  rejectRemovedFlags(args);

  const dryRun = parseBooleanArg(args["dry-run"], false);
  const confirmed = parseBooleanArg(args.yes, false);
  const allRegions = parseBooleanArg(args["all-regions"], false);
  const includeUsers = parseBooleanArg(args["include-users"], false);
  const includeItineraries = parseBooleanArg(
    args["include-itineraries"],
    false,
  );
  const includeDataQualityIssues = parseBooleanArg(
    args["include-data-quality-issues"],
    false,
  );

  const confirmProject = readStringArg(args["confirm-project"]);
  const regionSlugs = parseRegionSlugs(args);

  if (dryRun && confirmed) {
    throw new Error(
      "--dry-run and --yes cannot be combined. Pick one — dry-run is the safe preview, --yes is the destructive run.",
    );
  }

  if (regionSlugs.length > 0 && allRegions) {
    throw new Error(
      "--regions and --all-regions cannot be combined. Pick exactly one scope.",
    );
  }

  if (confirmed) {
    if (regionSlugs.length === 0 && !allRegions) {
      throw new Error(
        "Destructive run requires explicit scope. Pass either --regions=<slug,...> or --all-regions.",
      );
    }

    if (!confirmProject) {
      throw new Error(
        "Destructive run requires --confirm-project=<projectId> matching the resolved Firebase project. " +
          "This protects against running against the wrong project.",
      );
    }
  }

  return {
    dryRun,
    confirmed,
    allRegions,
    includeUsers,
    includeItineraries,
    includeDataQualityIssues,
    regionSlugs,
    confirmProject,
  };
}

function readStringArg(rawValue: string | boolean | undefined): string | null {
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface ProjectConfirmationCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Verifies that the operator-typed --confirm-project value matches the
 * Firebase project the script is actually attached to. Pure function so it
 * can be unit-tested without Firestore.
 */
export function verifyProjectConfirmation(
  options: Pick<PurgeOptions, "confirmed" | "confirmProject">,
  resolvedProjectId: string | null | undefined,
): ProjectConfirmationCheck {
  if (!options.confirmed) return { ok: true };

  if (!resolvedProjectId) {
    return {
      ok: false,
      reason:
        "Could not resolve the Firebase project id. Set FIREBASE_PROJECT_ID (or NEXT_PUBLIC_FIREBASE_PROJECT_ID) before passing --yes.",
    };
  }

  if (!options.confirmProject) {
    return {
      ok: false,
      reason:
        "Destructive run requires --confirm-project=<projectId>. Re-run with --confirm-project=" +
        resolvedProjectId,
    };
  }

  if (options.confirmProject !== resolvedProjectId) {
    return {
      ok: false,
      reason:
        `--confirm-project="${options.confirmProject}" does not match the resolved Firebase project "${resolvedProjectId}". ` +
        "Refusing to run.",
    };
  }

  return { ok: true };
}

export function buildPurgeCollections(
  options: Pick<
    PurgeOptions,
    "includeItineraries" | "includeUsers" | "includeDataQualityIssues"
  >,
): PurgeCollectionSpec[] {
  const collections: PurgeCollectionSpec[] = [...BASE_COLLECTIONS];

  if (options.includeItineraries) {
    collections.splice(3, 0, ITINERARY_COLLECTION);
  }

  if (options.includeDataQualityIssues) {
    collections.push(DATA_QUALITY_ISSUES_COLLECTION);
  }

  if (options.includeUsers) {
    collections.push(USERS_COLLECTION);
  }

  return collections;
}

export function buildRegionQueryFilter(
  collection: PurgeCollectionSpec,
  regionSlugs: string[],
): RegionQueryFilter | null {
  if (regionSlugs.length === 0) return null;
  if (!collection.regionFilter) return null;

  if (regionSlugs.length === 1) {
    return {
      field: collection.regionFilter.field,
      op:
        collection.regionFilter.mode === "array" ? "array-contains" : "==",
      value: regionSlugs[0],
    };
  }

  return {
    field: collection.regionFilter.field,
    op:
      collection.regionFilter.mode === "array" ? "array-contains-any" : "in",
    value: regionSlugs,
  };
}

export function supportsRegionScope(collection: PurgeCollectionSpec): boolean {
  return Boolean(collection.regionFilter);
}

export function describePreservedData(
  options: Pick<
    PurgeOptions,
    "includeUsers" | "includeItineraries" | "includeDataQualityIssues"
  >,
): string[] {
  const preserved: string[] = [];

  if (!options.includeUsers) {
    preserved.push("users (admin role assignments stay intact)");
  }
  if (!options.includeItineraries) {
    preserved.push(
      "itineraries (saved trips — may reference deleted nodes if the graph is purged)",
    );
  }
  if (!options.includeDataQualityIssues) {
    preserved.push(
      "data_quality_issues (admin investigation state stays intact; re-run scanner after reseed)",
    );
  }

  return preserved;
}
