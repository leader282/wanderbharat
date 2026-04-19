import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";
import AuthHeader from "@/components/AuthHeader";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "wanderbharat — thoughtfully planned trips across India",
  description:
    "Tell us how long you have and how you like to travel. We'll build a day-by-day itinerary that actually fits, then recommend a budget that feels justified.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const currentUser = await getCurrentUser();
  const initialUser = currentUser
    ? {
        uid: currentUser.uid,
        email: currentUser.email,
        name: currentUser.name,
        picture: currentUser.picture,
      }
    : null;

  return (
    <html lang="en">
      <body>
        <AuthProvider initialUser={initialUser}>
          <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-[rgba(250,248,243,0.78)] backdrop-blur-md supports-[backdrop-filter]:bg-[rgba(250,248,243,0.7)]">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-5 sm:px-6 py-3.5">
              <Link
                href="/"
                className="group flex items-center gap-2.5 rounded-lg -ml-1 px-1 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]/40"
              >
                <Logo />
                <span className="text-[1.05rem] font-bold tracking-tight text-[var(--color-ink-900)]">
                  wanderbharat
                </span>
              </Link>
              <nav className="flex items-center gap-0.5 sm:gap-1 text-sm">
                <Link
                  href="/#destinations"
                  className="hidden sm:inline-flex rounded-md px-3 py-2 font-medium text-[var(--color-ink-700)] transition-colors hover:text-[var(--color-ink-900)]"
                >
                  Destinations
                </Link>
                <Link
                  href="/#how-it-works"
                  className="hidden sm:inline-flex rounded-md px-3 py-2 font-medium text-[var(--color-ink-700)] transition-colors hover:text-[var(--color-ink-900)]"
                >
                  How it works
                </Link>
                {initialUser && (
                  <Link
                    href="/trips"
                    className="hidden sm:inline-flex rounded-md px-3 py-2 font-medium text-[var(--color-ink-700)] transition-colors hover:text-[var(--color-ink-900)]"
                  >
                    My trips
                  </Link>
                )}
                <Link
                  href="/plan"
                  className="btn-primary ml-2 px-3.5 py-2 text-sm"
                >
                  Plan a trip
                </Link>
                <AuthHeader />
              </nav>
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-5 sm:px-6 pb-24">
            {children}
          </main>

          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t border-[var(--hairline)] bg-[rgba(250,248,243,0.5)]">
      <div className="mx-auto max-w-6xl px-5 sm:px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Logo />
              <span className="text-[1.05rem] font-bold tracking-tight text-[var(--color-ink-900)]">
                wanderbharat
              </span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--color-ink-500)]">
              An intelligent, map-aware tour planner for India. Day-by-day
              itineraries that respect your pace, with budgets that feel
              justified.
            </p>
          </div>

          <FooterColumn
            title="Product"
            links={[
              { href: "/plan", label: "Plan a trip" },
              { href: "/#destinations", label: "Destinations" },
              { href: "/#how-it-works", label: "How it works" },
              { href: "/trips", label: "My trips" },
            ]}
          />

          <FooterColumn
            title="Why us"
            links={[
              { href: "/#how-it-works", label: "Map-aware planner" },
              { href: "/#how-it-works", label: "Justified budgets" },
              { href: "/#how-it-works", label: "Real drive times" },
            ]}
          />

          <FooterColumn
            title="Trust"
            links={[
              { href: "/", label: "About" },
              { href: "/", label: "Privacy" },
              { href: "/", label: "Terms" },
            ]}
          />
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-[var(--hairline)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[var(--color-ink-500)]">
            © {year} wanderbharat. Thoughtfully planned trips across India.
          </p>
          <p className="inline-flex items-center gap-2 text-xs text-[var(--color-ink-500)]">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-moss-600)]"
            />
            Made in India
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
        {title}
      </p>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={`${title}-${link.label}`}>
            <Link
              href={link.href}
              className="text-sm font-medium text-[var(--color-ink-700)] transition-colors hover:text-[var(--color-ink-900)]"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Refined monogram. Charcoal surface with a single hairline gold accent —
 * reads as "premium product", not "tourism brochure". The compass-like
 * mark hints at travel/navigation without ethnic motifs.
 */
function Logo() {
  return (
    <span
      aria-hidden
      className="relative grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--color-ink-900)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_2px_rgba(20,17,13,0.18)]"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[15px] w-[15px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" opacity="0.45" />
        <path
          d="M12 3 L14.4 12 L12 21 L9.6 12 Z"
          fill="currentColor"
          stroke="none"
        />
      </svg>
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-px left-1/2 h-px w-3 -translate-x-1/2 rounded-full bg-[var(--color-brand-500)] opacity-80"
      />
    </span>
  );
}
