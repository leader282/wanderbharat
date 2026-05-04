"use client";

import { useState } from "react";

interface LiteApiTestConsoleProps {
  defaults: {
    countryCode: string;
    radiusMeters: number;
    adults: number;
    rooms: number;
    currency: string;
    guestNationality: string;
    maxResults: number;
    checkinDate: string;
    checkoutDate: string;
  };
  providerStatus: {
    enabledFlag: boolean;
    apiKeyPresent: boolean;
    available: boolean;
    timeoutMs: number;
  };
}

interface ProbeResponse {
  ok: boolean;
  provider_status: {
    enabled_flag: boolean;
    api_key_present: boolean;
    available: boolean;
    timeout_ms: number;
    max_results_default: number;
  };
  request_summary: {
    region: string;
    node_id: string;
    city_name: string | null;
    country_code: string;
    anchor: { lat: number; lng: number } | null;
    radius_meters: number;
    checkin_date: string;
    checkout_date: string;
    adults: number;
    children_ages: number[];
    rooms_requested: number;
    rooms_used_for_rates: number;
    currency: string;
    guest_nationality: string;
    max_results: number;
  };
  response_time_ms: number;
  hotels_count: number;
  rates_count: number;
  cheapest_total_amount: number | null;
  median_total_amount: number | null;
  currency: string;
  provider_call_log_id: string | null;
  provider_call_log_ids: string[];
  provider_calls: Array<{
    id: string;
    endpoint: string;
    status: string;
    duration_ms: number;
    result_count: number;
    error_code: string | null;
    error_message: string | null;
  }>;
  hotel_search_snapshot_id: string | null;
  hotel_offer_snapshot_id: string | null;
  top_hotels: Array<{
    provider_hotel_id: string;
    name: string;
    address: string | null;
    star_rating: number | null;
    guest_rating: number | null;
    distance_from_anchor_km: number | null;
    cheapest_total_amount: number | null;
    currency: string;
  }>;
  normalized_json: {
    hotels: unknown[];
    rates_snapshot: unknown | null;
  };
  error?: {
    kind: string;
    code?: string;
    message: string;
  };
}

interface InvalidInputPayload {
  error: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}

interface FormState {
  cityName: string;
  countryCode: string;
  latitude: string;
  longitude: string;
  radiusMeters: string;
  checkinDate: string;
  checkoutDate: string;
  adults: string;
  childrenAges: string;
  rooms: string;
  currency: string;
  guestNationality: string;
  maxResults: string;
}

