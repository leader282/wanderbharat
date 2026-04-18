"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import SignInButton from "@/components/SignInButton";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * Auth-aware header slot. Renders one of three states:
 *   1. Loading skeleton (waiting on Firebase to rehydrate)
 *   2. "Sign in with Google" button + transient error toast
 *   3. Avatar trigger + profile dropdown menu
 */
export default function AuthHeader() {
  const { user, loading, signOut, error } = useAuth();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Render the latest auth error until the user dismisses it OR an
  // auto-dismiss timer fires below. Derived from props — no effect-based
  // state sync needed.
  const showError = error && error !== dismissedError ? error : null;

  useEffect(() => {
    if (!showError) return;
    const t = window.setTimeout(() => setDismissedError(showError), 6000);
    return () => window.clearTimeout(t);
  }, [showError]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (loading) {
    return (
      <div
        aria-hidden
        className="ml-1 h-9 w-9 sm:w-32 rounded-lg bg-[var(--color-sand-100)] animate-pulse"
      />
    );
  }

  if (!user) {
    return (
      <div className="relative ml-1">
        <SignInButton size="md" responsiveLabel label="Sign in" />
        {showError && (
          <div
            role="alert"
            className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-xs text-red-900 shadow-lg animate-fadeUp z-50"
          >
            <div className="flex items-start gap-2">
              <WarnIcon />
              <span className="flex-1 leading-snug">{showError}</span>
              <button
                type="button"
                onClick={() => setDismissedError(showError)}
                className="text-red-700 hover:text-red-900 font-bold"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
  const firstName = user.name?.trim().split(/\s+/)[0] ?? "Account";

  return (
    <div className="relative ml-1" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user.name ? `Account menu for ${user.name}` : "Account menu"}
        className={[
          "inline-flex items-center gap-2 rounded-full pl-1 pr-1.5 sm:pr-2.5 py-1",
          "border border-transparent transition",
          "hover:border-[rgba(26,23,20,0.1)] hover:bg-white/70",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-sand-50)]",
          open ? "bg-white/80 border-[rgba(26,23,20,0.1)]" : "",
        ].join(" ")}
      >
        <Avatar src={user.picture} initial={initial} size={32} ring />
        <span className="hidden md:inline text-sm font-semibold text-[var(--color-ink-800)] max-w-[10rem] truncate">
          {firstName}
        </span>
        <Caret rotated={open} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 mt-2 w-72 rounded-2xl border border-[rgba(26,23,20,0.08)] bg-white shadow-xl overflow-hidden z-50 animate-fadeUp"
        >
          <div className="px-4 py-4 bg-gradient-to-br from-[var(--color-sand-50)] to-white border-b border-[rgba(26,23,20,0.06)]">
            <div className="flex items-center gap-3">
              <Avatar
                src={user.picture}
                initial={initial}
                size={44}
                ring
              />
              <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--color-ink-900)] truncate">
                  {user.name ?? "Signed in"}
                </p>
                {user.email && (
                  <p className="text-xs text-[var(--color-ink-500)] truncate mt-0.5">
                    {user.email}
                  </p>
                )}
                <p className="mt-1.5 inline-flex items-center gap-1 text-[0.65rem] uppercase tracking-widest font-bold text-[var(--color-moss-600)]">
                  <DotIcon />
                  Signed in with Google
                </p>
              </div>
            </div>
          </div>

          <div className="py-1.5">
            <MenuLink
              href="/trips"
              icon={<TripsIcon />}
              label="My trips"
              hint="Past itineraries"
              onSelect={() => setOpen(false)}
            />
            <MenuLink
              href="/plan"
              icon={<PlusIcon />}
              label="Plan a new trip"
              hint="Build a fresh itinerary"
              onSelect={() => setOpen(false)}
            />
          </div>

          <div className="border-t border-[rgba(26,23,20,0.06)]">
            <button
              type="button"
              role="menuitem"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                try {
                  await signOut();
                  setOpen(false);
                  router.refresh();
                } finally {
                  setSigningOut(false);
                }
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-[var(--color-ink-800)] hover:bg-[var(--color-sand-50)] disabled:opacity-60"
            >
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--color-sand-100)] text-[var(--color-ink-700)]">
                {signingOut ? <SmallSpinner /> : <SignOutIcon />}
              </span>
              <span className="flex-1 text-left">
                {signingOut ? "Signing out…" : "Sign out"}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function MenuLink({
  href,
  icon,
  label,
  hint,
  onSelect,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-[var(--color-ink-800)] hover:bg-[var(--color-sand-50)]"
    >
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--color-sand-100)] text-[var(--color-brand-700)]">
        {icon}
      </span>
      <span className="flex-1">
        <span className="block">{label}</span>
        {hint && (
          <span className="block text-[0.7rem] font-medium text-[var(--color-ink-500)] mt-0.5">
            {hint}
          </span>
        )}
      </span>
    </Link>
  );
}

function Avatar({
  src,
  initial,
  size = 28,
  ring = false,
}: {
  src: string | null;
  initial: string;
  size?: number;
  ring?: boolean;
}) {
  const ringClass = ring
    ? "ring-2 ring-white shadow-sm outline outline-1 outline-[rgba(26,23,20,0.06)]"
    : "border border-[rgba(26,23,20,0.06)]";

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={`rounded-full object-cover ${ringClass}`}
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`grid place-items-center rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-700)] text-white font-bold ${ringClass}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {initial}
    </span>
  );
}

function Caret({ rotated }: { rotated: boolean }) {
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
      className={`text-[var(--color-ink-500)] transition-transform duration-200 ${
        rotated ? "rotate-180" : ""
      }`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function DotIcon() {
  return (
    <span
      aria-hidden
      className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-moss-600)]"
    />
  );
}

function TripsIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function SmallSpinner() {
  return (
    <svg
      aria-hidden
      className="animate-spin"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
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

function WarnIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0 text-red-700"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
