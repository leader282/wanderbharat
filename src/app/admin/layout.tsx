import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAdminUser } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_LINKS: Array<{ href: string; label: string }> = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/data-quality", label: "Data quality" },
  { href: "/admin/attractions", label: "Attractions" },
  { href: "/admin/attraction-hours", label: "Attraction hours" },
  { href: "/admin/attraction-costs", label: "Attraction costs" },
  { href: "/admin/hotels", label: "Hotels" },
  { href: "/admin/liteapi-test", label: "LiteAPI test" },
  { href: "/admin/import-export", label: "Import / export" },
];

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await requireAdminUser();

  if (!auth.ok && auth.reason === "unauthenticated") {
    redirect("/trips");
  }

  if (!auth.ok) {
    return (
      <section className="mt-10 md:mt-14 animate-fadeUp">
        <div className="card border-red-200 bg-red-50/60 p-7 sm:p-8">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-red-800">
            403
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-red-950">
            Admin access required
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-red-900">
            Signed in as {formatIdentity(auth.user)}. This workspace is reserved
            for accounts with `users/{auth.user.uid}.role = &quot;admin&quot;`
            in Firestore.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/trips" className="btn-secondary">
              Go to my trips
            </Link>
            <Link href="/plan" className="btn-primary">
              Plan a trip
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-10 md:mt-14 animate-fadeUp">
      <header>
        <p className="eyebrow">Admin</p>
        <h1 className="mt-3 text-4xl md:text-[3rem] font-bold leading-[1.06] tracking-tight text-[var(--color-ink-900)]">
          Data operations workspace
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-600)]">
          Manage prototype v2 ingestion, quality checks, and snapshot tooling
          from a single protected area.
        </p>
        <p className="mt-3 text-sm text-[var(--color-ink-500)]">
          Signed in as {formatIdentity(auth.user)}
        </p>
      </header>

      <div className="mt-8 grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="card h-fit p-3">
          <p className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
            Sections
          </p>
          <nav className="mt-1 flex flex-col gap-1.5">
            {ADMIN_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-ink-700)] transition-colors hover:bg-[var(--color-sand-50)] hover:text-[var(--color-ink-900)]"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

function formatIdentity(user: { name: string | null; email: string | null; uid: string }) {
  return user.name || user.email || user.uid;
}
