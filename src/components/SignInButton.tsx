"use client";

import { useState } from "react";

import { useAuth } from "@/lib/auth/AuthProvider";

type Size = "sm" | "md" | "lg";
type Variant = "outline" | "solid";

interface SignInButtonProps {
  size?: Size;
  variant?: Variant;
  /** Override label. Defaults to "Sign in with Google". */
  label?: string;
  /**
   * Compact label — only the icon shows on small screens, the label
   * appears from `sm:` upwards. Default true for `sm`, false otherwise.
   */
  responsiveLabel?: boolean;
  className?: string;
  /** Optional callback after a successful sign-in (popup closed, user set). */
  onSignedIn?: () => void;
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm gap-1.5",
  md: "px-3.5 py-2 text-sm gap-2",
  lg: "px-5 py-3 text-base gap-2.5",
};

const ICON_SIZE: Record<Size, number> = {
  sm: 14,
  md: 16,
  lg: 18,
};

/**
 * Single source of truth for the "Sign in with Google" button. Used in
 * the header, the plan form, the trips page, and anywhere else that
 * wants to invite the user to authenticate.
 */
export default function SignInButton({
  size = "md",
  variant = "outline",
  label = "Sign in with Google",
  responsiveLabel,
  className = "",
  onSignedIn,
}: SignInButtonProps) {
  const { signInWithGoogle, user } = useAuth();
  const [busy, setBusy] = useState(false);

  const collapse = responsiveLabel ?? size === "sm";

  const variantClasses =
    variant === "solid"
      ? "bg-[var(--color-ink-900)] text-white border border-transparent hover:bg-[var(--color-ink-800)]"
      : "bg-white text-[var(--color-ink-800)] border border-[rgba(26,23,20,0.12)] hover:border-[var(--color-brand-500)] hover:text-[var(--color-ink-900)]";

  return (
    <button
      type="button"
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await signInWithGoogle();
          if (onSignedIn) onSignedIn();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      aria-label={label}
      className={[
        "inline-flex items-center justify-center rounded-lg font-semibold transition",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-sand-50)]",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        SIZE_CLASSES[size],
        variantClasses,
        className,
      ].join(" ")}
    >
      {busy ? (
        <Spinner size={ICON_SIZE[size]} />
      ) : (
        <GoogleGlyph size={ICON_SIZE[size]} />
      )}
      <span className={collapse ? "hidden sm:inline" : ""}>
        {busy ? "Signing in…" : user ? "Continue" : label}
      </span>
    </button>
  );
}

function GoogleGlyph({ size }: { size: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 18 18">
      <path
        fill="#EA4335"
        d="M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.48C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z"
      />
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#FBBC05"
        d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z"
      />
    </svg>
  );
}

function Spinner({ size }: { size: number }) {
  return (
    <svg
      aria-hidden
      className="animate-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.2"
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
