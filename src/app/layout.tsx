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
          <header className="sticky top-0 z-40 backdrop-blur-md bg-[rgba(251,246,234,0.75)] border-b border-[rgba(26,23,20,0.05)]">
            <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2">
                <Logo />
                <span className="text-xl font-black tracking-tight text-[var(--color-ink-900)]">
                  wanderbharat
                </span>
              </Link>
              <nav className="flex items-center gap-1 text-sm">
                <Link
                  href="/#destinations"
                  className="hidden sm:inline-flex px-3 py-2 font-semibold text-[var(--color-ink-700)] hover:text-[var(--color-brand-700)]"
                >
                  Destinations
                </Link>
                <Link
                  href="/#how-it-works"
                  className="hidden sm:inline-flex px-3 py-2 font-semibold text-[var(--color-ink-700)] hover:text-[var(--color-brand-700)]"
                >
                  How it works
                </Link>
                {initialUser && (
                  <Link
                    href="/trips"
                    className="hidden sm:inline-flex px-3 py-2 font-semibold text-[var(--color-ink-700)] hover:text-[var(--color-brand-700)]"
                  >
                    My trips
                  </Link>
                )}
                <Link href="/plan" className="btn-primary ml-2">
                  Plan a trip
                </Link>
                <AuthHeader />
              </nav>
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-6 pb-24">{children}</main>

          <footer className="mx-auto max-w-6xl px-6 py-12 mt-12 border-t border-[rgba(26,23,20,0.06)]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-2">
                <Logo />
                <span className="font-bold text-[var(--color-ink-900)]">
                  wanderbharat
                </span>
              </div>
              <p className="text-sm text-[var(--color-ink-500)]">
                Thoughtfully planned trips across India. Made with care.
              </p>
            </div>
            <p className="mt-6 text-xs text-[var(--color-ink-400)]">
              © {new Date().getFullYear()} wanderbharat. All rights reserved.
            </p>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}

function Logo() {
  return (
    <span
      aria-hidden
      className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-700)] text-white shadow-sm"
    >
      <svg
        viewBox="0 0 24 24"
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2 L20 12 L12 22 L4 12 Z" />
        <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
