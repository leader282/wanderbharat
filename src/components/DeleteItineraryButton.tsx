"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function DeleteItineraryButton({
  itineraryId,
  tripLabel,
}: {
  itineraryId: string;
  tripLabel: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  // Clear any pending error toast on unmount.
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    };
  }, []);

  function showError(message: string) {
    setError(message);
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => setError(null), 4000);
  }

  async function handleDelete() {
    if (deleting) return;

    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/itinerary/${encodeURIComponent(itineraryId)}`,
        {
          method: "DELETE",
        },
      );

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        showError(payload?.message ?? "We couldn't delete that itinerary.");
        setDeleting(false);
        return;
      }

      router.refresh();
    } catch {
      showError("We couldn't delete that itinerary.");
      setDeleting(false);
    }
  }

  return (
    <>
      {error && (
        <div
          role="alert"
          className="fixed inset-x-0 top-4 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-lg animate-fadeBackdrop"
        >
          <span aria-hidden className="mt-0.5 text-red-700">
            <AlertIcon size={14} />
          </span>
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        aria-label={`Delete ${tripLabel}`}
        title="Delete itinerary"
        className={[
          "relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg border transition",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30",
          deleting
            ? "cursor-wait border-[var(--hairline)] bg-[var(--color-sand-50)] text-[var(--color-ink-400)]"
            : "border-[var(--hairline)] bg-white text-[var(--color-ink-500)] hover:border-red-200 hover:bg-red-50 hover:text-red-700",
        ].join(" ")}
      >
        {deleting ? <Spinner size={12} /> : <TrashIcon size={13} />}
      </button>
    </>
  );
}

function TrashIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function AlertIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
