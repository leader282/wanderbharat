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
      <TrustStrip />
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
    <section className="pt-12 md:pt-20">
      <div className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
        <div className="animate-fadeUp">
          <p className="eyebrow">Intelligent trip planner · India</p>
          <h1 className="mt-4 text-[2.6rem] sm:text-5xl md:text-[3.5rem] font-bold leading-[1.04] tracking-tight text-[var(--color-ink-900)]">
            India, planned
            <br className="hidden sm:block" />{" "}
            <span className="bg-[linear-gradient(120deg,var(--color-brand-700),var(--color-brand-500))] bg-clip-text text-transparent">
              the way you travel.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-[1.05rem] md:text-lg leading-relaxed text-[var(--color-ink-600)]">
            Tell us how long you have and how fast you like to move. We&apos;ll
            hand you a day-by-day plan that actually fits, plus a budget that
            feels justified — no endless blog tabs, no guesswork.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/plan" className="btn-primary">
              Plan my trip
              <ArrowRight />
            </Link>
            <Link href="#how-it-works" className="btn-secondary">
              See how it works
            </Link>
          </div>

          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-x-6 gap-y-2 border-t border-[var(--hairline)] pt-6">
            <HeroStat value="10+" label="cities mapped" />
            <HeroStat value="1–30" label="day itineraries" />
            <HeroStat value="0" label="generic tours" />
          </dl>
        </div>

        <HeroPreview />
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
        {value}
      </div>
      <div className="mt-1 text-[0.7rem] font-medium uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
        {label}
      </div>
    </div>
  );
}

/**
 * Editorial hero visual. Replaces the previous Rajasthan-coded
 * palace/dunes SVG with an abstract pan-India map preview that signals
 * the product without ethnic motifs:
 *
 *   - a calm, soft surface
 *   - a faint India outline as a confidence cue
 *   - a few route nodes connected by a smooth path
 *   - a floating "preview" card showing what the planner produces
 *
 * Designed to read as "premium travel intelligence product", not poster.
 */
