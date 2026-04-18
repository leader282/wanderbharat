import Link from "next/link";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { GraphNode } from "@/types/domain";

export const dynamic = "force-dynamic";

export default async function Home() {
  const destinations = await loadDestinationHighlights();

  return (
    <>
      <Hero />
      <Destinations items={destinations} />
      <HowItWorks />
      <ClosingCTA />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section className="pt-10 md:pt-16">
      <div className="grid gap-12 md:grid-cols-[1.15fr_0.85fr] items-center">
        <div className="animate-fadeUp">
          <p className="eyebrow">Trip planner · India</p>
          <h1 className="mt-3 text-5xl md:text-[3.5rem] leading-[1.04] font-black text-[var(--color-ink-900)]">
            India, planned <br />
            <span className="bg-gradient-to-r from-[var(--color-brand-500)] to-[var(--color-brand-700)] bg-clip-text text-transparent">
              the way you travel.
            </span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-[var(--color-ink-700)] max-w-xl leading-relaxed">
            Tell us how long you have and how fast you like to move. We&apos;ll
            hand you a day-by-day plan that actually fits, plus a budget that
            feels justified — no endless blog tabs, no guesswork.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/plan" className="btn-primary">
              Plan my trip
              <ArrowRight />
            </Link>
            <Link href="#how-it-works" className="btn-secondary">
              See how it works
            </Link>
          </div>

          <dl className="mt-12 grid grid-cols-3 gap-6 max-w-md">
            <HeroStat value="10+" label="cities mapped" />
            <HeroStat value="1–30" label="day itineraries" />
            <HeroStat value="0" label="generic tours" />
          </dl>
        </div>

        <HeroArt />
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-3xl font-black text-[var(--color-ink-900)]">{value}</div>
      <div className="text-xs uppercase tracking-widest text-[var(--color-ink-500)] mt-1">
        {label}
      </div>
    </div>
  );
}

function HeroArt() {
  return (
    <div className="relative aspect-[5/6] md:aspect-[4/5] animate-fadeUp">
      <div className="absolute inset-0 rounded-[1.5rem] bg-gradient-to-br from-[var(--color-brand-300)] via-[var(--color-brand-500)] to-[var(--color-brand-900)] shadow-xl" />
      <svg
        viewBox="0 0 400 500"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <radialGradient id="sun" cx="50%" cy="30%" r="40%">
            <stop offset="0%" stopColor="#fff3d6" />
            <stop offset="60%" stopColor="#fff3d6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#fff3d6" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="500" fill="url(#sun)" />
        {/* dunes / silhouettes */}
        <path
          d="M0,380 C80,340 140,400 220,360 C290,330 340,390 400,360 L400,500 L0,500 Z"
          fill="rgba(26,23,20,0.18)"
        />
        <path
          d="M0,420 C100,380 180,440 260,410 C320,390 360,430 400,410 L400,500 L0,500 Z"
          fill="rgba(26,23,20,0.28)"
        />
        {/* palace silhouette */}
        <g fill="rgba(26,23,20,0.42)" transform="translate(230,280)">
          <rect x="0" y="20" width="120" height="80" />
          <rect x="0" y="100" width="120" height="40" />
          <path d="M0,20 L20,0 L40,20 Z" />
          <path d="M40,20 L60,0 L80,20 Z" />
          <path d="M80,20 L100,0 L120,20 Z" />
          <rect x="15" y="60" width="12" height="40" fill="rgba(251,246,234,0.25)" />
          <rect x="54" y="60" width="12" height="40" fill="rgba(251,246,234,0.25)" />
          <rect x="93" y="60" width="12" height="40" fill="rgba(251,246,234,0.25)" />
        </g>
        {/* small dome */}
        <g fill="rgba(26,23,20,0.5)" transform="translate(80,320)">
          <path d="M0,40 C0,20 20,0 40,0 C60,0 80,20 80,40 Z" />
          <rect x="0" y="40" width="80" height="40" />
          <rect x="30" y="-12" width="20" height="14" />
          <rect x="36" y="-20" width="8" height="10" />
        </g>
      </svg>

      <div className="absolute left-4 right-4 bottom-4 card-solid p-4 flex items-center gap-3">
        <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--color-brand-500)] text-white">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </span>
        <div>
          <p className="font-bold text-sm leading-tight">Jaipur → Udaipur → Jodhpur</p>
          <p className="text-xs text-[var(--color-ink-500)]">
            A balanced 7-day loop · 18 hours of travel
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

