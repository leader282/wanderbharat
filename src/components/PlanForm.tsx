"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import SignInButton from "@/components/SignInButton";
import { useAuth } from "@/lib/auth/AuthProvider";
import { makeAutoBudget } from "@/lib/itinerary/budget";
import {
  ACCOMMODATION_PREFERENCES,
  TRANSPORT_MODES,
  TRAVEL_STYLES,
  type AccommodationPreference,
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
  accommodationPreference: AccommodationPreference;
  interests: string[];
  transport_modes: TransportMode[];
  prioritize_city_coverage: boolean;
  /** "HH:MM" 24-hour clock used to render the daily plan. */
  preferred_start_time: string;
}

const START_TIME_OPTIONS: {
  id: string;
  label: string;
  tagline: string;
}[] = [
  { id: "07:00", label: "Early bird", tagline: "Out the door by 7. Beat crowds, catch sunrise." },
  { id: "09:00", label: "Standard", tagline: "A 9 AM start — comfortable for most people." },
  { id: "10:00", label: "Slow morning", tagline: "Sleep in, take it easy, ease into the day." },
];

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

const ACCOMMODATION_COPY: Record<
  AccommodationPreference,
  { label: string; tagline: string }
> = {
  auto: {
    label: "Auto",
    tagline: "Let the planner balance value, rating, and fit city by city.",
  },
  budget: {
    label: "Budget",
    tagline: "Prioritise lower nightly rates and simpler properties.",
  },
  midrange: {
    label: "Midrange",
    tagline: "Aim for comfortable, well-rated stays without overshooting.",
  },
  premium: {
    label: "Premium",
    tagline: "Prefer higher-end, resort, and heritage-style options.",
  },
};

const INITIAL_STATE: FormState = {
  region: "",
  start_node: "",
  days: 5,
  travel_style: "balanced",
  accommodationPreference: "auto",
  interests: ["heritage"],
  transport_modes: ["road"],
  prioritize_city_coverage: false,
  preferred_start_time: "09:00",
};

const TRIP_LENGTH_OPTIONS = [3, 4, 5, 6, 7] as const;

export default function PlanForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedRegion = searchParams.get("region") ?? "";
  const { user, getIdToken } = useAuth();

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
      state.days >= 1,
    [state],
  );

  const activeRegion = useMemo(
    () => regions.find((r) => r.region === state.region),
    [regions, state.region],
  );
  const currency = activeRegion?.default_currency ?? "INR";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      // Belt-and-braces: the session cookie usually authenticates this
      // request, but if it's missing/expired the bearer token still
      // lets the server attribute the itinerary to the right user.
      const idToken = await getIdToken();
      if (idToken) headers.Authorization = `Bearer ${idToken}`;

      const res = await fetch("/api/itinerary/generate", {
        method: "POST",
        headers,
        body: JSON.stringify({
          regions: [state.region],
          start_node: state.start_node,
          days: state.days,
          preferences: {
            travel_style: state.travel_style,
            budget: makeAutoBudget(currency),
            accommodationPreference: state.accommodationPreference,
            interests: state.interests,
            transport_modes: state.transport_modes,
            prioritize_city_coverage: state.prioritize_city_coverage,
            preferred_start_time: state.preferred_start_time,
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
    <form onSubmit={handleSubmit} className="card p-6 md:p-8 space-y-9">
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
            <select
              value={state.days}
              onChange={(e) =>
                setState((s) => ({ ...s, days: Number(e.target.value) }))
              }
              className="input"
            >
              {TRIP_LENGTH_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </Field>

          <div className="space-y-4">
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
                      className="tile"
                    >
                      <p className="font-bold">{copy.label}</p>
                      <p className="tile-sub mt-1 text-xs leading-snug">
                        {copy.tagline}
                      </p>
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="When does your day start?">
              <div className="grid gap-2 sm:grid-cols-3">
                {START_TIME_OPTIONS.map((opt) => {
                  const active = state.preferred_start_time === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        setState((s) => ({
                          ...s,
                          preferred_start_time: opt.id,
                        }))
                      }
                      aria-pressed={active}
                      className="tile"
                    >
                      <p className="font-bold">
                        {opt.label}{" "}
                        <span
                          className={`font-mono text-xs font-semibold ${
                            active
                              ? "text-white/75"
                              : "text-[var(--color-ink-500)]"
                          }`}
                        >
                          {formatStartTimeLabel(opt.id)}
                        </span>
                      </p>
                      <p className="tile-sub mt-1 text-xs leading-snug">
                        {opt.tagline}
                      </p>
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Trip planning priority">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--hairline)] bg-white px-4 py-3 transition-colors hover:border-[var(--color-ink-700)]">
                <input
                  type="checkbox"
                  checked={state.prioritize_city_coverage}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      prioritize_city_coverage: e.target.checked,
                    }))
                  }
                  className="mt-1 h-4 w-4 rounded border-[var(--hairline-strong)] accent-[var(--color-ink-900)]"
                />
                <div>
                  <p className="font-semibold text-[var(--color-ink-900)]">
                    Cover more cities
                  </p>
                  <p className="mt-1 text-sm text-[var(--color-ink-500)]">
                    When this is on, we&apos;ll favour covering more cities over
                    squeezing every attraction into one stop. Expect more time on
                    the road.
                  </p>
                </div>
              </label>
            </Field>
          </div>
        </div>
      </Section>

      <Section
        title="Where do you want to stay?"
        subtitle="This preference guides the hotel selector after the route is locked."
      >
        <Field label="Accommodation preference">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {ACCOMMODATION_PREFERENCES.map((preference) => {
              const copy = ACCOMMODATION_COPY[preference];
              const active = state.accommodationPreference === preference;

              return (
                <button
                  key={preference}
                  type="button"
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      accommodationPreference: preference,
                    }))
                  }
                  aria-pressed={active}
                  className="tile"
                >
                  <p className="font-bold">{copy.label}</p>
                  <p className="tile-sub mt-1 text-xs leading-snug">
                    {copy.tagline}
                  </p>
                </button>
              );
            })}
          </div>
        </Field>
      </Section>

      {/* ----- transport ----- */}
      <Section
        title="How do you want to get around?"
        subtitle="We&apos;ll calculate a justified per-person budget once we map the route."
      >
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

      <SaveTripCallout user={user} />

      <div className="flex items-center justify-end pt-1">
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

