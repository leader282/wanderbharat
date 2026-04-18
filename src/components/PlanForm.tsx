"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  TRANSPORT_MODES,
  TRAVEL_STYLES,
  type GraphNode,
  type TransportMode,
  type TravelStyle,
} from "@/types/domain";

interface RegionOption {
  region: string;
  country: string;
  count: number;
  default_currency?: string;
  default_locale?: string;
  default_transport_modes?: TransportMode[];
}

interface FormState {
  region: string;
  start_node: string;
  days: number;
  travel_style: TravelStyle;
  budget_min: number;
  budget_max: number;
  interests: string[];
  transport_modes: TransportMode[];
}

const INTEREST_OPTIONS: { id: string; label: string; emoji: string }[] = [
  { id: "heritage", label: "Heritage", emoji: "🏛️" },
  { id: "food", label: "Food", emoji: "🍛" },
  { id: "nature", label: "Nature", emoji: "🌿" },
  { id: "wildlife", label: "Wildlife", emoji: "🐅" },
  { id: "spiritual", label: "Spiritual", emoji: "🕉️" },
  { id: "luxury", label: "Luxury", emoji: "✨" },
  { id: "adventure", label: "Adventure", emoji: "🧗" },
  { id: "culture", label: "Culture", emoji: "🎭" },
];

const STYLE_COPY: Record<
  TravelStyle,
  { label: string; tagline: string }
> = {
  relaxed: {
    label: "Relaxed",
    tagline: "Fewer stops. Longer mornings. Real breathing room.",
  },
  balanced: {
    label: "Balanced",
    tagline: "A comfortable mix of movement and downtime.",
  },
  adventurous: {
    label: "Adventurous",
    tagline: "Pack it in. More cities, earlier starts, full days.",
  },
};

const INITIAL_STATE: FormState = {
  region: "",
  start_node: "",
  days: 5,
  travel_style: "balanced",
  budget_min: 15000,
  budget_max: 45000,
  interests: ["heritage"],
  transport_modes: ["road"],
};

