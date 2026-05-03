import Link from "next/link";

import {
  ATTRACTION_ADMISSION_AUDIENCES,
  ATTRACTION_ADMISSION_CONFIDENCE_LEVELS,
  ATTRACTION_ADMISSION_NATIONALITIES,
  ATTRACTION_ADMISSION_SOURCE_TYPES,
  type AttractionAdmissionRule,
  type GraphNode,
} from "@/types/domain";
import {
  deleteAttractionAdmissionRuleAction,
  markAttractionAdmissionFreeAction,
  markAttractionAdmissionUnknownAction,
  upsertAttractionAdmissionRuleAction,
} from "@/app/admin/attraction-costs/actions";
import { findNodes } from "@/lib/repositories/nodeRepository";
import {
  listByAttractionIds,
  listMissingForAttractions,
  type MissingAttractionAdmission,
} from "@/lib/repositories/attractionAdmissionRepository";

type SearchParamValue = string | string[] | undefined;
type PageSearchParams = Record<string, SearchParamValue>;

interface AdminAttractionCostsPageProps {
  searchParams?: Promise<PageSearchParams> | PageSearchParams;
}

const DEFAULT_LIMIT = 250;

export default async function AdminAttractionCostsPage({
  searchParams,
}: AdminAttractionCostsPageProps) {
  const params = await resolveSearchParams(searchParams);
  const region = parseStringParam(params.region);
  const limit = parseLimitParam(params.limit);

  const attractions = (
    await findNodes({
      type: "attraction",
      ...(region ? { region } : {}),
      limit,
    })
  ).sort((left, right) => left.name.localeCompare(right.name));
  const attractionIds = attractions.map((attraction) => attraction.id);
  const [rules, missing] = await Promise.all([
    listByAttractionIds(attractionIds),
    listMissingForAttractions(attractionIds),
  ]);

  const rulesByAttractionId = new Map<string, AttractionAdmissionRule[]>();
  for (const rule of rules) {
    const list = rulesByAttractionId.get(rule.attraction_node_id) ?? [];
    list.push(rule);
    rulesByAttractionId.set(rule.attraction_node_id, list);
  }
  const missingByAttractionId = new Map(
    missing.map((entry) => [entry.attraction_id, entry]),
  );

  const verifiedCount = rules.filter(
    (rule) => rule.confidence === "verified" && rule.amount !== null,
  ).length;
  const estimatedCount = rules.filter(
    (rule) => rule.confidence === "estimated" && rule.amount !== null,
  ).length;
  const unknownCount = rules.filter(
    (rule) => rule.confidence === "unknown" || rule.amount === null,
  ).length;

  return (
    <section className="space-y-5">
      <div className="card p-6 sm:p-8">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
          Attraction admission costs
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
          Ticket-price coverage
        </h2>
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-ink-600)]">
          Keep attraction admission pricing deterministic and explicit. Unknown
          prices remain <code>amount: null</code>, while free attractions should
          be saved as <code>amount: 0</code> with verified manual confidence.
          Audience, nationality, and student status are tracked separately so
          a single ticket variant (e.g. foreign adult student) is expressible
          without conflating dimensions.
        </p>
      </div>

      <div className="card p-5">
        <form method="get" className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Region
            <input
              type="text"
              name="region"
              defaultValue={region ?? ""}
              placeholder="e.g. rajasthan"
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            />
          </label>
          <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
            Attraction limit
            <input
              type="number"
              name="limit"
              min={1}
              max={1000}
              defaultValue={limit}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)]"
            />
          </label>
          <div className="flex items-end gap-2 md:col-span-2">
            <button type="submit" className="btn-secondary">
              Apply filters
            </button>
            <Link
              href="/admin/attraction-costs"
              className="rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm font-medium text-[var(--color-ink-700)] hover:bg-[var(--color-sand-50)]"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      <ul className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="Attractions scanned" value={attractions.length} />
        <SummaryCard label="Rules saved" value={rules.length} />
        <SummaryCard label="Missing coverage" value={missing.length} tone="warn" />
        <SummaryCard label="Unknown rules" value={unknownCount} />
      </ul>
      <ul className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Verified priced rules" value={verifiedCount} />
        <SummaryCard label="Estimated priced rules" value={estimatedCount} />
        <SummaryCard label="Unknown amount rules" value={unknownCount} />
      </ul>

      <section className="space-y-4">
        {attractions.length === 0 ? (
          <div className="card px-5 py-8 text-sm text-[var(--color-ink-600)]">
            No attractions found for the selected filters.
          </div>
        ) : (
          attractions.map((attraction) => (
            <AttractionCostCard
              key={attraction.id}
              attraction={attraction}
              rules={rulesByAttractionId.get(attraction.id) ?? []}
              missing={missingByAttractionId.get(attraction.id)}
            />
          ))
        )}
      </section>
    </section>
  );
}

