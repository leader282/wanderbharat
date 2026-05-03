import Link from "next/link";

import {
  DATA_QUALITY_ENTITY_TYPES,
  DATA_QUALITY_ISSUE_SEVERITIES,
  DATA_QUALITY_ISSUE_STATUSES,
  type DataQualityIssue,
  type DataQualityIssueSeverity,
} from "@/types/domain";
import { listOpenIssues } from "@/lib/repositories/dataQualityRepository";
import {
  ignoreIssueAction,
  resolveIssueAction,
  runDataQualityScanAction,
} from "@/app/admin/data-quality/actions";

type SearchParamValue = string | string[] | undefined;
type PageSearchParams = Record<string, SearchParamValue>;

interface AdminDataQualityPageProps {
  searchParams?: Promise<PageSearchParams> | PageSearchParams;
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function AdminDataQualityPage({
  searchParams,
}: AdminDataQualityPageProps) {
  const params = await resolveSearchParams(searchParams);
  const status = parseEnumParam(params.status, DATA_QUALITY_ISSUE_STATUSES) ?? "open";
  const severity = parseEnumParam(params.severity, DATA_QUALITY_ISSUE_SEVERITIES);
  const entityType = parseEnumParam(params.entity_type, DATA_QUALITY_ENTITY_TYPES);

  const [openIssues, filteredIssues] = await Promise.all([
    listOpenIssues({ status: "open", limit: 2_000 }),
    listOpenIssues({
      status,
      severity,
      entity_type: entityType,
      limit: 800,
    }),
  ]);

  const severityCounts = countIssuesBySeverity(openIssues);

  return (
    <section className="space-y-5">
      <div className="card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
              Data quality control tower
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
              Issue dashboard
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-[var(--color-ink-600)]">
              Run deterministic integrity checks against Firestore snapshots and
              track unresolved quality gaps before they impact itinerary output.
            </p>
          </div>
          <form action={runDataQualityScanAction}>
            <button type="submit" className="btn-primary">
              Run scan
            </button>
          </form>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        {DATA_QUALITY_ISSUE_SEVERITIES.map((entry) => (
          <li
            key={entry}
            className="card border border-[var(--hairline)] px-5 py-4"
          >
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-500)]">
              {entry}
            </p>
            <p className="mt-2 text-3xl font-semibold text-[var(--color-ink-900)]">
              {severityCounts[entry]}
            </p>
            <p className="mt-1 text-xs text-[var(--color-ink-500)]">
              Open issues
            </p>
          </li>
        ))}
      </ul>

      <div className="card p-5">
        <form method="get" className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Status
            <select
              name="status"
              defaultValue={status}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            >
              {DATA_QUALITY_ISSUE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Severity
            <select
              name="severity"
              defaultValue={severity ?? ""}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            >
              <option value="">All</option>
              {DATA_QUALITY_ISSUE_SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Entity
            <select
              name="entity_type"
              defaultValue={entityType ?? ""}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            >
              <option value="">All</option>
              {DATA_QUALITY_ENTITY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end gap-2">
            <button type="submit" className="btn-secondary">
              Apply filters
            </button>
            <Link
              href="/admin/data-quality"
              className="rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm font-medium text-[var(--color-ink-700)] hover:bg-[var(--color-sand-50)]"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      <section className="card overflow-hidden">
        <header className="border-b border-[var(--hairline)] px-5 py-4 sm:px-6">
          <h3 className="text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
            Issues ({filteredIssues.length})
          </h3>
          <p className="mt-1 text-sm text-[var(--color-ink-600)]">
            Showing {status} issues
            {severity ? ` with ${severity} severity` : ""}{" "}
            {entityType ? `for ${entityType}` : ""}.
          </p>
        </header>

        {filteredIssues.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[var(--color-ink-600)] sm:px-6">
            No issues found for the selected filters.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {filteredIssues.map((issue) => (
              <li key={issue.id} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-wide ${severityBadgeClass(issue.severity)}`}
                  >
                    {issue.severity}
                  </span>
                  <code className="rounded bg-[var(--color-sand-50)] px-2 py-0.5 text-xs text-[var(--color-ink-700)]">
                    {issue.code}
                  </code>
                  <span className="text-xs text-[var(--color-ink-500)]">
                    {issue.entity_type}
                    {issue.entity_id ? ` / ${issue.entity_id}` : ""}
                  </span>
                </div>

                <p className="mt-3 text-sm font-medium text-[var(--color-ink-900)]">
                  {issue.message}
                </p>

                <p className="mt-2 text-xs text-[var(--color-ink-500)]">
                  Created {formatTimestamp(issue.created_at)}
                  {issue.status !== "open" && issue.resolved_at
                    ? ` • ${issue.status} ${formatTimestamp(issue.resolved_at)}`
                    : ""}
                  {issue.resolved_by ? ` by ${issue.resolved_by}` : ""}
                </p>

                {issue.details ? (
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--color-sand-50)] p-3 text-xs text-[var(--color-ink-700)]">
                    {JSON.stringify(issue.details, null, 2)}
                  </pre>
                ) : null}

                {issue.status === "open" ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <form action={resolveIssueAction}>
                      <input type="hidden" name="issue_id" value={issue.id} />
                      <button type="submit" className="btn-secondary">
                        Mark resolved
                      </button>
                    </form>
                    <form action={ignoreIssueAction}>
                      <input type="hidden" name="issue_id" value={issue.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm font-medium text-[var(--color-ink-700)] hover:bg-[var(--color-sand-50)]"
                      >
                        Ignore
                      </button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

async function resolveSearchParams(
  searchParams: Promise<PageSearchParams> | PageSearchParams | undefined,
): Promise<PageSearchParams> {
  if (!searchParams) return {};
  return await Promise.resolve(searchParams);
}

function parseEnumParam<T extends string>(
  value: SearchParamValue,
  allowed: readonly T[],
): T | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return undefined;
  return (allowed as readonly string[]).includes(candidate)
    ? (candidate as T)
    : undefined;
}

function countIssuesBySeverity(
  issues: DataQualityIssue[],
): Record<DataQualityIssueSeverity, number> {
  const out: Record<DataQualityIssueSeverity, number> = {
    info: 0,
    warning: 0,
    critical: 0,
  };

  for (const issue of issues) {
    out[issue.severity] += 1;
  }
  return out;
}

function severityBadgeClass(severity: DataQualityIssueSeverity): string {
  if (severity === "critical") {
    return "bg-red-100 text-red-700";
  }
  if (severity === "warning") {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-blue-100 text-blue-700";
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "-";
  return TIMESTAMP_FORMATTER.format(new Date(timestamp));
}