async function loadDestinationHighlights() {
  try {
    const snap = await getAdminDb()
      .collection(COLLECTIONS.nodes)
      .where("type", "==", "city")
      .limit(500)
      .get();

    const byRegion = new Map<
      string,
      { region: string; country: string; cities: GraphNode[] }
    >();
    for (const doc of snap.docs) {
      const data = doc.data() as GraphNode;
      if (!data.region) continue;
      const key = `${data.country}-${data.region}`;
      const entry =
        byRegion.get(key) ??
        { region: data.region, country: data.country, cities: [] as GraphNode[] };
      entry.cities.push(data);
      byRegion.set(key, entry);
    }

    return Array.from(byRegion.values())
      .map((r) => ({
        ...r,
        cities: r.cities.sort(
          (a, b) =>
            Number(b.metadata.recommended_hours ?? 0) -
            Number(a.metadata.recommended_hours ?? 0),
        ),
      }))
      .sort((a, b) => b.cities.length - a.cities.length);
  } catch {
    return [];
  }
}

interface Destination {
  region: string;
  country: string;
  cities: GraphNode[];
}

function Destinations({ items }: { items: Destination[] }) {
  return (
    <section id="destinations" className="mt-24 md:mt-32 scroll-mt-24">
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p className="eyebrow">Where to go</p>
          <h2 className="mt-2 text-3xl md:text-4xl font-black">
            Destinations we know inside-out
          </h2>
          <p className="mt-2 text-[var(--color-ink-500)] max-w-xl">
            Curated regions with mapped cities, drive times, and hand-picked
            highlights.
          </p>
        </div>
        <Link href="/plan" className="text-sm font-semibold text-[var(--color-brand-700)]">
          Plan for any region →
        </Link>
      </div>

      {items.length === 0 ? (
        <DestinationsEmpty />
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => (
            <DestinationCard key={`${r.country}-${r.region}`} dest={r} />
          ))}
        </div>
      )}
    </section>
  );
}

function DestinationCard({ dest }: { dest: Destination }) {
  const preview = dest.cities.slice(0, 4);
  return (
    <Link
      href={`/plan?region=${encodeURIComponent(dest.region)}`}
      className="card p-6 group flex flex-col justify-between hover:-translate-y-0.5 transition-transform"
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="chip" aria-hidden>
            {dest.country ? titleCase(dest.country) : "India"}
          </span>
          <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-ink-500)]">
            {dest.cities.length} cities
          </span>
        </div>
        <h3 className="mt-4 text-2xl font-black capitalize">
          {titleCase(dest.region)}
        </h3>
        <p className="mt-1 text-sm text-[var(--color-ink-500)]">
          {summariseTags(dest.cities)}
        </p>
      </div>
      <ul className="mt-5 flex flex-wrap gap-1.5">
        {preview.map((c) => (
          <li
            key={c.id}
            className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[var(--color-sand-100)] text-[var(--color-ink-700)]"
          >
            {c.name}
          </li>
        ))}
        {dest.cities.length > preview.length && (
          <li className="text-xs font-semibold px-2.5 py-1 text-[var(--color-ink-500)]">
            +{dest.cities.length - preview.length} more
          </li>
        )}
      </ul>
      <p className="mt-6 text-sm font-semibold text-[var(--color-brand-700)] group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
        Start planning <ArrowRight />
      </p>
    </Link>
  );
}