/**
 * Soft callout above the submit button. Tells the user where their
 * itinerary is going to live, and offers a sign-in button if they're
 * a guest. Designed to encourage but never block.
 */
function SaveTripCallout({
  user,
}: {
  user: ReturnType<typeof useAuth>["user"];
}) {
  if (user) {
    const initial = (user.name || user.email || "?")
      .trim()
      .charAt(0)
      .toUpperCase();
    const label = user.name?.trim().split(/\s+/)[0] ?? user.email ?? "you";
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[var(--hairline)] bg-[var(--color-sand-50)] px-4 py-3">
        {user.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.picture}
            alt=""
            width={28}
            height={28}
            className="rounded-full object-cover ring-2 ring-white"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            aria-hidden
            className="grid place-items-center w-7 h-7 rounded-full bg-[var(--color-ink-900)] text-white text-xs font-bold"
          >
            {initial}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--color-ink-900)]">
            Saving to your account
          </p>
          <p className="text-xs text-[var(--color-ink-500)] truncate">
            We&apos;ll add this trip to {label}&apos;s itineraries the moment
            it&apos;s ready.
          </p>
        </div>
        <CheckBadge />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--hairline-strong)] bg-[var(--color-sand-50)] p-4 sm:p-5">
      <div className="flex items-start gap-3 sm:gap-4">
        <span
          aria-hidden
          className="grid place-items-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white text-[var(--color-ink-900)] border border-[var(--hairline)] shadow-sm shrink-0"
        >
          <BookmarkIcon />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[var(--color-ink-900)]">
            Save your trip to come back to it
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-600)]">
            Sign in with Google and every itinerary you build will land in
            your trips. Skip if you just want a one-off plan — the link
            still works.
          </p>
        </div>
        <div className="hidden sm:block shrink-0">
          <SignInButton size="md" />
        </div>
      </div>
      <div className="mt-3 sm:hidden">
        <SignInButton size="md" className="w-full" />
      </div>
    </div>
  );
}

function CheckBadge() {
  return (
    <span
      aria-hidden
      className="grid place-items-center w-7 h-7 rounded-full bg-[var(--color-moss-600)] text-white shrink-0"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

function BookmarkIcon() {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
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

function titleCase(s: string): string {
  return s
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatStartTimeLabel(value: string): string {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return value;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
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