export default function LiteApiTestConsole({
  defaults,
  providerStatus,
}: LiteApiTestConsoleProps) {
  const [form, setForm] = useState<FormState>({
    cityName: "",
    countryCode: defaults.countryCode,
    latitude: "",
    longitude: "",
    radiusMeters: String(defaults.radiusMeters),
    checkinDate: defaults.checkinDate,
    checkoutDate: defaults.checkoutDate,
    adults: String(defaults.adults),
    childrenAges: "",
    rooms: String(defaults.rooms),
    currency: defaults.currency,
    guestNationality: defaults.guestNationality,
    maxResults: String(defaults.maxResults),
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ProbeResponse | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmissionError(null);
    setIsSubmitting(true);

    const parsedChildren = parseChildrenAges(form.childrenAges);
    if (!parsedChildren.ok) {
      setSubmissionError(parsedChildren.message);
      setIsSubmitting(false);
      return;
    }

    const latitude = parseOptionalNumber(form.latitude);
    const longitude = parseOptionalNumber(form.longitude);
    const radiusMeters = Number(form.radiusMeters);
    const adults = Number(form.adults);
    const rooms = Number(form.rooms);
    const maxResultsRaw = form.maxResults.trim();
    const maxResults = maxResultsRaw.length > 0 ? Number(maxResultsRaw) : undefined;

    if (
      (latitude !== undefined && !Number.isFinite(latitude)) ||
      (longitude !== undefined && !Number.isFinite(longitude))
    ) {
      setSubmissionError("Latitude/longitude must be valid numbers.");
      setIsSubmitting(false);
      return;
    }

    if (
      !Number.isFinite(radiusMeters) ||
      !Number.isFinite(adults) ||
      !Number.isFinite(rooms) ||
      (maxResults !== undefined && !Number.isFinite(maxResults))
    ) {
      setSubmissionError("Numeric inputs must be valid numbers.");
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/admin/liteapi-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          city_name: form.cityName.trim() || undefined,
          country_code: form.countryCode.trim() || "IN",
          latitude,
          longitude,
          radius_meters: radiusMeters,
          checkin_date: form.checkinDate,
          checkout_date: form.checkoutDate,
          adults,
          children_ages: parsedChildren.ages,
          rooms,
          currency: form.currency.trim() || "INR",
          guest_nationality: form.guestNationality.trim() || "IN",
          max_results: maxResults,
        }),
      });

      const payload = (await response.json()) as unknown;
      setStatusCode(response.status);

      if (isProbeResponse(payload)) {
        setResult(payload);
        if (!response.ok && payload.error) {
          setSubmissionError(formatProbeErrorLine(payload.error));
        }
      } else if (isInvalidInputPayload(payload)) {
        setResult(null);
        setSubmissionError(formatInvalidInputMessage(payload));
      } else {
        setResult(null);
        setSubmissionError("Unexpected response format from /api/admin/liteapi-test.");
      }
    } catch (error) {
      setResult(null);
      setSubmissionError(
        error instanceof Error
          ? error.message
          : "Failed to reach the LiteAPI test endpoint.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="card p-6 sm:p-8">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
          LiteAPI admin console
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
          Hotel search + rate probe
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-ink-600)]">
          Run ad-hoc provider probes for Jaipur/Udaipur-style checks without invoking
          the itinerary engine.
        </p>
        <p className="mt-3 text-xs text-[var(--color-ink-500)]">
          Provider available: {providerStatus.available ? "yes" : "no"} (enabled
          flag: {String(providerStatus.enabledFlag)}, api key present:{" "}
          {String(providerStatus.apiKeyPresent)}, timeout: {providerStatus.timeoutMs}
          ms)
        </p>
      </div>

      <form className="card p-5 sm:p-6" onSubmit={onSubmit}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="City name">
            <input
              type="text"
              value={form.cityName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, cityName: event.target.value }))
              }
              placeholder="Jaipur"
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Country code">
            <input
              type="text"
              value={form.countryCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, countryCode: event.target.value }))
              }
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm uppercase"
            />
          </Field>

          <Field label="Latitude">
            <input
              type="text"
              value={form.latitude}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, latitude: event.target.value }))
              }
              placeholder="26.9124"
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Longitude">
            <input
              type="text"
              value={form.longitude}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, longitude: event.target.value }))
              }
              placeholder="75.7873"
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Radius meters">
            <input
              type="number"
              value={form.radiusMeters}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, radiusMeters: event.target.value }))
              }
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Max results">
            <input
              type="number"
              value={form.maxResults}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, maxResults: event.target.value }))
              }
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Check-in date">
            <input
              type="date"
              value={form.checkinDate}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, checkinDate: event.target.value }))
              }
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Checkout date">
            <input
              type="date"
              value={form.checkoutDate}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, checkoutDate: event.target.value }))
              }
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Adults">
            <input
              type="number"
              value={form.adults}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, adults: event.target.value }))
              }
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Rooms">
            <input
              type="number"
              value={form.rooms}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, rooms: event.target.value }))
              }
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Children ages (comma separated)">
            <input
              type="text"
              value={form.childrenAges}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, childrenAges: event.target.value }))
              }
              placeholder="5, 9"
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Currency">
            <input
              type="text"
              value={form.currency}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, currency: event.target.value }))
              }
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm uppercase"
            />
          </Field>

          <Field label="Guest nationality">
            <input
              type="text"
              value={form.guestNationality}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, guestNationality: event.target.value }))
              }
              className="w-full rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm uppercase"
            />
          </Field>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button type="submit" disabled={isSubmitting} className="btn-primary">
            {isSubmitting ? "Running..." : "Run LiteAPI probe"}
          </button>
          <span className="text-xs text-[var(--color-ink-500)]">
            API key remains server-side.
          </span>
        </div>
      </form>

      {submissionError ? (
        <div className="card whitespace-pre-line border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {submissionError}
        </div>
      ) : null}

      {result ? (
        <>
          <div className="card p-5">
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-500)]">
              Result
            </p>
            <p className="mt-1 text-sm text-[var(--color-ink-700)]">
              HTTP status: {statusCode ?? "-"} • Provider available:{" "}
              {String(result.provider_status.available)}
            </p>
            <p className="mt-2 text-sm text-[var(--color-ink-800)]">
              Response time: {result.response_time_ms} ms
            </p>
            {result.error ? (
              <p className="mt-2 text-sm text-red-700">
                {formatProbeErrorLine(result.error)}
              </p>
            ) : (
              <p className="mt-2 text-sm text-green-700">Probe completed successfully.</p>
            )}
          </div>

          <div className="card p-5">
            <h3 className="text-lg font-semibold text-[var(--color-ink-900)]">
              Request summary
            </h3>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--color-sand-50)] p-3 text-xs text-[var(--color-ink-700)]">
              {JSON.stringify(result.request_summary, null, 2)}
            </pre>
          </div>

          <div className="card p-5">
            <h3 className="text-lg font-semibold text-[var(--color-ink-900)]">
              Metrics
            </h3>
            <ul className="mt-3 space-y-1 text-sm text-[var(--color-ink-700)]">
              <li>Hotels: {result.hotels_count}</li>
              <li>Rates: {result.rates_count}</li>
              <li>
                Cheapest rate:{" "}
                {formatMoney(result.cheapest_total_amount, result.currency)}
              </li>
              <li>
                Median-ish rate:{" "}
                {formatMoney(result.median_total_amount, result.currency)}
              </li>
              <li>Provider call log id: {result.provider_call_log_id ?? "-"}</li>
              <li>
                Provider call log ids:{" "}
                {result.provider_call_log_ids.length > 0
                  ? result.provider_call_log_ids.join(", ")
                  : "-"}
              </li>
              <li>Hotel search snapshot id: {result.hotel_search_snapshot_id ?? "-"}</li>
              <li>Hotel offer snapshot id: {result.hotel_offer_snapshot_id ?? "-"}</li>
            </ul>
          </div>

          <div className="card p-5">
            <h3 className="text-lg font-semibold text-[var(--color-ink-900)]">
              Provider calls
            </h3>
            {result.provider_calls.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-600)]">
                No upstream LiteAPI calls were recorded for this probe.
              </p>
            ) : (
              <ol className="mt-3 space-y-2 text-sm text-[var(--color-ink-700)]">
                {result.provider_calls.map((call, idx) => (
                  <li
                    key={call.id}
                    className="rounded-lg border border-[var(--hairline)] p-3"
                  >
                    <p className="font-medium text-[var(--color-ink-900)]">
                      #{idx + 1} • {call.endpoint} • {call.status} •{" "}
                      {call.duration_ms} ms
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                      results: {call.result_count}
                      {call.error_code ? ` • code: ${call.error_code}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                      log id: {call.id}
                    </p>
                    {call.error_message ? (
                      <p className="mt-1 text-xs text-red-700">
                        {call.error_message}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="card p-5">
            <h3 className="text-lg font-semibold text-[var(--color-ink-900)]">
              Top normalized hotel cards
            </h3>
            {result.top_hotels.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-600)]">
                No hotels to display.
              </p>
            ) : (
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {result.top_hotels.map((hotel) => (
                  <li
                    key={hotel.provider_hotel_id}
                    className="rounded-lg border border-[var(--hairline)] p-3 text-sm"
                  >
                    <p className="font-semibold text-[var(--color-ink-900)]">
                      {hotel.name}
                    </p>
                    <p className="mt-1 text-[var(--color-ink-600)]">
                      {hotel.address ?? "Address unavailable"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                      ID: {hotel.provider_hotel_id}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                      Star: {hotel.star_rating ?? "-"} • Guest:{" "}
                      {hotel.guest_rating ?? "-"} • Distance:{" "}
                      {hotel.distance_from_anchor_km ?? "-"} km
                    </p>
                    <p className="mt-2 text-sm font-medium text-[var(--color-ink-800)]">
                      Cheapest:{" "}
                      {formatMoney(hotel.cheapest_total_amount, hotel.currency)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-5">
            <h3 className="text-lg font-semibold text-[var(--color-ink-900)]">
              Raw normalized JSON
            </h3>
            <pre className="mt-3 max-h-[460px] overflow-auto rounded-lg bg-[var(--color-sand-50)] p-3 text-xs text-[var(--color-ink-700)]">
              {JSON.stringify(result.normalized_json, null, 2)}
            </pre>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
      {props.label}
      {props.children}
    </label>
  );
}

function parseChildrenAges(
  rawValue: string,
): { ok: true; ages: number[] } | { ok: false; message: string } {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { ok: true, ages: [] };
  }

  const parts = trimmed.split(",").map((entry) => entry.trim());
  const ages: number[] = [];

  for (const part of parts) {
    if (!part) continue;
    const parsed = Number(part);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 17) {
      return {
        ok: false,
        message:
          "Children ages must be comma-separated whole numbers between 0 and 17.",
      };
    }
    ages.push(parsed);
  }

  if (ages.length > 12) {
    return {
      ok: false,
      message: "Children ages cannot contain more than 12 entries.",
    };
  }

  ages.sort((left, right) => left - right);
  return { ok: true, ages };
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return Number(trimmed);
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

function isProbeResponse(value: unknown): value is ProbeResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ok === "boolean" &&
    typeof candidate.provider_status === "object" &&
    typeof candidate.request_summary === "object"
  );
}

/**
 * The route returns `{ error, message, issues? }` for 400 validation failures.
 * Distinguish that shape from a probe result so the UI can surface field-level
 * issues instead of rendering a confusing "Unexpected response format" message.
 */
function isInvalidInputPayload(value: unknown): value is InvalidInputPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.error === "string" &&
    typeof candidate.message === "string" &&
    !("ok" in candidate) &&
    !("provider_status" in candidate)
  );
}

function formatInvalidInputMessage(payload: InvalidInputPayload): string {
  const lines: string[] = [payload.message];
  if (payload.issues && payload.issues.length > 0) {
    for (const issue of payload.issues) {
      const location = issue.path && issue.path.length > 0 ? issue.path : "request";
      lines.push(`• ${location}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}

function formatProbeErrorLine(error: NonNullable<ProbeResponse["error"]>): string {
  const codeSuffix = error.code ? ` (${error.code})` : "";
  return `${error.kind}${codeSuffix}: ${error.message}`;
}