function DestinationsEmpty() {
  return (
    <div className="mt-8 card p-10 text-center">
      <p className="text-lg font-bold">Fresh destinations coming soon.</p>
      <p className="mt-2 text-[var(--color-ink-500)] max-w-md mx-auto">
        We&apos;re finalising the first set of itineraries. Check back
        shortly — or jump in and start a plan, we&apos;ll handle the rest.
      </p>
      <Link href="/plan" className="btn-primary mt-6 inline-flex">
        Start a plan
        <ArrowRight />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------

function HowItWorks() {
  const steps = [
    {
      title: "Tell us the basics",
      body:
        "Pick a starting city, how many days you have, and your travel style.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
      ),
    },
    {
      title: "We build the route",
      body:
        "A real map-aware planner chooses cities and sequences them to respect your pace.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" /><path d="M9 3v15" /><path d="M15 6v15" /></svg>
      ),
    },
    {
      title: "You travel with a plan",
      body:
        "Day-by-day stops, drive times, activity hours, and a justified budget range — ready to go.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
      ),
    },
  ];

  return (
    <section id="how-it-works" className="mt-24 md:mt-32 scroll-mt-24">
      <p className="eyebrow">How it works</p>
      <h2 className="mt-2 text-3xl md:text-4xl font-black max-w-2xl">
        From a blank page to a ready-to-travel itinerary in under a minute.
      </h2>

      <ol className="mt-10 grid gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className="card p-6 flex flex-col gap-4">
            <span className="grid place-items-center w-10 h-10 rounded-lg bg-[var(--color-sand-100)] text-[var(--color-brand-700)]">
              <span className="block w-5 h-5">{s.icon}</span>
            </span>
            <div>
              <p className="text-xs font-bold text-[var(--color-ink-500)] tracking-widest uppercase">
                Step {i + 1}
              </p>
              <h3 className="mt-1 text-xl font-bold">{s.title}</h3>
              <p className="mt-2 text-[var(--color-ink-500)]">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Bullet title="Respects your pace" body="Relaxed, balanced, or adventurous — the plan follows your tempo." />
        <Bullet title="Budget aware" body="Every itinerary comes with a justified budget range and a clear explanation of where the money goes." />
        <Bullet title="Real drive times" body="Stops are chosen with actual road distances, not wishful thinking." />
        <Bullet title="Always a fresh plan" body="Generated on the spot from your exact preferences." />
      </div>
    </section>
  );
}

function Bullet({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-5 rounded-xl border border-[rgba(26,23,20,0.06)] bg-white/60">
      <p className="font-bold">{title}</p>
      <p className="mt-1 text-sm text-[var(--color-ink-500)]">{body}</p>
    </div>
  );
}

function ClosingCTA() {
  return (
    <section className="mt-24 md:mt-32">
      <div className="relative overflow-hidden rounded-[1.75rem] p-10 md:p-14 bg-gradient-to-br from-[var(--color-brand-500)] via-[var(--color-brand-600)] to-[var(--color-brand-900)] text-white shadow-xl">
        <div className="absolute inset-0 opacity-30 pointer-events-none">
          <svg viewBox="0 0 800 300" className="w-full h-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
            <path d="M0,220 C150,180 300,240 450,210 C600,180 720,230 800,210 L800,300 L0,300 Z" fill="rgba(0,0,0,0.25)" />
            <path d="M0,250 C150,220 320,270 470,250 C620,230 720,260 800,250 L800,300 L0,300 Z" fill="rgba(0,0,0,0.25)" />
          </svg>
        </div>
        <div className="relative max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-black leading-tight">
            Ready when you are.
          </h2>
          <p className="mt-3 text-white/85 text-lg">
            Your next trip deserves more than a Google Doc of links. Build a
            proper itinerary in a minute.
          </p>
          <Link
            href="/plan"
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white text-[var(--color-ink-900)] px-5 py-3 font-bold shadow-lg hover:shadow-xl transition-shadow"
          >
            Plan my trip
            <ArrowRight />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

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

function summariseTags(cities: GraphNode[]): string {
  const tagCount = new Map<string, number>();
  for (const c of cities) {
    for (const t of c.tags ?? []) {
      tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
  }
  const top = Array.from(tagCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => titleCase(t));
  return top.length > 0 ? top.join(" · ") : "Handpicked routes & experiences";
}
