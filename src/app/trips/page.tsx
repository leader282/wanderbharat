import Link from "next/link";

import DeleteItineraryButton from "@/components/DeleteItineraryButton";
import SignInButton from "@/components/SignInButton";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getDisplayRouteStops,
  type DisplayRouteStop,
} from "@/lib/itinerary/routeDisplay";
import { listItinerariesForUser } from "@/lib/repositories/itineraryRepository";
import type { Itinerary } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const user = await getCurrentUser();

  return (
    <section className="mt-10 md:mt-14 animate-fadeUp">
      <header>
        <p className="eyebrow">Your trips</p>
        <h1 className="mt-3 text-4xl md:text-[3rem] font-bold leading-[1.06] tracking-tight text-[var(--color-ink-900)]">
          {user
            ? `Welcome back${user.name ? `, ${firstName(user.name)}` : ""}.`
            : "Your saved trips live here."}
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-600)]">
          {user
            ? "Every itinerary you generate while signed in is saved to your account. Pick one up where you left it."
            : "Sign in with Google to save itineraries to your account and revisit them anytime."}
        </p>
      </header>

      <div className="mt-10">
        {user ? <SignedInState userId={user.uid} /> : <SignedOutState />}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

async function SignedInState({ userId }: { userId: string }) {
  let itineraries: Itinerary[] = [];
  let loadError: string | null = null;

  try {
    itineraries = await listItinerariesForUser(userId, 50);
  } catch (err) {
    loadError = (err as Error).message;
  }

  if (loadError) {
    return (
      <div className="card p-6 border-red-200 bg-red-50/60">
        <p className="font-bold text-red-900">
          We couldn&apos;t load your trips.
        </p>
        <p className="mt-1 text-sm text-red-800">{loadError}</p>
      </div>
    );
  }

  if (itineraries.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 p-10 text-center sm:p-14">
        <span
          aria-hidden
          className="grid h-12 w-12 place-items-center rounded-2xl border border-[var(--hairline)] bg-[var(--color-sand-50)] text-[var(--color-ink-700)]"
        >
          <CompassIcon />
        </span>
        <p className="mt-1 text-lg font-bold text-[var(--color-ink-900)]">
          No trips yet.
        </p>
        <p className="max-w-md text-[var(--color-ink-500)]">
          Plan your first trip — it&apos;ll show up here automatically the
          moment it&apos;s generated.
        </p>
        <Link href="/plan" className="btn-primary mt-4 inline-flex">
          Plan a trip
          <ArrowRight />
        </Link>
      </div>
    );
  }

  return (
    <>
      <p className="mb-5 text-sm text-[var(--color-ink-500)]">
        <span className="font-semibold text-[var(--color-ink-800)]">
          {itineraries.length}
        </span>{" "}
        {itineraries.length === 1 ? "saved trip" : "saved trips"}
      </p>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {itineraries.map((it) => (
          <li key={it.id}>
            <ItineraryCard itinerary={it} />
          </li>
        ))}
      </ul>
    </>
  );
}

