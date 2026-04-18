"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function DeleteItineraryButton({
  itineraryId,
  tripLabel,
}: {
  itineraryId: string;
  tripLabel: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = `delete-itinerary-title-${itineraryId}`;

  useEffect(() => {
    if (!confirmOpen || deleting) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setConfirmOpen(false);
        setError(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmOpen, deleting]);

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
        setError(payload?.message ?? "We couldn't delete that itinerary.");
        setDeleting(false);
        return;
      }

      router.refresh();
    } catch {
      setError("We couldn't delete that itinerary.");
      setDeleting(false);
    }
  }

  function openConfirm() {
    if (deleting) return;
    setError(null);
    setConfirmOpen(true);
  }

  function closeConfirm() {
    if (deleting) return;
    setError(null);
    setConfirmOpen(false);
  }

  return (
    <>
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(26,23,20,0.45)] px-4"
          onClick={closeConfirm}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-md rounded-2xl border border-[rgba(26,23,20,0.08)] bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-50 text-red-700"
              >
                <TrashIcon />
              </span>
              <div className="min-w-0 flex-1">
                <h2
                  id={titleId}
                  className="text-xl font-black text-[var(--color-ink-900)]"
                >
                  Delete itinerary?
                </h2>
                <p className="mt-2 text-sm text-[var(--color-ink-600)]">
                  This will permanently remove the saved trip from your account.
                </p>
                <p className="mt-3 rounded-xl bg-[var(--color-sand-50)] px-3 py-2 text-sm font-semibold text-[var(--color-ink-800)]">
                  {tripLabel}
                </p>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
              >
                {error}
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeConfirm}
                disabled={deleting}
                className="btn-secondary justify-center"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className={[
                  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
                  deleting
                    ? "cursor-wait bg-red-200 text-red-900"
                    : "bg-red-600 text-white hover:bg-red-700",
                ].join(" ")}
              >
                <TrashIcon />
                {deleting ? "Deleting..." : "Delete itinerary"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={openConfirm}
          disabled={deleting}
          className={[
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
            deleting
              ? "cursor-wait border-[rgba(26,23,20,0.08)] bg-[var(--color-sand-50)] text-[var(--color-ink-500)]"
              : "border-red-200 bg-white text-red-700 hover:bg-red-50 hover:border-red-300",
          ].join(" ")}
          aria-label={`Delete ${tripLabel}`}
        >
          <TrashIcon />
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    </>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
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
