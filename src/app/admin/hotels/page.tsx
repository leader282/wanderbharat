import Link from "next/link";

import { DATA_QUALITY_ISSUE_STATUSES, type DataQualityIssue } from "@/types/domain";
import { retestHotelRateSnapshotAction } from "@/app/admin/hotels/actions";
import type {
  HotelOfferSnapshot,
  HotelSearchSnapshot,
  ProviderCallLog,
  ProviderCallStatus,
} from "@/lib/providers/hotels/types";
import { listOpenIssues } from "@/lib/repositories/dataQualityRepository";
import { listHotelOfferSnapshots } from "@/lib/repositories/hotelOfferSnapshotRepository";
import { listHotelSearchSnapshots } from "@/lib/repositories/hotelSearchSnapshotRepository";
import { getNodes } from "@/lib/repositories/nodeRepository";
import { listProviderCallLogs } from "@/lib/repositories/providerCallLogRepository";

type SearchParamValue = string | string[] | undefined;
type PageSearchParams = Record<string, SearchParamValue>;

interface AdminHotelsPageProps {
  searchParams?: Promise<PageSearchParams> | PageSearchParams;
}

interface SnapshotFilters {
  cityKey?: string;
  provider?: string;
  status?: string;
  fromMs?: number;
  toMs?: number;
}

interface RateSnapshotRow {
  snapshot: HotelOfferSnapshot;
  city_label: string;
  city_key: string;
  provider_status: ProviderCallStatus | "unknown";
  related_log_ids: string[];
  cheapest_total: number | null;
  median_total: number | null;
  top_total: number | null;
}

interface SearchSnapshotRow {
  snapshot: HotelSearchSnapshot;
  city_label: string;
  city_key: string;
  provider_status: ProviderCallStatus | "unknown";
  related_log_ids: string[];
}

interface ProviderLogRow {
  log: ProviderCallLog;
  city_label: string;
  city_key: string;
}

interface NoHotelRatesCityIssueRow {
  city_label: string;
  city_key: string;
  issue_count: number;
  open_count: number;
  ignored_count: number;
  resolved_count: number;
  latest_created_at: number;
  latest_message: string;
  latest_status: DataQualityIssue["status"];
}

