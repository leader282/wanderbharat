"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import SignInButton from "@/components/SignInButton";
import { presentGenerateItineraryError } from "@/lib/api/generateItineraryError";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  formatClockTimeLabel,
  titleCaseWords,
} from "@/lib/itinerary/presentation";
import {
  normalisePlanFormNumberInput,
  parsePlanFormNumberInput,
  type PlanFormNumberValue,
} from "@/lib/planFormNumberFields";
import {
  ACCOMMODATION_PREFERENCES,
  DEFAULT_CURRENCY,
  DEFAULT_GUEST_NATIONALITY,
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
  requested_city_ids: string[];
  trip_start_date: string;
  adults: PlanFormNumberValue;
  children: PlanFormNumberValue;
  children_ages: string[];
  rooms: PlanFormNumberValue;
  guest_nationality: string;
  total_budget: PlanFormNumberValue;
  days: number;
  travel_style: TravelStyle;
  accommodation_preference: AccommodationPreference;
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
  requested_city_ids: [],
  trip_start_date: todayLocalDateInput(),
  adults: 1,
  children: 0,
  children_ages: [],
  rooms: 1,
  guest_nationality: DEFAULT_GUEST_NATIONALITY,
  total_budget: 30000,
  days: 5,
  travel_style: "balanced",
  accommodation_preference: "auto",
  interests: ["heritage"],
  transport_modes: ["road"],
  prioritize_city_coverage: false,
  preferred_start_time: "09:00",
};

const TRIP_LENGTH_OPTIONS = [3, 4, 5, 6, 7] as const;

function todayLocalDateInput(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function parseGuestNationality(value: string): string | null {
  const cleaned = value.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(cleaned)) return cleaned;
  return null;
}

function resizeChildAgeInputs(current: string[], childrenCount: number): string[] {
  if (childrenCount <= 0) return [];
  if (current.length === childrenCount) return current;
  const next = current.slice(0, childrenCount);
  while (next.length < childrenCount) next.push("");
  return next;
}

function areValidChildAges(childrenAges: string[], childrenCount: number): boolean {
  return normaliseChildAges(childrenAges, childrenCount) !== null;
}

