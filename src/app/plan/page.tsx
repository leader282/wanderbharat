import type { Metadata } from "next";
import { Suspense } from "react";

import PublicBetaNotice from "@/components/marketing/PublicBetaNotice";
import { betaBannerContent } from "@/lib/content/launchContent";
import { createPageMetadata } from "@/lib/seo/metadata";
import PlanForm from "@/components/PlanForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createPageMetadata({
  title: "Plan an India Trip",
  description:
    "Enter your destination, duration, budget, pace, and group size to generate a day-by-day India itinerary with routes, drive-time estimates, and budget context.",
  path: "/plan",
});

export default function PlanPage() {
  const notice = betaBannerContent.planner;

  return (
    <section className="mt-10 md:mt-14 max-w-3xl">
      <p className="eyebrow">Plan a trip</p>
      <h1 className="mt-3 text-4xl md:text-[3rem] font-bold leading-[1.06] tracking-tight text-[var(--color-ink-900)]">
        Tell us about your trip.
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-600)]">
        A few quick choices and we&apos;ll build a day-by-day plan that fits your
        pace, your group, and your total trip budget.
      </p>

      <PublicBetaNotice
        className="mt-7"
        eyebrow={notice.eyebrow}
        body={notice.body}
        links={[notice.link]}
        compact
      />

      <div className="mt-10">
        <Suspense fallback={<FormSkeleton />}>
          <PlanForm />
        </Suspense>
      </div>
    </section>
  );
}

function FormSkeleton() {
  return (
    <div className="card p-8 animate-pulse space-y-5">
      <div className="h-3 w-24 rounded bg-[var(--color-sand-200)]" />
      <div className="h-10 rounded-lg bg-[var(--color-sand-100)]" />
      <div className="h-3 w-24 rounded bg-[var(--color-sand-200)]" />
      <div className="h-10 rounded-lg bg-[var(--color-sand-100)]" />
      <div className="h-3 w-32 rounded bg-[var(--color-sand-200)]" />
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="h-16 rounded-xl bg-[var(--color-sand-100)]" />
        <div className="h-16 rounded-xl bg-[var(--color-sand-100)]" />
        <div className="h-16 rounded-xl bg-[var(--color-sand-100)]" />
      </div>
      <div className="h-10 w-44 rounded-xl bg-[var(--color-ink-700)]/30" />
    </div>
  );
}