const DEFAULT_SNAPSHOT_LIMIT = 200;
const RELATED_LOG_WINDOW_MS = 12 * 60 * 60 * 1000;
const NO_HOTEL_RATES_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_LOG_ROWS = 80;

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function AdminHotelsPage({
  searchParams,
}: AdminHotelsPageProps) {
  const params = await resolveSearchParams(searchParams);
  const actionStatus = parseActionStatus(params.action_status);
  const actionMessage = parseStringParam(params.action_message);
  const selectedCityKey = parseStringParam(params.city);
  const selectedProvider = parseStringParam(params.provider);
  const selectedStatus = parseStringParam(params.status);
  const fromDateRaw = parseStringParam(params.from_date);
  const toDateRaw = parseStringParam(params.to_date);
  const fromMs = parseDateAtUtcMidnight(fromDateRaw);
  const toMsStart = parseDateAtUtcMidnight(toDateRaw);
  const toMs = toMsStart === undefined ? undefined : toMsStart + MS_PER_DAY - 1;

  const [offerSnapshots, searchSnapshots, providerLogs, issuesByStatus] =
    await Promise.all([
      listHotelOfferSnapshots({ limit: DEFAULT_SNAPSHOT_LIMIT }),
      listHotelSearchSnapshots({ limit: DEFAULT_SNAPSHOT_LIMIT }),
      listProviderCallLogs({ limit: DEFAULT_SNAPSHOT_LIMIT }),
      Promise.all(
        DATA_QUALITY_ISSUE_STATUSES.map((status) =>
          listOpenIssues({ status, limit: 700 }),
        ),
      ),
    ]);

  const noHotelRatesIssues = issuesByStatus
    .flat()
    .filter((issue) => issue.code === "no_hotel_rates");

  const nodeIds = new Set<string>();
  for (const snapshot of offerSnapshots) {
    nodeIds.add(snapshot.node_id);
  }
  for (const snapshot of searchSnapshots) {
    nodeIds.add(snapshot.node_id);
  }
  for (const issue of noHotelRatesIssues) {
    if (issue.entity_id) {
      nodeIds.add(issue.entity_id);
    }
  }

  const nodes = nodeIds.size > 0 ? await getNodes(Array.from(nodeIds)) : [];
  const nodeNameById = new Map(nodes.map((node) => [node.id, node.name]));

  const searchSnapshotsByNodeKey = groupSearchSnapshotsByNode(searchSnapshots);
  const providerLogsByNodeKey = groupProviderLogsByNode(providerLogs);

  const rateRows = offerSnapshots.map((snapshot) =>
    buildRateSnapshotRow({
      snapshot,
      nodeNameById,
      searchSnapshotsByNodeKey,
      providerLogsByNodeKey,
    }),
  );
  const searchRows = searchSnapshots.map((snapshot) =>
    buildSearchSnapshotRow({
      snapshot,
      nodeNameById,
      providerLogsByNodeKey,
    }),
  );
  const providerLogRows = providerLogs.map((log) =>
    buildProviderLogRow({
      log,
      nodeNameById,
      searchSnapshotsByNodeKey,
    }),
  );
  const cityKeyByNodeId = new Map<string, string>();
  for (const row of [...rateRows, ...searchRows]) {
    cityKeyByNodeId.set(row.snapshot.node_id, row.city_key);
  }

  const latestNoHotelRatesIssueAt = noHotelRatesIssues.reduce(
    (maxTimestamp, issue) => Math.max(maxTimestamp, issue.created_at),
    0,
  );
  const recentIssueCutoffMs =
    latestNoHotelRatesIssueAt > 0
      ? latestNoHotelRatesIssueAt - NO_HOTEL_RATES_WINDOW_MS
      : 0;
  const recentNoHotelRatesIssues = noHotelRatesIssues.filter(
    (issue) => issue.created_at >= recentIssueCutoffMs,
  );
  const noHotelRatesCityRows = aggregateNoHotelRatesCityRows(
    recentNoHotelRatesIssues,
    nodeNameById,
    cityKeyByNodeId,
  );

  const filters: SnapshotFilters = {
    cityKey: selectedCityKey,
    provider: selectedProvider,
    status: selectedStatus,
    fromMs,
    toMs,
  };

  const filteredRateRows = rateRows.filter((row) =>
    matchesSnapshotFilters({
      filters,
      cityKey: row.city_key,
      provider: row.snapshot.provider,
      status: row.provider_status,
      fetchedAt: row.snapshot.fetched_at,
    }),
  );
  const filteredSearchRows = searchRows.filter((row) =>
    matchesSnapshotFilters({
      filters,
      cityKey: row.city_key,
      provider: row.snapshot.provider,
      status: row.provider_status,
      fetchedAt: row.snapshot.fetched_at,
    }),
  );
  const filteredProviderLogRows = providerLogRows
    .filter((row) =>
      matchesSnapshotFilters({
        filters,
        cityKey: row.city_key,
        provider: row.log.provider,
        status: row.log.status,
        fetchedAt: row.log.created_at,
      }),
    )
    .slice(0, MAX_LOG_ROWS);
  const filteredNoHotelRatesCityRows = noHotelRatesCityRows.filter((row) => {
    if (filters.cityKey && row.city_key !== filters.cityKey) {
      return false;
    }
    if (filters.fromMs !== undefined && row.latest_created_at < filters.fromMs) {
      return false;
    }
    if (filters.toMs !== undefined && row.latest_created_at > filters.toMs) {
      return false;
    }
    return true;
  });

  const cityOptions = buildCityOptions([
    ...rateRows.map((row) => ({ city_key: row.city_key, city_label: row.city_label })),
    ...searchRows.map((row) => ({
      city_key: row.city_key,
      city_label: row.city_label,
    })),
    ...providerLogRows.map((row) => ({
      city_key: row.city_key,
      city_label: row.city_label,
    })),
    ...noHotelRatesCityRows.map((row) => ({
      city_key: row.city_key,
      city_label: row.city_label,
    })),
  ]);
  const providerOptions = Array.from(
    new Set([
      ...rateRows.map((row) => row.snapshot.provider),
      ...searchRows.map((row) => row.snapshot.provider),
      ...providerLogRows.map((row) => row.log.provider),
    ]),
  ).sort();
  const statusOptions = Array.from(
    new Set([
      ...rateRows.map((row) => row.provider_status),
      ...searchRows.map((row) => row.provider_status),
      ...providerLogRows.map((row) => row.log.status),
    ]),
  ).sort();

  const filteredRateStatusCounts = countByStatus(filteredRateRows);

  return (
    <section className="space-y-5">
      <div className="card p-6 sm:p-8">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
          Hotels and rate snapshots
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
          LiteAPI monitoring by city and stay block
        </h2>
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-ink-600)]">
          Diagnose hotel availability quickly: compare search/rate snapshots,
          inspect provider-call outcomes, and retry a stay block with guardrails.
          This workspace is diagnostic-only and does not implement booking.
        </p>
      </div>

      {actionStatus && actionMessage ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            actionStatus === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {actionMessage}
        </div>
      ) : null}

      <div className="card p-5">
        <form method="get" className="grid gap-3 md:grid-cols-6">
          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            City
            <select
              name="city"
              defaultValue={selectedCityKey ?? ""}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            >
              <option value="">All cities</option>
              {cityOptions.map((option) => (
                <option key={option.city_key} value={option.city_key}>
                  {option.city_label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Provider
            <select
              name="provider"
              defaultValue={selectedProvider ?? ""}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            >
              <option value="">All providers</option>
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Status
            <select
              name="status"
              defaultValue={selectedStatus ?? ""}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            >
              <option value="">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            From date
            <input
              type="date"
              name="from_date"
              defaultValue={fromDateRaw ?? ""}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            />
          </label>

          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            To date
            <input
              type="date"
              name="to_date"
              defaultValue={toDateRaw ?? ""}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            />
          </label>

          <div className="flex items-end gap-2">
            <button type="submit" className="btn-secondary">
              Apply filters
            </button>
            <Link
              href="/admin/hotels"
              className="rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm font-medium text-[var(--color-ink-700)] hover:bg-[var(--color-sand-50)]"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      <ul className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="Rate snapshots" value={filteredRateRows.length} />
        <SummaryCard label="Search snapshots" value={filteredSearchRows.length} />
        <SummaryCard
          label="Successful rate checks"
          value={filteredRateStatusCounts.success}
        />
        <SummaryCard
          label="No-rate / error checks"
          value={filteredRateStatusCounts.empty + filteredRateStatusCounts.error}
          tone="warn"
        />
      </ul>

      <section className="card overflow-hidden">
        <header className="border-b border-[var(--hairline)] px-5 py-4 sm:px-6">
          <h3 className="text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
            Rate snapshots ({filteredRateRows.length})
          </h3>
          <p className="mt-1 text-sm text-[var(--color-ink-600)]">
            Check if LiteAPI returned bookable rates for each city stay block.
          </p>
        </header>

        {filteredRateRows.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[var(--color-ink-600)] sm:px-6">
            No rate snapshots found for the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] divide-y divide-[var(--hairline)] text-sm">
              <thead className="bg-[var(--color-sand-50)] text-left text-xs uppercase tracking-wide text-[var(--color-ink-500)]">
                <tr>
                  <th className="px-4 py-3">City / stay block</th>
                  <th className="px-4 py-3">Check-in / checkout</th>
                  <th className="px-4 py-3">Currency / guest</th>
                  <th className="px-4 py-3">Offers + price spread</th>
                  <th className="px-4 py-3">Fetched / expires</th>
                  <th className="px-4 py-3">Provider status + logs</th>
                  <th className="px-4 py-3">Test again</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline)]">
                {filteredRateRows.map((row) => (
                  <tr key={row.snapshot.id} id={`rate-${row.snapshot.id}`}>
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-[var(--color-ink-900)]">
                        {row.city_label}
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                        {row.snapshot.region} • {row.snapshot.node_id}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top text-[var(--color-ink-700)]">
                      <p>{row.snapshot.checkin}</p>
                      <p className="text-xs text-[var(--color-ink-500)]">
                        to {row.snapshot.checkout} ({row.snapshot.nights} night
                        {row.snapshot.nights === 1 ? "" : "s"})
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top text-[var(--color-ink-700)]">
                      <p>{row.snapshot.currency}</p>
                      <p className="text-xs text-[var(--color-ink-500)]">
                        {row.snapshot.guest_nationality}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="text-[var(--color-ink-800)]">
                        Offers: {row.snapshot.result_count}
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                        Cheapest:{" "}
                        {formatMoney(row.cheapest_total, row.snapshot.currency)}
                      </p>
                      <p className="text-xs text-[var(--color-ink-500)]">
                        Median: {formatMoney(row.median_total, row.snapshot.currency)}
                      </p>
                      <p className="text-xs text-[var(--color-ink-500)]">
                        Top: {formatMoney(row.top_total, row.snapshot.currency)}
                      </p>
                      {row.snapshot.error_code ? (
                        <p className="mt-1 text-xs text-red-700">
                          {row.snapshot.error_code}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-[var(--color-ink-600)]">
                      <p>{formatTimestamp(row.snapshot.fetched_at)}</p>
                      <p className="mt-1">
                        {row.snapshot.expires_at > 0
                          ? `Expires ${formatTimestamp(row.snapshot.expires_at)}`
                          : "Expiry not set"}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StatusBadge status={row.provider_status} />
                      {row.related_log_ids.length > 0 ? (
                        <p className="mt-2 text-xs text-[var(--color-ink-500)]">
                          {row.related_log_ids.map((logId, index) => (
                            <span key={logId}>
                              {index > 0 ? " • " : ""}
                              <a
                                href={`#provider-log-${logId}`}
                                className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-ink-800)]"
                              >
                                {shortLogId(logId)}
                              </a>
                            </span>
                          ))}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-[var(--color-ink-500)]">
                          No linked provider logs in current window.
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <form action={retestHotelRateSnapshotAction} className="space-y-2">
                        <input
                          type="hidden"
                          name="snapshot_id"
                          value={row.snapshot.id}
                        />
                        <label className="flex items-start gap-2 text-xs text-[var(--color-ink-600)]">
                          <input
                            type="checkbox"
                            name="confirm_retest"
                            value="yes"
                            required
                            className="mt-0.5"
                          />
                          Confirm re-test
                        </label>
                        <button type="submit" className="btn-secondary">
                          Test again
                        </button>
                      </form>
                      <p className="mt-2 text-[11px] text-[var(--color-ink-500)]">
                        Cooldown guarded. Saves a new diagnostic snapshot only.
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <header className="border-b border-[var(--hairline)] px-5 py-4 sm:px-6">
          <h3 className="text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
            Search snapshots ({filteredSearchRows.length})
          </h3>
          <p className="mt-1 text-sm text-[var(--color-ink-600)]">
            Validate hotel-inventory discovery before rates are requested.
          </p>
        </header>

        {filteredSearchRows.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[var(--color-ink-600)] sm:px-6">
            No hotel-search snapshots found for the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[860px] divide-y divide-[var(--hairline)] text-sm">
              <thead className="bg-[var(--color-sand-50)] text-left text-xs uppercase tracking-wide text-[var(--color-ink-500)]">
                <tr>
                  <th className="px-4 py-3">City / node</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Hotel hits</th>
                  <th className="px-4 py-3">Fetched / expires</th>
                  <th className="px-4 py-3">Provider status + logs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline)]">
                {filteredSearchRows.map((row) => (
                  <tr key={row.snapshot.id}>
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-[var(--color-ink-900)]">
                        {row.city_label}
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                        {row.snapshot.region} • {row.snapshot.node_id}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top text-[var(--color-ink-700)]">
                      {row.snapshot.provider}
                    </td>
                    <td className="px-4 py-3 align-top text-[var(--color-ink-700)]">
                      {row.snapshot.result_count}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-[var(--color-ink-600)]">
                      <p>{formatTimestamp(row.snapshot.fetched_at)}</p>
                      <p className="mt-1">
                        {row.snapshot.expires_at > 0
                          ? `Expires ${formatTimestamp(row.snapshot.expires_at)}`
                          : "Expiry not set"}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StatusBadge status={row.provider_status} />
                      {row.related_log_ids.length > 0 ? (
                        <p className="mt-2 text-xs text-[var(--color-ink-500)]">
                          {row.related_log_ids.map((logId, index) => (
                            <span key={logId}>
                              {index > 0 ? " • " : ""}
                              <a
                                href={`#provider-log-${logId}`}
                                className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-ink-800)]"
                              >
                                {shortLogId(logId)}
                              </a>
                            </span>
                          ))}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-[var(--color-ink-500)]">
                          No linked provider logs in current window.
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <header className="border-b border-[var(--hairline)] px-5 py-4 sm:px-6">
          <h3 className="text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
            Cities with recent <code>no_hotel_rates</code> issues (
            {filteredNoHotelRatesCityRows.length})
          </h3>
          <p className="mt-1 text-sm text-[var(--color-ink-600)]">
            Window: latest 14-day issue span. Use this to identify repeated
            city-level rate gaps.
          </p>
        </header>

        {filteredNoHotelRatesCityRows.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[var(--color-ink-600)] sm:px-6">
            No recent <code>no_hotel_rates</code> issues for the selected filters.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {filteredNoHotelRatesCityRows.map((row) => (
              <li key={row.city_key} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-[var(--color-ink-900)]">
                      {row.city_label}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                      Issues: {row.issue_count} • Open: {row.open_count} • Ignored:{" "}
                      {row.ignored_count} • Resolved: {row.resolved_count}
                    </p>
                    <p className="mt-2 text-sm text-[var(--color-ink-700)]">
                      {row.latest_message}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                      Latest: {formatTimestamp(row.latest_created_at)} •{" "}
                      {row.latest_status}
                    </p>
                  </div>
                  <Link href="/admin/data-quality" className="btn-secondary">
                    Open data-quality queue
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <header className="border-b border-[var(--hairline)] px-5 py-4 sm:px-6">
          <h3 className="text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
            Provider call logs ({filteredProviderLogRows.length})
          </h3>
          <p className="mt-1 text-sm text-[var(--color-ink-600)]">
            Linked LiteAPI call telemetry for search and rates endpoints.
          </p>
        </header>

        {filteredProviderLogRows.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[var(--color-ink-600)] sm:px-6">
            No provider logs for the selected filters.
          </div>
        ) : (
          <ol className="divide-y divide-[var(--hairline)]">
            {filteredProviderLogRows.map((row) => (
              <li
                key={row.log.id}
                id={`provider-log-${row.log.id}`}
                className="px-5 py-4 sm:px-6"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={row.log.status} />
                  <code className="rounded bg-[var(--color-sand-50)] px-2 py-0.5 text-xs text-[var(--color-ink-700)]">
                    {row.log.endpoint}
                  </code>
                  <span className="text-xs text-[var(--color-ink-500)]">
                    {row.city_label}
                  </span>
                </div>

                <p className="mt-2 text-sm text-[var(--color-ink-700)]">
                  {formatTimestamp(row.log.created_at)} • {row.log.duration_ms} ms •{" "}
                  {row.log.result_count} results • log id {row.log.id}
                </p>

                {row.log.error_code || row.log.error_message ? (
                  <p className="mt-1 text-xs text-red-700">
                    {row.log.error_code ?? "provider_error"}
                    {row.log.error_message ? `: ${row.log.error_message}` : ""}
                  </p>
                ) : null}

                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-[var(--color-ink-600)]">
                    Request summary
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--color-sand-50)] p-3 text-xs text-[var(--color-ink-700)]">
                    {JSON.stringify(row.log.request_summary, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

function buildRateSnapshotRow(args: {
  snapshot: HotelOfferSnapshot;
  nodeNameById: Map<string, string>;
  searchSnapshotsByNodeKey: Map<string, HotelSearchSnapshot[]>;
  providerLogsByNodeKey: Map<string, ProviderCallLog[]>;
}): RateSnapshotRow {
  const nodeKey = buildNodeKey(args.snapshot.region, args.snapshot.node_id);
  const nearestSearchSnapshot = findNearestSnapshotByTimestamp(
    args.searchSnapshotsByNodeKey.get(nodeKey) ?? [],
    args.snapshot.fetched_at,
  );
  const cityLabel = resolveCityLabel({
    explicitName: nearestSearchSnapshot?.city_name ?? undefined,
    nodeId: args.snapshot.node_id,
    nodeNameById: args.nodeNameById,
  });
  const logs = args.providerLogsByNodeKey.get(nodeKey) ?? [];
  const nearestRateLog = findNearestRateLog({
    logs,
    snapshot: args.snapshot,
  });
  const nearestSearchLog = findNearestLog({
    logs,
    endpoint: "/data/hotels",
    targetMs: args.snapshot.fetched_at,
  });
  const relatedLogIds = Array.from(
    new Set(
      [nearestRateLog?.id, nearestSearchLog?.id].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
  const [cheapest, median, top] = computePriceSpread(args.snapshot);

  return {
    snapshot: args.snapshot,
    city_label: cityLabel,
    city_key: buildCityKey(args.snapshot.region, args.snapshot.node_id),
    provider_status: nearestRateLog?.status ?? args.snapshot.status,
    related_log_ids: relatedLogIds,
    cheapest_total: cheapest,
    median_total: median,
    top_total: top,
  };
}

function buildSearchSnapshotRow(args: {
  snapshot: HotelSearchSnapshot;
  nodeNameById: Map<string, string>;
  providerLogsByNodeKey: Map<string, ProviderCallLog[]>;
}): SearchSnapshotRow {
  const nodeKey = buildNodeKey(args.snapshot.region, args.snapshot.node_id);
  const cityLabel = resolveCityLabel({
    explicitName: args.snapshot.city_name ?? undefined,
    nodeId: args.snapshot.node_id,
    nodeNameById: args.nodeNameById,
  });
  const logs = args.providerLogsByNodeKey.get(nodeKey) ?? [];
  const nearestSearchLog = findNearestLog({
    logs,
    endpoint: "/data/hotels",
    targetMs: args.snapshot.fetched_at,
  });

  return {
    snapshot: args.snapshot,
    city_label: cityLabel,
    city_key: buildCityKey(args.snapshot.region, args.snapshot.node_id),
    provider_status:
      nearestSearchLog?.status ??
      (args.snapshot.result_count > 0 ? "success" : "empty"),
    related_log_ids: nearestSearchLog ? [nearestSearchLog.id] : [],
  };
}

function buildProviderLogRow(args: {
  log: ProviderCallLog;
  nodeNameById: Map<string, string>;
  searchSnapshotsByNodeKey: Map<string, HotelSearchSnapshot[]>;
}): ProviderLogRow {
  const nodeId = args.log.node_id ?? "unknown_node";
  let explicitName: string | undefined;
  if (args.log.region && args.log.node_id) {
    const nodeKey = buildNodeKey(args.log.region, args.log.node_id);
    const nearestSnapshot = findNearestSnapshotByTimestamp(
      args.searchSnapshotsByNodeKey.get(nodeKey) ?? [],
      args.log.created_at,
    );
    explicitName = nearestSnapshot?.city_name ?? undefined;
  }

  const cityLabel = resolveCityLabel({
    explicitName,
    nodeId,
    nodeNameById: args.nodeNameById,
  });

  return {
    log: args.log,
    city_label: cityLabel,
    city_key:
      args.log.region && args.log.node_id
        ? buildCityKey(args.log.region, args.log.node_id)
        : normaliseCityKey(cityLabel),
  };
}

function aggregateNoHotelRatesCityRows(
  issues: DataQualityIssue[],
  nodeNameById: Map<string, string>,
  cityKeyByNodeId: Map<string, string>,
): NoHotelRatesCityIssueRow[] {
  const buckets = new Map<string, NoHotelRatesCityIssueRow>();

  for (const issue of issues) {
    const cityLabel = resolveIssueCityLabel(issue, nodeNameById);
    const cityKey =
      (issue.entity_id ? cityKeyByNodeId.get(issue.entity_id) : undefined) ??
      normaliseCityKey(cityLabel);
    const existing = buckets.get(cityKey);
    if (!existing) {
      buckets.set(cityKey, {
        city_label: cityLabel,
        city_key: cityKey,
        issue_count: 1,
        open_count: issue.status === "open" ? 1 : 0,
        ignored_count: issue.status === "ignored" ? 1 : 0,
        resolved_count: issue.status === "resolved" ? 1 : 0,
        latest_created_at: issue.created_at,
        latest_message: issue.message,
        latest_status: issue.status,
      });
      continue;
    }

    existing.issue_count += 1;
    if (issue.status === "open") existing.open_count += 1;
    if (issue.status === "ignored") existing.ignored_count += 1;
    if (issue.status === "resolved") existing.resolved_count += 1;
    if (issue.created_at > existing.latest_created_at) {
      existing.latest_created_at = issue.created_at;
      existing.latest_message = issue.message;
      existing.latest_status = issue.status;
    }
  }

  return Array.from(buckets.values()).sort(
    (left, right) => right.latest_created_at - left.latest_created_at,
  );
}

function resolveIssueCityLabel(
  issue: DataQualityIssue,
  nodeNameById: Map<string, string>,
): string {
  const details = asRecord(issue.details);
  const detailCityName = readString(details?.city_name);
  if (detailCityName) return detailCityName;

  const detailNodeName = readString(details?.node_name);
  if (detailNodeName) return detailNodeName;

  if (issue.entity_id && nodeNameById.has(issue.entity_id)) {
    return nodeNameById.get(issue.entity_id) ?? issue.entity_id;
  }

  if (issue.entity_id) return issue.entity_id;
  return "Unknown city";
}

function groupSearchSnapshotsByNode(
  snapshots: HotelSearchSnapshot[],
): Map<string, HotelSearchSnapshot[]> {
  const grouped = new Map<string, HotelSearchSnapshot[]>();
  for (const snapshot of snapshots) {
    const key = buildNodeKey(snapshot.region, snapshot.node_id);
    const list = grouped.get(key) ?? [];
    list.push(snapshot);
    grouped.set(key, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => right.fetched_at - left.fetched_at);
  }
  return grouped;
}

function groupProviderLogsByNode(
  logs: ProviderCallLog[],
): Map<string, ProviderCallLog[]> {
  const grouped = new Map<string, ProviderCallLog[]>();
  for (const log of logs) {
    if (!log.region || !log.node_id) continue;
    const key = buildNodeKey(log.region, log.node_id);
    const list = grouped.get(key) ?? [];
    list.push(log);
    grouped.set(key, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => right.created_at - left.created_at);
  }
  return grouped;
}

function buildNodeKey(region: string, nodeId: string): string {
  return `${region}::${nodeId}`;
}

function buildCityKey(region: string, nodeId: string): string {
  return `${region.trim().toLowerCase()}::${nodeId.trim()}`;
}

function findNearestSnapshotByTimestamp(
  snapshots: HotelSearchSnapshot[],
  targetMs: number,
): HotelSearchSnapshot | null {
  let best: HotelSearchSnapshot | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const snapshot of snapshots) {
    const diff = Math.abs(snapshot.fetched_at - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = snapshot;
    }
  }
  return best;
}

function findNearestRateLog(args: {
  logs: ProviderCallLog[];
  snapshot: HotelOfferSnapshot;
}): ProviderCallLog | null {
  const requestMatchedLogs = args.logs.filter((log) =>
    rateLogMatchesSnapshot(log, args.snapshot),
  );
  return findNearestLog({
    logs: requestMatchedLogs.length > 0 ? requestMatchedLogs : args.logs,
    endpoint: "/hotels/rates",
    targetMs: args.snapshot.fetched_at,
  });
}

function rateLogMatchesSnapshot(
  log: ProviderCallLog,
  snapshot: HotelOfferSnapshot,
): boolean {
  if (log.endpoint !== "/hotels/rates") return false;
  const summary = log.request_summary;
  if (readString(summary.checkin) !== snapshot.checkin) return false;
  if (readString(summary.checkout) !== snapshot.checkout) return false;
  if (readString(summary.currency) !== snapshot.currency) return false;
  if (readString(summary.guest_nationality) !== snapshot.guest_nationality) {
    return false;
  }
  if (readNumber(summary.hotel_ids_count) !== snapshot.hotel_ids.length) {
    return false;
  }
  return (
    occupancySummarySignature(summary.occupancies) ===
    snapshotOccupancySignature(snapshot)
  );
}

function findNearestLog(args: {
  logs: ProviderCallLog[];
  endpoint: string;
  targetMs: number;
}): ProviderCallLog | null {
  let best: ProviderCallLog | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const log of args.logs) {
    if (log.endpoint !== args.endpoint) continue;
    const diff = Math.abs(log.created_at - args.targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = log;
    }
  }
  if (!best) return null;
  return bestDiff <= RELATED_LOG_WINDOW_MS ? best : null;
}

function occupancySummarySignature(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const adults = readNumber(record.adults);
      const childrenCount = readNumber(record.children_count);
      if (adults === undefined || childrenCount === undefined) return null;
      return `${adults}:${childrenCount}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .sort()
    .join("|");
}

function snapshotOccupancySignature(snapshot: HotelOfferSnapshot): string {
  return snapshot.occupancies
    .map((occupancy) => `${occupancy.adults}:${occupancy.children_ages.length}`)
    .sort()
    .join("|");
}

function resolveCityLabel(args: {
  explicitName?: string;
  nodeId: string;
  nodeNameById: Map<string, string>;
}): string {
  if (args.explicitName && args.explicitName.trim().length > 0) {
    return args.explicitName.trim();
  }
  const nodeName = args.nodeNameById.get(args.nodeId);
  if (nodeName) return nodeName;
  return args.nodeId;
}

function computePriceSpread(snapshot: HotelOfferSnapshot): [number | null, number | null, number | null] {
  const sorted = snapshot.offers
    .map((offer) => offer.total_amount)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (sorted.length === 0) {
    return [null, null, null];
  }
  const cheapest = sorted[0];
  const top = sorted[sorted.length - 1];
  return [cheapest, median(sorted), top];
}

function median(sortedValues: number[]): number | null {
  if (sortedValues.length === 0) return null;
  const mid = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[mid];
  return Number(((sortedValues[mid - 1] + sortedValues[mid]) / 2).toFixed(2));
}

function matchesSnapshotFilters(args: {
  filters: SnapshotFilters;
  cityKey: string;
  provider: string;
  status: string;
  fetchedAt: number;
}): boolean {
  if (args.filters.cityKey && args.cityKey !== args.filters.cityKey) {
    return false;
  }
  if (args.filters.provider && args.provider !== args.filters.provider) {
    return false;
  }
  if (args.filters.status && args.status !== args.filters.status) {
    return false;
  }
  if (args.filters.fromMs !== undefined && args.fetchedAt < args.filters.fromMs) {
    return false;
  }
  if (args.filters.toMs !== undefined && args.fetchedAt > args.filters.toMs) {
    return false;
  }
  return true;
}

function countByStatus(rows: RateSnapshotRow[]): Record<"success" | "empty" | "error", number> {
  const counts = {
    success: 0,
    empty: 0,
    error: 0,
  };

  for (const row of rows) {
    if (row.provider_status === "success") counts.success += 1;
    else if (row.provider_status === "empty") counts.empty += 1;
    else counts.error += 1;
  }
  return counts;
}

function buildCityOptions(
  entries: Array<{ city_key: string; city_label: string }>,
): Array<{ city_key: string; city_label: string }> {
  const byKey = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.city_key) continue;
    if (!byKey.has(entry.city_key)) {
      byKey.set(entry.city_key, entry.city_label);
    }
  }
  return Array.from(byKey.entries())
    .map(([city_key, city_label]) => ({ city_key, city_label }))
    .sort((left, right) => left.city_label.localeCompare(right.city_label));
}

function parseActionStatus(
  value: SearchParamValue,
): "success" | "error" | undefined {
  const raw = parseStringParam(value);
  if (raw === "success" || raw === "error") return raw;
  return undefined;
}

function parseDateAtUtcMidnight(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = Date.UTC(year, month - 1, day);
  const check = new Date(date);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date;
}

function parseStringParam(value: SearchParamValue): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return undefined;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function resolveSearchParams(
  searchParams: Promise<PageSearchParams> | PageSearchParams | undefined,
): Promise<PageSearchParams> {
  if (!searchParams) return {};
  return await Promise.resolve(searchParams);
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "-";
  return TIMESTAMP_FORMATTER.format(new Date(timestamp));
}

function formatMoney(amount: number | null, currency: string): string {
  if (amount === null) return "unknown";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function normaliseCityKey(value: string | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase();
}

function shortLogId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 14)}...`;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? Number(parsed) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function statusBadgeClass(status: string): string {
  if (status === "success") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "empty") {
    return "bg-amber-100 text-amber-700";
  }
  if (status === "timeout") {
    return "bg-orange-100 text-orange-700";
  }
  if (status === "disabled") {
    return "bg-slate-200 text-slate-700";
  }
  if (status === "error") {
    return "bg-red-100 text-red-700";
  }
  return "bg-blue-100 text-blue-700";
}

function StatusBadge(props: { status: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-wide ${statusBadgeClass(
        props.status,
      )}`}
    >
      {props.status}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warn";
}) {
  return (
    <li className="card border border-[var(--hairline)] px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-500)]">
        {label}
      </p>
      <p
        className={`mt-2 text-3xl font-semibold ${
          tone === "warn" ? "text-amber-700" : "text-[var(--color-ink-900)]"
        }`}
      >
        {value}
      </p>
    </li>
  );
}
