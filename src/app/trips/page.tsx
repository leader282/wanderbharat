import Link from "next/link";

import SignInButton from "@/components/SignInButton";
import { getCurrentUser } from "@/lib/auth/session";
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
        <h1 className="mt-3 text-4xl md:text-5xl font-black leading-[1.05]">
          {user
            ? `Welcome back${user.name ? `, ${firstName(user.name)}` : ""}.`
            : "Your saved trips live here."}
        </h1>
        <p className="mt-3 text-lg text-[var(--color-ink-700)] max-w-2xl">
          {user
            ? "Every itinerary you generate while signed in is saved to your account. Pick one up where you left it."
            : "Sign in with Google to save itineraries to your account and revisit them anytime."}
        </p>
      </header>

      <div className="mt-10">
        {user ? (
          <SignedInState userId={user.uid} />
        ) : (
          <SignedOutState />
        )}
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
      <div className="card p-10 text-center">
        <p className="text-lg font-bold">No trips yet.</p>
        <p className="mt-2 text-[var(--color-ink-500)] max-w-md mx-auto">
          Plan your first trip — it&apos;ll show up here automatically the
          moment it&apos;s generated.
        </p>
        <Link href="/plan" className="btn-primary mt-6 inline-flex">
          Plan a trip
          <ArrowRight />
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {itineraries.map((it) => (
        <li key={it.id}>
          <ItineraryCard itinerary={it} />
        </li>
      ))}
    </ul>
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
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--color-sand-100)] px-3 py-1 text-xs font-bold uppercase tracking-widest text-[var(--color-brand-700)]">
            <LockIcon /> Sign-in required
          </span>
          <h2 className="mt-4 text-2xl sm:text-3xl font-black text-[var(--color-ink-900)]">
            Sign in to see your trips.
          </h2>
          <p className="mt-2 text-[var(--color-ink-500)] max-w-md">
            Connect your Google account to save itineraries and revisit
            them anytime. Trips you generated as a guest stay accessible
            via their original link.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <SignInButton size="lg" variant="solid" />
            <Link href="/plan" className="btn-secondary">
              Plan a trip as a guest
            </Link>
          </div>

          <p className="mt-4 text-xs text-[var(--color-ink-500)]">
            We only store what&apos;s needed to attribute trips to you —
            your Google ID and basic profile.
          </p>
        </div>

        <ul className="bg-gradient-to-br from-[var(--color-sand-50)] to-white border-t md:border-t-0 md:border-l border-[rgba(26,23,20,0.06)] p-8 sm:p-10 space-y-5">
          {benefits.map((b) => (
            <li key={b.title} className="flex gap-3">
              <span
                aria-hidden
                className="grid place-items-center w-8 h-8 rounded-lg bg-white border border-[rgba(26,23,20,0.06)] text-[var(--color-brand-700)] shrink-0"
              >
                <CheckIcon />
              </span>
              <div>
                <p className="font-bold text-[var(--color-ink-900)]">
                  {b.title}
                </p>
                <p className="text-sm text-[var(--color-ink-500)] mt-0.5">
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

// ---------------------------------------------------------------------------

function ItineraryCard({ itinerary }: { itinerary: Itinerary }) {
  const stops = uniqueStops(itinerary);
  const route =
    stops.length > 0
      ? stops.length <= 3
        ? stops.join(" → ")
        : `${stops.slice(0, 2).join(" → ")} → +${stops.length - 2} more`
      : titleCase(itinerary.region);

  return (
    <Link
      href={`/itinerary/${encodeURIComponent(itinerary.id)}`}
      className="card p-5 group flex flex-col gap-4 hover:-translate-y-0.5 transition-transform h-full"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="chip" aria-hidden>
          {titleCase(itinerary.region)}
        </span>
        <span className="text-xs font-semibold text-[var(--color-ink-500)]">
          {formatDate(itinerary.created_at)}
        </span>
      </div>

      <div>
        <p className="text-2xl font-black text-[var(--color-ink-900)]">
          {itinerary.days}-day {paceAdjective(itinerary.preferences.travel_style)} trip
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-700)] line-clamp-2">
          {route}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-[0.65rem] uppercase tracking-widest font-bold text-[var(--color-ink-500)]">
            Estimated cost
          </dt>
          <dd className="mt-0.5 font-bold text-[var(--color-ink-900)]">
            {formatMoney(
              itinerary.estimated_cost,
              itinerary.preferences.budget.currency,
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[0.65rem] uppercase tracking-widest font-bold text-[var(--color-ink-500)]">
            Destinations
          </dt>
          <dd className="mt-0.5 font-bold text-[var(--color-ink-900)]">
            {stops.length || 1}
          </dd>
        </div>
      </dl>

      <p className="mt-auto text-sm font-semibold text-[var(--color-brand-700)] inline-flex items-center gap-1">
        Open itinerary
        <ArrowRight />
      </p>
    </Link>
  );
}

// ---------------------------------------------------------------------------

function uniqueStops(itinerary: Itinerary): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const day of itinerary.day_plan) {
    if (!day?.base_node_name) continue;
    if (seen.has(day.base_node_id)) continue;
    seen.add(day.base_node_id);
    out.push(day.base_node_name);
  }
  return out;
}

function formatDate(ts: number): string {
  if (!Number.isFinite(ts)) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toDateString();
  }
}

function formatMoney(value: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
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
