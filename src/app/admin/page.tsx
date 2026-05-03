import Link from "next/link";

const MODULES: Array<{ href: string; title: string; blurb: string }> = [
  {
    href: "/admin/data-quality",
    title: "Data quality dashboard",
    blurb: "Inspect freshness, confidence, and missing-field coverage.",
  },
  {
    href: "/admin/attractions",
    title: "Attraction records",
    blurb: "Review attraction metadata and source provenance.",
  },
  {
    href: "/admin/attraction-hours",
    title: "Attraction hours",
    blurb: "Track opening-hours status and manual verification backlog.",
  },
  {
    href: "/admin/attraction-costs",
    title: "Attraction costs",
    blurb: "Audit admission costs with unknown/estimated/verified states.",
  },
  {
    href: "/admin/hotels",
    title: "Hotels",
    blurb: "Manage hotel snapshot ingestion and cached-rate visibility.",
  },
  {
    href: "/admin/liteapi-test",
    title: "LiteAPI test console",
    blurb: "Validate LiteAPI lookups before pipeline integration runs.",
  },
  // Import / export module is hidden until the page exits placeholder
  // status. Reseed/purge live in `npm run db:purge` + `seed:*` scripts.
];

export default function AdminHomePage() {
  return (
    <section className="space-y-5">
      <div className="card p-6 sm:p-8">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
          Admin control plane
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
          Real-data prototype v2
        </h2>
        <p className="mt-3 max-w-2xl text-[var(--color-ink-600)]">
          This area is now protected by server-side admin checks and is ready
          for tooling around data quality, attraction metadata, and hotel
          snapshot workflows.
        </p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2">
        {MODULES.map((module) => (
          <li key={module.href}>
            <Link
              href={module.href}
              className="card block h-full p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]"
            >
              <h3 className="text-lg font-bold tracking-tight text-[var(--color-ink-900)]">
                {module.title}
              </h3>
              <p className="mt-2 text-sm text-[var(--color-ink-600)]">
                {module.blurb}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
