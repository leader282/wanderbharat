import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import "./globals.css";
import AuthHeader from "@/components/AuthHeader";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { getCurrentUser } from "@/lib/auth/session";
import { footerLinks } from "@/lib/content/launchContent";
import { resolveMetadataBase } from "@/lib/seo/siteUrl";

const defaultSiteDescription =
  "WanderBharat helps you plan practical India trips with day-by-day itineraries, route-aware travel times, and budget estimates.";
const defaultSocialImage = {
  url: "/brand/wb-og.png",
  width: 1731,
  height: 909,
  alt: "WanderBharat India trip planner preview",
} as const;

export const metadata: Metadata = {
  title: {
    default: "WanderBharat",
    template: "%s | WanderBharat",
  },
  description: defaultSiteDescription,
  metadataBase: resolveMetadataBase(),
  icons: {
    icon: "/brand/wb-logo.png",
    shortcut: "/brand/wb-logo.png",
    apple: "/brand/wb-logo.png",
  },
  openGraph: {
    title: "WanderBharat",
    description: defaultSiteDescription,
    siteName: "WanderBharat",
    locale: "en_IN",
    type: "website",
    images: [defaultSocialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "WanderBharat",
    description: defaultSiteDescription,
    images: [defaultSocialImage.url],
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? {
        google: process.env.GOOGLE_SITE_VERIFICATION,
      }
    : undefined,
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
                  WanderBharat
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
  const copyrightLine = footerLinks.copyright.replace("{year}", String(year));

  return (
    <footer className="mt-24 border-t border-[var(--hairline)] bg-[rgba(250,248,243,0.5)]">
      <div className="mx-auto max-w-6xl px-5 sm:px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Logo />
              <span className="text-[1.05rem] font-bold tracking-tight text-[var(--color-ink-900)]">
                WanderBharat
              </span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--color-ink-500)]">
              {footerLinks.tagline}
            </p>
          </div>

          {footerLinks.columns.map((column) => (
            <FooterColumn key={column.title} title={column.title} links={column.links} />
          ))}
        </div>

        <p className="mt-8 text-sm leading-relaxed text-[var(--color-ink-600)]">
          {footerLinks.betaNote}
        </p>

        <div className="mt-12 flex flex-col gap-4 border-t border-[var(--hairline)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[var(--color-ink-500)]">{copyrightLine}</p>
          <div className="inline-flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-500)]">
            {footerLinks.badges.map((badge) => (
              <span key={badge} className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-moss-600)]"
                />
                {badge}
              </span>
            ))}
          </div>
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
  links: readonly { href: string; label: string }[];
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
 * Brand logo provided as a design asset and rendered in the shared shell
 * (header + footer) for consistent identity across public pages.
 */
function Logo() {
  return (
    <span
      aria-hidden
      className="relative block h-8 w-8 overflow-hidden rounded-[10px] border border-[var(--hairline)] bg-white shadow-[0_1px_2px_rgba(20,17,13,0.18)]"
    >
      <Image
        src="/brand/wb-logo.png"
        alt=""
        fill
        sizes="32px"
        className="object-contain p-0.5"
      />
    </span>
  );
}