function AttractionCostCard({
  attraction,
  rules,
  missing,
}: {
  attraction: GraphNode;
  rules: AttractionAdmissionRule[];
  missing?: MissingAttractionAdmission;
}) {
  return (
    <article className="card border border-[var(--hairline)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
            {attraction.name}
          </h3>
          <p className="mt-1 text-xs text-[var(--color-ink-500)]">
            {attraction.region} • {attraction.id}
          </p>
          {missing ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1 text-xs text-amber-800">
              {missing.reason === "no_rules"
                ? "No admission rules yet."
                : "Rules exist but all costs are unknown."}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={markAttractionAdmissionUnknownAction}>
            <input type="hidden" name="attraction_node_id" value={attraction.id} />
            <input type="hidden" name="region" value={attraction.region} />
            <input type="hidden" name="audience" value="adult" />
            <input type="hidden" name="nationality" value="any" />
            <button type="submit" className="btn-secondary">
              Mark unknown (adult)
            </button>
          </form>
          <form action={markAttractionAdmissionFreeAction}>
            <input type="hidden" name="attraction_node_id" value={attraction.id} />
            <input type="hidden" name="region" value={attraction.region} />
            <input type="hidden" name="audience" value="adult" />
            <input type="hidden" name="nationality" value="any" />
            <button type="submit" className="btn-secondary">
              Mark free (adult)
            </button>
          </form>
        </div>
      </div>

      {rules.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-ink-600)]">
          No rules saved yet. Add one below or mark this attraction as unknown.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="rounded-xl border border-[var(--hairline)] bg-[var(--color-sand-50)] p-3"
            >
              <form
                action={upsertAttractionAdmissionRuleAction}
                className="grid gap-2 md:grid-cols-8"
              >
                <input type="hidden" name="rule_id" value={rule.id} />
                <input
                  type="hidden"
                  name="attraction_node_id"
                  value={attraction.id}
                />
                <input type="hidden" name="region" value={attraction.region} />

                <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                  Audience
                  <select
                    name="audience"
                    defaultValue={rule.audience}
                    className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                  >
                    {ATTRACTION_ADMISSION_AUDIENCES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                  Nationality
                  <select
                    name="nationality"
                    defaultValue={rule.nationality}
                    className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                  >
                    {ATTRACTION_ADMISSION_NATIONALITIES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-[var(--color-ink-600)]">
                  <input
                    type="checkbox"
                    name="is_student"
                    value="true"
                    defaultChecked={rule.is_student === true}
                  />
                  Student
                </label>
                <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                  Amount
                  <input
                    type="number"
                    name="amount"
                    step={1}
                    min={0}
                    defaultValue={rule.amount ?? ""}
                    placeholder="unknown"
                    className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                  Currency
                  <input
                    type="text"
                    name="currency"
                    defaultValue={rule.currency}
                    maxLength={3}
                    className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm uppercase"
                  />
                </label>
                <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                  Source
                  <select
                    name="source_type"
                    defaultValue={rule.source_type}
                    className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                  >
                    {ATTRACTION_ADMISSION_SOURCE_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                  Confidence
                  <select
                    name="confidence"
                    defaultValue={rule.confidence}
                    className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                  >
                    {ATTRACTION_ADMISSION_CONFIDENCE_LEVELS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
                  Valid from
                  <input
                    type="date"
                    name="valid_from"
                    defaultValue={rule.valid_from ?? ""}
                    className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                  />
                </label>

                <label className="space-y-1 text-xs text-[var(--color-ink-600)] md:col-span-2">
                  Valid until
                  <input
                    type="date"
                    name="valid_until"
                    defaultValue={rule.valid_until ?? ""}
                    className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="space-y-1 text-xs text-[var(--color-ink-600)] md:col-span-3">
                  Source URL
                  <input
                    type="url"
                    name="source_url"
                    defaultValue={rule.source_url ?? ""}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="space-y-1 text-xs text-[var(--color-ink-600)] md:col-span-3">
                  Notes
                  <input
                    type="text"
                    name="notes"
                    defaultValue={rule.notes ?? ""}
                    className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
                  />
                </label>

                <div className="flex flex-wrap gap-2 md:col-span-8">
                  <button type="submit" className="btn-secondary">
                    Save rule
                  </button>
                  <p className="text-xs text-[var(--color-ink-500)]">
                    Saving with the same amount and confidence preserves the
                    original verified_at timestamp.
                  </p>
                </div>
              </form>

              <div className="mt-3 flex flex-wrap gap-2">
                <form action={markAttractionAdmissionUnknownAction}>
                  <input type="hidden" name="rule_id" value={rule.id} />
                  <input
                    type="hidden"
                    name="attraction_node_id"
                    value={attraction.id}
                  />
                  <input type="hidden" name="region" value={attraction.region} />
                  <input type="hidden" name="audience" value={rule.audience} />
                  <input
                    type="hidden"
                    name="nationality"
                    value={rule.nationality}
                  />
                  {rule.is_student && (
                    <input type="hidden" name="is_student" value="true" />
                  )}
                  <input type="hidden" name="currency" value={rule.currency} />
                  <button type="submit" className="btn-secondary">
                    Mark unknown
                  </button>
                </form>
                <form action={markAttractionAdmissionFreeAction}>
                  <input type="hidden" name="rule_id" value={rule.id} />
                  <input
                    type="hidden"
                    name="attraction_node_id"
                    value={attraction.id}
                  />
                  <input type="hidden" name="region" value={attraction.region} />
                  <input type="hidden" name="audience" value={rule.audience} />
                  <input
                    type="hidden"
                    name="nationality"
                    value={rule.nationality}
                  />
                  {rule.is_student && (
                    <input type="hidden" name="is_student" value="true" />
                  )}
                  <input type="hidden" name="currency" value={rule.currency} />
                  <button type="submit" className="btn-secondary">
                    Mark free
                  </button>
                </form>
                <form action={deleteAttractionAdmissionRuleAction}>
                  <input type="hidden" name="rule_id" value={rule.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-4 rounded-xl border border-[var(--hairline)] bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--color-ink-800)]">
          Add rule
        </summary>
        <form
          action={upsertAttractionAdmissionRuleAction}
          className="mt-3 grid gap-2 md:grid-cols-7"
        >
          <input type="hidden" name="attraction_node_id" value={attraction.id} />
          <input type="hidden" name="region" value={attraction.region} />

          <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
            Audience
            <select
              name="audience"
              defaultValue="adult"
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
            >
              {ATTRACTION_ADMISSION_AUDIENCES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
            Nationality
            <select
              name="nationality"
              defaultValue="any"
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
            >
              {ATTRACTION_ADMISSION_NATIONALITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-ink-600)]">
            <input type="checkbox" name="is_student" value="true" />
            Student
          </label>
          <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
            Amount
            <input
              type="number"
              name="amount"
              min={0}
              step={1}
              placeholder="Leave blank for unknown"
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
            Currency
            <input
              type="text"
              name="currency"
              defaultValue="INR"
              maxLength={3}
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm uppercase"
            />
          </label>
          <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
            Source
            <select
              name="source_type"
              defaultValue="manual"
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
            >
              {ATTRACTION_ADMISSION_SOURCE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
            Confidence
            <select
              name="confidence"
              defaultValue="verified"
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
            >
              {ATTRACTION_ADMISSION_CONFIDENCE_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-[var(--color-ink-600)]">
            Valid from
            <input
              type="date"
              name="valid_from"
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs text-[var(--color-ink-600)] md:col-span-2">
            Source URL
            <input
              type="url"
              name="source_url"
              placeholder="https://..."
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs text-[var(--color-ink-600)] md:col-span-4">
            Notes
            <input
              type="text"
              name="notes"
              placeholder="Optional notes"
              className="w-full rounded-lg border border-[var(--hairline)] bg-white px-2 py-1.5 text-sm"
            />
          </label>

          <div className="md:col-span-7">
            <button type="submit" className="btn-secondary">
              Add / update rule
            </button>
          </div>
        </form>
      </details>
    </article>
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

async function resolveSearchParams(
  searchParams: Promise<PageSearchParams> | PageSearchParams | undefined,
): Promise<PageSearchParams> {
  if (!searchParams) return {};
  return await Promise.resolve(searchParams);
}

function parseStringParam(value: SearchParamValue): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return undefined;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseLimitParam(value: SearchParamValue): number {
  const parsed = Number.parseInt(parseStringParam(value) ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, 1000));
}