function SignedOutState() {
  const benefits = [
    {
      title: "All your trips, one place",
      body: "Every itinerary you generate while signed in is saved automatically.",
    },
    {
      title: "Pick up where you left off",
      body: "Reopen any trip from any device, any time — the link never changes.",
    },
    {
      title: "Nothing to set up",
      body: "Just Google sign-in. No password, no profile, no email list.",
    },
  ];

  return (
    <div className="card overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[1.1fr_0.9fr]">
        <div className="p-8 sm:p-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--color-sand-50)] px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-ink-700)]">
            <LockIcon /> Sign-in required
          </span>
          <h2 className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
            Sign in to see your trips.
          </h2>
          <p className="mt-2 max-w-md text-[var(--color-ink-500)]">
            Connect your Google account to save itineraries and revisit them
            anytime. Trips you generated as a guest stay accessible via their
            original link.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <SignInButton size="lg" variant="solid" />
            <Link href="/plan" className="btn-secondary">
              Plan a trip as a guest
            </Link>
          </div>

          <p className="mt-4 text-xs text-[var(--color-ink-500)]">
            We only store what&apos;s needed to attribute trips to you — your
            Google ID and basic profile.
          </p>
        </div>

        <ul className="space-y-5 border-t border-[var(--hairline)] bg-[var(--color-sand-50)] p-8 sm:p-10 md:border-l md:border-t-0">
          {benefits.map((b) => (
            <li key={b.title} className="flex gap-3">
              <span
                aria-hidden
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[var(--hairline)] bg-white text-[var(--color-ink-900)]"
              >
                <CheckIcon />
              </span>
              <div>
                <p className="font-bold text-[var(--color-ink-900)]">
                  {b.title}
                </p>
                <p className="mt-0.5 text-sm text-[var(--color-ink-500)]">
                  {b.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg
      aria-hidden
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}

// ---------------------------------------------------------------------------

function ItineraryCard({ itinerary }: { itinerary: Itinerary }) {
  const routeStops = getDisplayRouteStops(itinerary);
  const routeNames = routeStops.map((stop) => stop.name);
  const destinationCount =
    routeStops.length > 0 ? new Set(routeStops.map((stop) => stop.id)).size : 1;
  const route =
    routeNames.length > 0
      ? routeNames.length <= 3
        ? routeNames.join(" → ")
        : `${routeNames.slice(0, 2).join(" → ")} → +${routeNames.length - 2} more`
      : titleCase(itinerary.region);
  const tripLabel = `${itinerary.days}-day ${route || titleCase(itinerary.region)} trip`;
  const nights = Math.max(0, itinerary.days - 1);
  const savedAgo = relativeTimeFrom(itinerary.created_at);

  return (
    <article className="group relative card flex h-full flex-col overflow-hidden p-0 transition duration-200 hover:-translate-y-0.5 hover:border-[var(--hairline-strong)] hover:shadow-[var(--shadow-lift)] focus-within:-translate-y-0.5 focus-within:shadow-[var(--shadow-lift)]">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span
            className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--color-sand-50)] px-2.5 py-1 text-[0.7rem] font-semibold tracking-wide text-[var(--color-ink-700)]"
            aria-hidden
          >
            <PinIcon />
            {titleCase(itinerary.region)}
          </span>
          <p className="text-[0.7rem] font-semibold text-[var(--color-ink-500)]">
            Saved {savedAgo}
          </p>
        </div>
        <DeleteItineraryButton
          itineraryId={itinerary.id}
          tripLabel={tripLabel}
        />
      </div>

      <div className="flex flex-1 flex-col gap-5 px-5 pt-4 pb-5">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-[var(--color-ink-900)]">
            <Link
              href={`/itinerary/${encodeURIComponent(itinerary.id)}`}
              className="rounded-md outline-none after:absolute after:inset-0 after:z-0 after:rounded-[var(--radius-card)] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-[var(--color-brand-500)]/40"
            >
              {itinerary.days}-day{" "}
              {paceAdjective(itinerary.preferences.travel_style)} trip
            </Link>
          </h3>
          <p className="mt-1.5 line-clamp-2 text-sm text-[var(--color-ink-600)]">
            {route}
          </p>
        </div>

        <RouteDots stops={routeStops} />

        <dl className="grid grid-cols-3 gap-3 border-t border-[var(--hairline)] pt-4">
          <Stat
            label="Days"
            value={String(itinerary.days)}
            sub={
              nights > 0
                ? `${nights} ${nights === 1 ? "night" : "nights"}`
                : "Day trip"
            }
          />
          <Stat label="Stops" value={String(destinationCount)} />
          <Stat
            label="Cost"
            value={formatMoney(
              itinerary.estimated_cost,
              itinerary.preferences.budget.currency,
            )}
          />
        </dl>

        <p className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-900)] transition-transform duration-200 group-hover:translate-x-0.5">
          Open itinerary
          <ArrowRight />
        </p>
      </div>
    </article>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
        {label}
      </dt>
      <dd className="mt-1 truncate text-base font-bold text-[var(--color-ink-900)]">
        {value}
      </dd>
      {sub && (
        <dd className="mt-0.5 truncate text-[0.7rem] text-[var(--color-ink-500)]">
          {sub}
        </dd>
      )}
    </div>
  );
}

function RouteDots({ stops }: { stops: DisplayRouteStop[] }) {
  if (stops.length === 0) return null;

  // Show up to 4 dots inline; if more, show "+N" indicator at the end.
  const MAX = 4;
  const visible = stops.slice(0, MAX);
  const overflow = Math.max(0, stops.length - MAX);

  return (
    <div
      aria-hidden
      className="flex items-center gap-2 text-[var(--color-ink-400)]"
    >
      {visible.map((stop, i) => (
        <span key={`${stop.id}-${i}`} className="flex items-center gap-2">
          <span
            className={[
              "h-2 w-2 rounded-full",
              i === 0
                ? "bg-[var(--color-ink-900)]"
                : i === visible.length - 1 && overflow === 0
                  ? "bg-[var(--color-brand-500)]"
                  : "bg-[var(--color-ink-400)]",
            ].join(" ")}
          />
          {i < visible.length - 1 && (
            <span className="h-px w-5 bg-[var(--hairline-strong)]" />
          )}
        </span>
      ))}
      {overflow > 0 && (
        <>
          <span className="h-px w-5 bg-[var(--hairline-strong)]" />
          <span className="text-[0.65rem] font-semibold tracking-wide text-[var(--color-ink-500)]">
            +{overflow}
          </span>
        </>
      )}
    </div>
  );
}

function PinIcon() {
  return (
    <svg
      aria-hidden
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function relativeTimeFrom(ts: number): string {
  if (!Number.isFinite(ts)) return "";
  const diffMs = Date.now() - ts;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

function formatMoney(value: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
      notation: "compact",
      compactDisplay: "short",
    }).format(Math.max(0, Number(value) || 0));
  } catch {
    return `${currency} ${Math.round(Math.max(0, Number(value) || 0)).toLocaleString("en-IN")}`;
  }
}

function titleCase(s: string): string {
  if (!s) return "";
  return s
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function paceAdjective(style: string): string {
  switch (style) {
    case "relaxed":
      return "relaxed";
    case "adventurous":
      return "fast-paced";
    default:
      return "balanced";
  }
}

function ArrowRight() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="14"
      height="14"
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