function HeroPreview() {
  return (
    <div className="relative aspect-[5/6] md:aspect-[4/5] animate-fadeUp">
      <div
        aria-hidden
        className="absolute inset-0 rounded-[1.5rem] bg-[radial-gradient(120%_120%_at_0%_0%,rgba(184,136,31,0.08),transparent_55%),radial-gradient(120%_120%_at_100%_100%,rgba(15,118,112,0.07),transparent_55%),linear-gradient(180deg,#fbf9f3_0%,#f3efe5_100%)] border border-[var(--hairline)] shadow-[0_1px_2px_rgba(20,17,13,0.04),0_30px_60px_-30px_rgba(20,17,13,0.18)]"
      />

      <svg
        viewBox="0 0 400 500"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <linearGradient id="route" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#14110d" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#14110d" stopOpacity="0.35" />
          </linearGradient>
          <radialGradient id="glow" cx="50%" cy="35%" r="55%">
            <stop offset="0%" stopColor="#b8881f" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#b8881f" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="500" fill="url(#glow)" />

        {/* Stylised India silhouette — abstract, low contrast, no ethnic motifs */}
        <g
          transform="translate(110,75) scale(0.62)"
          fill="none"
          stroke="rgba(20,17,13,0.10)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        >
          <path d="M180 0 L240 35 L290 80 L325 130 L355 180 L370 230 L355 280 L320 335 L270 390 L220 445 L185 500 L150 540 L120 540 L100 510 L90 470 L70 425 L40 380 L25 330 L20 280 L25 230 L40 180 L60 135 L85 95 L120 55 L150 25 Z" />
          {/* faint hatching inside */}
          <path d="M70 200 L300 200" opacity="0.35" />
          <path d="M50 280 L320 280" opacity="0.25" />
          <path d="M70 360 L260 360" opacity="0.2" />
        </g>

        {/* route line */}
        <path
          d="M120 130 C 200 160, 240 230, 220 310 S 250 420, 300 410"
          fill="none"
          stroke="url(#route)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="0"
        />
        <path
          d="M120 130 C 200 160, 240 230, 220 310 S 250 420, 300 410"
          fill="none"
          stroke="rgba(184,136,31,0.45)"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeDasharray="3 5"
        />

        {/* route nodes */}
        <RouteNode cx={120} cy={130} label="A" />
        <RouteNode cx={235} cy={235} label="B" />
        <RouteNode cx={220} cy={335} label="C" />
        <RouteNode cx={300} cy={410} label="D" emphasis />
      </svg>

      {/* Floating preview card — feels like a real product surface */}
      <div className="absolute left-4 right-4 bottom-4 sm:left-5 sm:right-5 sm:bottom-5 card-glass p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--color-ink-900)] text-white">
            <PinIcon />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-[var(--color-brand-700)]">
                Sample plan
              </span>
              <span
                aria-hidden
                className="h-1 w-1 rounded-full bg-[var(--color-ink-400)]"
              />
              <span className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
                7 days
              </span>
            </div>
            <p className="mt-1.5 truncate text-sm font-bold text-[var(--color-ink-900)]">
              Mumbai → Hampi → Goa → Kochi
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
              Balanced pace · ~14 h on the road · justified budget
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RouteNode({
  cx,
  cy,
  label,
  emphasis,
}: {
  cx: number;
  cy: number;
  label: string;
  emphasis?: boolean;
}) {
  return (
    <g>
      {emphasis && (
        <circle
          cx={cx}
          cy={cy}
          r="14"
          fill="rgba(184,136,31,0.18)"
          stroke="none"
        />
      )}
      <circle cx={cx} cy={cy} r="7" fill="white" stroke="#14110d" strokeWidth="2" />
      <text
        x={cx}
        y={cy + 3}
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        fill="#14110d"
        fontFamily="Inter, system-ui, sans-serif"
      >
        {label}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------

function TrustStrip() {
  const items = [
    { label: "Map-aware planner" },
    { label: "Real drive times" },
    { label: "Justified budgets" },
    { label: "Day-by-day schedule" },
    { label: "Pace-aware routing" },
  ];
  return (
    <section className="mt-16 md:mt-24">
      <p className="text-center text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-500)]">
        What this planner gets right
      </p>
      <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-2.5 text-sm">
        {items.map((it, i) => (
          <li key={it.label} className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-white/70 px-3.5 py-1.5 font-medium text-[var(--color-ink-700)]">
              <CheckMini />
              {it.label}
            </span>
            {i < items.length - 1 && (
              <span
                aria-hidden
                className="hidden h-1 w-1 rounded-full bg-[var(--color-ink-400)] sm:inline-block"
              />
            )}
          </li>
        ))}
      </ul>
    </section>
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
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <p className="eyebrow">Where to go</p>
          <h2 className="mt-3 text-3xl md:text-[2.5rem] font-bold leading-[1.1] tracking-tight text-[var(--color-ink-900)]">
            Destinations we know inside-out
          </h2>
          <p className="mt-3 text-[var(--color-ink-600)]">
            Curated regions with mapped cities, drive times, and hand-picked
            highlights — ready to assemble into a real plan.
          </p>
        </div>
        <Link
          href="/plan"
          className="group inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-800)] transition-colors hover:text-[var(--color-ink-900)]"
        >
          Plan for any region
          <span
            aria-hidden
            className="transition-transform group-hover:translate-x-0.5"
          >
            <ArrowRight />
          </span>
        </Link>
      </div>

      {items.length === 0 ? (
        <DestinationsEmpty />
      ) : (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
      className="group card flex flex-col justify-between p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--hairline-strong)] hover:shadow-[var(--shadow-lift)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-sand-50)]"
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="chip" aria-hidden>
            {dest.country ? titleCase(dest.country) : "India"}
          </span>
          <span className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
            {dest.cities.length} cities
          </span>
        </div>
        <h3 className="mt-5 text-2xl font-bold capitalize tracking-tight text-[var(--color-ink-900)]">
          {titleCase(dest.region)}
        </h3>
        <p className="mt-1.5 text-sm text-[var(--color-ink-500)]">
          {summariseTags(dest.cities)}
        </p>
      </div>
      <ul className="mt-6 flex flex-wrap gap-1.5">
        {preview.map((c) => (
          <li
            key={c.id}
            className="rounded-md border border-[var(--hairline)] bg-[var(--color-sand-50)] px-2.5 py-1 text-xs font-semibold text-[var(--color-ink-700)]"
          >
            {c.name}
          </li>
        ))}
        {dest.cities.length > preview.length && (
          <li className="px-2.5 py-1 text-xs font-semibold text-[var(--color-ink-500)]">
            +{dest.cities.length - preview.length} more
          </li>
        )}
      </ul>
      <p className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-900)] transition-transform group-hover:translate-x-0.5">
        Start planning
        <ArrowRight />
      </p>
    </Link>
  );
}

function DestinationsEmpty() {
  return (
    <div className="mt-10 card p-10 text-center">
      <p className="text-lg font-bold text-[var(--color-ink-900)]">
        Fresh destinations coming soon.
      </p>
      <p className="mt-2 mx-auto max-w-md text-[var(--color-ink-500)]">
        We&apos;re finalising the first set of itineraries. Check back
        shortly — or jump in and start a plan, we&apos;ll handle the rest.
      </p>
      <Link href="/plan" className="btn-primary mt-7 inline-flex">
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
      <div className="max-w-2xl">
        <p className="eyebrow">How it works</p>
        <h2 className="mt-3 text-3xl md:text-[2.5rem] font-bold leading-[1.1] tracking-tight text-[var(--color-ink-900)]">
          From a blank page to a ready-to-travel itinerary in under a minute.
        </h2>
      </div>

      <ol className="mt-10 grid gap-5 md:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={i}
            className="card flex flex-col gap-5 p-6 transition-shadow hover:shadow-[var(--shadow-lift)]"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--color-ink-900)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <span className="block h-5 w-5">{s.icon}</span>
            </span>
            <div>
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.22em] text-[var(--color-brand-700)]">
                Step {String(i + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-1.5 text-xl font-bold text-[var(--color-ink-900)]">
                {s.title}
              </h3>
              <p className="mt-2 leading-relaxed text-[var(--color-ink-500)]">
                {s.body}
              </p>
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
    <div className="rounded-2xl border border-[var(--hairline)] bg-white/70 p-5">
      <p className="font-bold text-[var(--color-ink-900)]">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-500)]">
        {body}
      </p>
    </div>
  );
}

function ClosingCTA() {
  return (
    <section className="mt-24 md:mt-32">
      <div className="relative overflow-hidden rounded-[1.75rem] border border-[var(--color-ink-900)] bg-[radial-gradient(120%_120%_at_0%_0%,rgba(184,136,31,0.18),transparent_50%),radial-gradient(120%_120%_at_100%_100%,rgba(15,118,112,0.16),transparent_50%),linear-gradient(180deg,#1a1714_0%,#0a0805_100%)] p-10 md:p-14 text-white shadow-[0_30px_60px_-25px_rgba(20,17,13,0.45)]">
        <span
          aria-hidden
          className="absolute left-10 top-0 h-[2px] w-16 bg-[var(--color-brand-500)] opacity-90 md:left-14"
        />

        <div className="relative max-w-2xl">
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[var(--color-brand-300)]">
            Ready when you are
          </p>
          <h2 className="mt-4 text-3xl md:text-[2.6rem] font-bold leading-[1.1] tracking-tight">
            Build a proper itinerary in a minute.
          </h2>
          <p className="mt-4 max-w-xl text-base md:text-[1.05rem] leading-relaxed text-white/75">
            Your next trip deserves more than a Google Doc of links. Get a
            day-by-day plan that fits your pace, with a budget that&apos;s
            actually defensible.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/plan"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-[var(--color-ink-900)] shadow-[0_10px_24px_-12px_rgba(255,255,255,0.4)] transition-transform hover:-translate-y-0.5"
            >
              Plan my trip
              <ArrowRight />
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white/85 transition-colors hover:border-white/40 hover:text-white"
            >
              See how it works
            </Link>
          </div>
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

function CheckMini() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--color-moss-600)]"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
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