function normaliseChildAges(
  childrenAges: string[],
  childrenCount: number,
): number[] | null {
  if (childrenCount <= 0) return [];
  if (childrenAges.length !== childrenCount) return null;
  const normalised: number[] = [];
  for (const ageValue of childrenAges) {
    const trimmed = ageValue.trim();
    if (trimmed === "") return null;
    const parsedAge = Number(trimmed);
    if (!Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 17) {
      return null;
    }
    normalised.push(parsedAge);
  }
  return normalised;
}

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
          const nextRequested = s.requested_city_ids.filter(
            (cityId) => cityId !== nextStart && list.some((city) => city.id === cityId),
          );
          return {
            ...s,
            start_node: nextStart,
            requested_city_ids: nextRequested,
            transport_modes: nextModes,
          };
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
      isValidLocalDate(state.trip_start_date) &&
      state.days >= 1 &&
      typeof state.total_budget === "number" &&
      state.total_budget > 0 &&
      typeof state.adults === "number" &&
      state.adults >= 1 &&
      typeof state.children === "number" &&
      state.children >= 0 &&
      typeof state.rooms === "number" &&
      state.rooms >= 1 &&
      /^[A-Za-z]{2}$/.test(state.guest_nationality.trim()) &&
      (state.children === 0 ||
        areValidChildAges(state.children_ages, state.children)) &&
      state.transport_modes.length > 0,
    [state],
  );

  const activeRegion = useMemo(
    () => regions.find((r) => r.region === state.region),
    [regions, state.region],
  );
  const currency = activeRegion?.default_currency ?? DEFAULT_CURRENCY;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tripStartDate = state.trip_start_date.trim();
    const adults = normalisePlanFormNumberInput(state.adults, {
      min: 1,
      max: 20,
      fallback: 1,
    });
    const children = normalisePlanFormNumberInput(state.children, {
      min: 0,
      max: 20,
      fallback: 0,
    });
    const rooms = normalisePlanFormNumberInput(state.rooms, {
      min: 1,
      max: 20,
      fallback: 1,
    });
    const guestNationality = parseGuestNationality(state.guest_nationality);
    const childrenAges = normaliseChildAges(state.children_ages, children);
    const totalBudget = normalisePlanFormNumberInput(state.total_budget, {
      min: 0,
      fallback: 0,
    });

    if (
      !state.region ||
      !state.start_node ||
      !isValidLocalDate(tripStartDate) ||
      state.days < 1 ||
      totalBudget <= 0 ||
      adults < 1 ||
      children < 0 ||
      rooms < 1 ||
      guestNationality === null ||
      childrenAges === null ||
      state.transport_modes.length === 0
    ) {
      setState((s) => ({
        ...s,
        trip_start_date: tripStartDate,
        adults,
        children,
        children_ages: resizeChildAgeInputs(s.children_ages, children),
        rooms,
        guest_nationality: s.guest_nationality.trim().toUpperCase(),
        total_budget: totalBudget,
      }));
      if (!isValidLocalDate(tripStartDate)) {
        setError("Choose a valid trip start date.");
      } else if (childrenAges === null) {
        setError("Add one valid age (0-17) for each child.");
      } else if (guestNationality === null) {
        setError("Enter a valid 2-letter guest nationality code.");
      }
      return;
    }

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
          requested_city_ids: state.requested_city_ids,
          days: state.days,
          preferences: {
            travel_style: state.travel_style,
            budget: { min: 0, max: totalBudget, currency },
            trip_start_date: tripStartDate,
            travellers: {
              adults,
              children,
              children_ages: childrenAges,
              rooms,
              guest_nationality: guestNationality,
            },
            accommodation_preference: state.accommodation_preference,
            interests: state.interests,
            transport_modes: state.transport_modes,
            prioritize_city_coverage: state.prioritize_city_coverage,
            preferred_start_time: state.preferred_start_time,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(presentGenerateItineraryError(data, res.status));
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

  function toggleSelection<T extends string>(
    list: T[],
    value: T,
    minimumSelected = 0,
  ): T[] {
    return list.includes(value)
      ? list.length > minimumSelected
        ? list.filter((v) => v !== value)
        : list
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
                  {titleCaseWords(r.region)}
                  {r.country ? ` · ${titleCaseWords(r.country)}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Starting city">
            <select
              value={state.start_node}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  start_node: e.target.value,
                  requested_city_ids: s.requested_city_ids.filter(
                    (cityId) => cityId !== e.target.value,
                  ),
                }))
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

        <Field
          label="Optional extra cities"
          hint="We’ll try to include every city you pick."
        >
          <div className="flex flex-wrap gap-2">
            {cities.filter((city) => city.id !== state.start_node).length > 0 ? (
              cities
                .filter((city) => city.id !== state.start_node)
                .map((city) => (
                  <button
                    key={city.id}
                    type="button"
                    className="chip"
                    aria-pressed={state.requested_city_ids.includes(city.id)}
                    onClick={() =>
                      setState((s) => ({
                        ...s,
                        requested_city_ids: toggleSelection(
                          s.requested_city_ids,
                          city.id,
                        ),
                      }))
                    }
                  >
                    {city.name}
                  </button>
                ))
            ) : loadingCities ? (
              <p className="rounded-xl border border-[var(--hairline)] bg-[var(--color-sand-50)] px-4 py-3 text-sm text-[var(--color-ink-500)]">
                Loading the extra cities you can request for this trip.
              </p>
            ) : !state.start_node ? (
              <p className="rounded-xl border border-[var(--hairline)] bg-[var(--color-sand-50)] px-4 py-3 text-sm text-[var(--color-ink-500)]">
                Choose a starting city first to request extra stops.
              </p>
            ) : (
              <p className="rounded-xl border border-[var(--hairline)] bg-[var(--color-sand-50)] px-4 py-3 text-sm text-[var(--color-ink-500)]">
                No additional cities are available in this region yet.
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-500)]">
            If every requested city can&apos;t fit, we&apos;ll tell you which ones
            were left out and how many extra days would be needed, up to 7 days.
          </p>
        </Field>
      </Section>

      <Section
        title="Who&apos;s travelling & what&apos;s the budget?"
        subtitle="We use your group size for room selection and budget checks."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Adults">
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              inputMode="numeric"
              value={state.adults}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  adults: parsePlanFormNumberInput(e.target.value, {
                    min: 0,
                    max: 20,
                  }),
                }))
              }
              onBlur={() =>
                setState((s) => ({
                  ...s,
                  adults: normalisePlanFormNumberInput(s.adults, {
                    min: 1,
                    max: 20,
                    fallback: 1,
                  }),
                }))
              }
              className="input"
            />
          </Field>

          <Field label="Children">
            <input
              type="number"
              min={0}
              max={20}
              step={1}
              inputMode="numeric"
              value={state.children}
              onChange={(e) =>
                setState((s) => {
                  const children = parsePlanFormNumberInput(e.target.value, {
                    min: 0,
                    max: 20,
                  });
                  return {
                    ...s,
                    children,
                    children_ages:
                      typeof children === "number"
                        ? resizeChildAgeInputs(s.children_ages, children)
                        : s.children_ages,
                  };
                })
              }
              onBlur={() =>
                setState((s) => {
                  const children = normalisePlanFormNumberInput(s.children, {
                    min: 0,
                    max: 20,
                    fallback: 0,
                  });
                  return {
                    ...s,
                    children,
                    children_ages: resizeChildAgeInputs(s.children_ages, children),
                  };
                })
              }
              className="input"
            />
          </Field>

          <Field label="Rooms">
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              inputMode="numeric"
              value={state.rooms}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  rooms: parsePlanFormNumberInput(e.target.value, {
                    min: 1,
                    max: 20,
                  }),
                }))
              }
              onBlur={() =>
                setState((s) => ({
                  ...s,
                  rooms: normalisePlanFormNumberInput(s.rooms, {
                    min: 1,
                    max: 20,
                    fallback: 1,
                  }),
                }))
              }
              className="input"
            />
          </Field>

          <Field label="Guest nationality" hint="ISO code">
            <input
              type="text"
              inputMode="text"
              maxLength={2}
              value={state.guest_nationality}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  guest_nationality: e.target.value.toUpperCase(),
                }))
              }
              onBlur={() =>
                setState((s) => ({
                  ...s,
                  guest_nationality: s.guest_nationality.trim().toUpperCase(),
                }))
              }
              className="input uppercase"
              placeholder={DEFAULT_GUEST_NATIONALITY}
            />
          </Field>

          <Field label={`Total trip budget (${currency})`}>
            <input
              type="number"
              min={0}
              step={500}
              inputMode="numeric"
              value={state.total_budget}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  total_budget: parsePlanFormNumberInput(e.target.value, {
                    min: 0,
                  }),
                }))
              }
              onBlur={() =>
                setState((s) => ({
                  ...s,
                  total_budget: normalisePlanFormNumberInput(s.total_budget, {
                    min: 0,
                    fallback: 0,
                  }),
                }))
              }
              className="input"
            />
          </Field>
        </div>
        {typeof state.children === "number" && state.children > 0 && (
          <Field
            label="Children ages"
            hint={`${state.children} age${state.children === 1 ? "" : "s"} required`}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: state.children }, (_, index) => (
                <input
                  key={index}
                  type="number"
                  min={0}
                  max={17}
                  step={1}
                  inputMode="numeric"
                  value={state.children_ages[index] ?? ""}
                  onChange={(e) =>
                    setState((s) => {
                      const next = [...s.children_ages];
                      next[index] = e.target.value;
                      return { ...s, children_ages: next };
                    })
                  }
                  onBlur={() =>
                    setState((s) => {
                      const next = [...s.children_ages];
                      const current = next[index] ?? "";
                      if (current.trim() === "") return s;
                      const parsed = Number(current);
                      if (
                        Number.isInteger(parsed) &&
                        parsed >= 0 &&
                        parsed <= 17
                      ) {
                        next[index] = parsed.toString();
                      }
                      return { ...s, children_ages: next };
                    })
                  }
                  className="input"
                  placeholder={`Child ${index + 1} age`}
                  aria-label={`Child ${index + 1} age`}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--color-ink-500)]">
              Enter ages in completed years (0-17) for real pricing requests.
            </p>
          </Field>
        )}
        <p className="text-sm text-[var(--color-ink-500)]">
          We treat this as your total trip budget for the full group, not a
          per-person number.
        </p>
      </Section>

      {/* ----- duration + pace ----- */}
      <Section
        title="How long & how fast?"
        subtitle="Your pace shapes the route — we'll respect it."
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_2fr]">
          <Field label="Trip start date">
            <input
              type="date"
              value={state.trip_start_date}
              onChange={(e) =>
                setState((s) => ({ ...s, trip_start_date: e.target.value }))
              }
              className="input"
            />
          </Field>

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
                          {formatClockTimeLabel(opt.id)}
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
              const active = state.accommodation_preference === preference;

              return (
                <button
                  key={preference}
                  type="button"
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      accommodation_preference: preference,
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
        subtitle="We&apos;ll test the route and room plan against your total trip budget."
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
                    transport_modes: toggleSelection(
                      s.transport_modes,
                      mode,
                      1,
                    ),
                  }))
                }
              >
                {titleCaseWords(mode)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-500)]">
            Keep at least one transport mode selected so the planner always has a
            workable travel option.
          </p>
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
                  interests: toggleSelection(s.interests, opt.id),
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