export default function PlanForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedRegion = searchParams.get("region") ?? "";

  const [regions, setRegions] = useState<RegionOption[]>([]);
  const [regionsLoaded, setRegionsLoaded] = useState(false);
  const [cities, setCities] = useState<GraphNode[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<FormState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch("/api/regions");
        if (!res.ok) return;
        const data = (await res.json()) as { regions?: RegionOption[] };
        if (cancelled) return;
        const list = data.regions ?? [];
        setRegions(list);
        const defaultRegion =
          (preselectedRegion &&
            list.find((r) => r.region === preselectedRegion)?.region) ||
          list[0]?.region ||
          "";
        if (defaultRegion) {
          setState((s) => ({ ...s, region: defaultRegion }));
        }
      } finally {
        if (!cancelled) setRegionsLoaded(true);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state.region) return;
    let cancelled = false;
    async function run() {
      setLoadingCities(true);
      setCities([]);
      try {
        const url = `/api/nodes?region=${encodeURIComponent(state.region)}&type=city`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as { nodes?: GraphNode[] };
        if (cancelled) return;
        const list = (data.nodes ?? []).sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        setCities(list);
        const regionDefaults =
          regions.find((r) => r.region === state.region)
            ?.default_transport_modes ?? null;
        setState((s) => {
          const nextStart = list[0]?.id ?? "";
          // Align transport modes with the region's declared defaults,
          // but keep the user's selections where they overlap.
          const nextModes =
            regionDefaults && regionDefaults.length > 0
              ? (() => {
                  const overlap = s.transport_modes.filter((m) =>
                    regionDefaults.includes(m),
                  );
                  return overlap.length > 0 ? overlap : regionDefaults;
                })()
              : s.transport_modes;
          return { ...s, start_node: nextStart, transport_modes: nextModes };
        });
      } finally {
        if (!cancelled) setLoadingCities(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [state.region, regions]);

  const canSubmit = useMemo(
    () =>
      !!state.region &&
      !!state.start_node &&
      state.days >= 1 &&
      state.budget_max >= state.budget_min,
    [state],
  );

  const activeRegion = useMemo(
    () => regions.find((r) => r.region === state.region),
    [regions, state.region],
  );
  const currency = activeRegion?.default_currency ?? "INR";
  const locale = activeRegion?.default_locale ?? "en-IN";
  const formatMoney = useMemo(
    () => makeMoneyFormatter(locale, currency),
    [locale, currency],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/itinerary/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region: state.region,
          start_node: state.start_node,
          days: state.days,
          preferences: {
            travel_style: state.travel_style,
            budget: {
              min: state.budget_min,
              max: state.budget_max,
              currency,
            },
            interests: state.interests,
            transport_modes: state.transport_modes,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(friendlyError(data, res.status));
        return;
      }
      const id = data?.itinerary?.id;
      if (!id) {
        setError("Something went wrong while preparing your itinerary.");
        return;
      }
      router.push(`/itinerary/${encodeURIComponent(id)}`);
    } catch {
      setError(
        "We couldn't reach the planner. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }

  if (regionsLoaded && regions.length === 0) {
    return <EmptyState />;
  }

  return (
    <form onSubmit={handleSubmit} className="card p-6 md:p-8 space-y-8">
      {/* ----- destination ----- */}
      <Section
        title="Where are you going?"
        subtitle="Pick a region, then a city to start from."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Region">
            <select
              value={state.region}
              onChange={(e) =>
                setState((s) => ({ ...s, region: e.target.value }))
              }
              className="input"
              disabled={regions.length === 0}
            >
              {regions.map((r) => (
                <option key={r.region} value={r.region}>
                  {titleCase(r.region)}
                  {r.country ? ` · ${titleCase(r.country)}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Starting city">
            <select
              value={state.start_node}
              onChange={(e) =>
                setState((s) => ({ ...s, start_node: e.target.value }))
              }
              className="input"
              disabled={loadingCities || cities.length === 0}
            >
              {cities.length === 0 && (
                <option value="">
                  {loadingCities ? "Loading cities…" : "No cities available"}
                </option>
              )}
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {/* ----- duration + pace ----- */}
      <Section
        title="How long & how fast?"
        subtitle="Your pace shapes the route — we'll respect it."
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Field label="Trip length">
            <div className="relative">
              <input
                type="number"
                min={1}
                max={30}
                value={state.days}
                onChange={(e) =>
                  setState((s) => ({ ...s, days: Number(e.target.value) }))
                }
                className="input pr-14"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-ink-500)]">
                days
              </span>
            </div>
          </Field>

          <Field label="Travel style">
            <div className="grid gap-2 sm:grid-cols-3">
              {TRAVEL_STYLES.map((style) => {
                const copy = STYLE_COPY[style];
                const active = state.travel_style === style;
                return (
                  <button
                    key={style}
                    type="button"
                    onClick={() =>
                      setState((s) => ({ ...s, travel_style: style }))
                    }
                    aria-pressed={active}
                    className={`text-left rounded-xl border p-3.5 transition ${
                      active
                        ? "border-transparent bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-700)] text-white shadow-md"
                        : "border-[rgba(26,23,20,0.1)] bg-white hover:border-[var(--color-brand-500)]"
                    }`}
                  >
                    <p className="font-bold">{copy.label}</p>
                    <p
                      className={`text-xs mt-1 leading-snug ${
                        active ? "text-white/85" : "text-[var(--color-ink-500)]"
                      }`}
                    >
                      {copy.tagline}
                    </p>
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </Section>

      {/* ----- budget + transport ----- */}
      <Section
        title="Budget & how you get around"
        subtitle="All-in estimate per person, including stays and transport."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={`Budget (${currency} per person)`}
            hint={`${formatMoney(state.budget_min)} – ${formatMoney(state.budget_max)}`}
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={500}
                value={state.budget_min}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    budget_min: Number(e.target.value),
                  }))
                }
                className="input"
                aria-label="Minimum budget"
              />
              <span className="text-[var(--color-ink-500)]">to</span>
              <input
                type="number"
                min={0}
                step={500}
                value={state.budget_max}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    budget_max: Number(e.target.value),
                  }))
                }
                className="input"
                aria-label="Maximum budget"
              />
            </div>
          </Field>

          <Field label="How do you want to travel?">
            <div className="flex flex-wrap gap-2">
              {TRANSPORT_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="chip"
                  aria-pressed={state.transport_modes.includes(mode)}
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      transport_modes: toggle(s.transport_modes, mode),
                    }))
                  }
                >
                  {titleCase(mode)}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Section>

      {/* ----- interests ----- */}
      <Section
        title="What are you in the mood for?"
        subtitle="Pick as many as you like — we'll weight the stops accordingly."
      >
        <div className="flex flex-wrap gap-2">
          {INTEREST_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="chip"
              aria-pressed={state.interests.includes(opt.id)}
              onClick={() =>
                setState((s) => ({
                  ...s,
                  interests: toggle(s.interests, opt.id),
                }))
              }
            >
              <span aria-hidden>{opt.emoji}</span>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </Section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
        <p className="text-xs text-[var(--color-ink-500)]">
          We&apos;ll build a plan in a few seconds. You can always tweak and
          regenerate.
        </p>
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="btn-primary"
        >
          {submitting ? (
            <>
              <Spinner />
              Crafting your trip…
            </>
          ) : (
            <>
              Build my itinerary
              <ArrowRight />
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-4">
      <legend className="w-full">
        <p className="text-lg font-bold">{title}</p>
        {subtitle && (
          <p className="text-sm text-[var(--color-ink-500)] mt-0.5">
            {subtitle}
          </p>
        )}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-sm font-semibold text-[var(--color-ink-700)]">
          {label}
        </span>
        {hint && (
          <span className="text-xs text-[var(--color-ink-500)]">{hint}</span>
        )}
      </span>
      {children}
    </label>
  );
}

function EmptyState() {
  return (
    <div className="card p-10 text-center">
      <p className="text-lg font-bold">Our itineraries are being prepared.</p>
      <p className="mt-2 text-[var(--color-ink-500)] max-w-md mx-auto">
        We&apos;re putting the finishing touches on a new set of trips.
        Please check back shortly.
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m13 5 7 7-7 7" />
    </svg>
  );
}

/**
 * Build a locale + currency-aware formatter. Falls back to plain number
 * formatting if the runtime doesn't support the combination (rare).
 */
function makeMoneyFormatter(locale: string, currency: string) {
  try {
    const nf = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    return (n: number) => nf.format(Math.max(0, Number(n) || 0));
  } catch {
    return (n: number) =>
      `${currency} ${Math.max(0, Number(n) || 0).toLocaleString(locale)}`;
  }
}

function titleCase(s: string): string {
  return s
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Turn backend error codes into user-facing copy. Never surface raw
 * `constraint_violation` keys or stack traces.
 */
function friendlyError(
  payload: unknown,
  status: number,
): string {
  const data = (payload ?? {}) as {
    error?: string;
    reason?: string;
    message?: string;
    suggestion?: string;
  };

  const reasonMap: Record<string, string> = {
    travel_time_exceeded:
      "This trip needs more time on the road than your travel style allows. Try a more adventurous pace, or add a day or two.",
    total_time_exceeded:
      "A day in this plan runs too long. Try a more relaxed pace, or add a day.",
    budget_too_low:
      "This plan comes in below your minimum budget. Try lowering the minimum, adding a destination, or extending the trip.",
    budget_exceeded:
      "This trip is pushing past your budget. Try raising the upper limit, or trimming a day.",
    no_feasible_route:
      "We couldn't build a route from that city under these settings. Try a different start, a longer trip, or a slower pace.",
    insufficient_nodes:
      "There aren't enough destinations in this region yet to plan the trip you described.",
    invalid_input:
      "Please double-check your choices and try again.",
  };

  if (data.reason && reasonMap[data.reason]) {
    return [reasonMap[data.reason], data.suggestion].filter(Boolean).join(" ");
  }

  if (status === 404) return "We couldn't find that itinerary.";
  if (status >= 500) {
    return "Something went wrong on our end. Please try again in a moment.";
  }
  if (data.message) return data.message;
  return "We couldn't build that itinerary. Please adjust your choices and try again.";
}
