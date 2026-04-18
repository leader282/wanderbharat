import { Suspense } from "react";

import PlanForm from "@/components/PlanForm";

export const dynamic = "force-dynamic";

export default function PlanPage() {
  return (
    <section className="mt-10 md:mt-14 max-w-3xl">
      <p className="eyebrow">Plan a trip</p>
      <h1 className="mt-3 text-4xl md:text-5xl font-black tracking-tight leading-[1.05]">
        Tell us about your trip.
      </h1>
      <p className="mt-3 text-lg text-[var(--color-ink-700)] max-w-2xl">
        A few quick choices and we&apos;ll build a day-by-day plan that fits
        your pace and the map, then recommend a budget that feels justified.
      </p>

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
      <div className="h-4 w-24 bg-[var(--color-sand-100)] rounded" />
      <div className="h-10 bg-[var(--color-sand-100)] rounded" />
      <div className="h-4 w-24 bg-[var(--color-sand-100)] rounded" />
      <div className="h-10 bg-[var(--color-sand-100)] rounded" />
      <div className="h-10 w-40 bg-[var(--color-sand-100)] rounded" />
    </div>
  );
}
