import Link from "next/link";

export default function ItineraryFootnote() {
  return (
    <div className="mt-12 flex items-center justify-between flex-wrap gap-4 card p-5 md:p-6 reveal-up">
      <div>
        <p className="font-bold text-[var(--color-ink-900)]">
          Want to try a different shape of trip?
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-500)]">
          Start over with a new pace or starting point — or try a fresh total
          budget above and apply it if the preview feels right.
        </p>
      </div>
      <Link href="/plan" className="btn-primary">
        Plan another trip
      </Link>
    </div>
  );
}
