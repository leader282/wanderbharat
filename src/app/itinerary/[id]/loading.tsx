export default function Loading() {
  return (
    <section className="mt-8 md:mt-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading itinerary</span>

      <SkeletonLine className="h-4 w-32 rounded-full" />

      <div className="card mt-6 overflow-hidden px-6 py-8 md:px-10 md:py-12">
        <SkeletonLine className="h-3 w-36 rounded-full" />
        <SkeletonLine className="mt-5 h-12 max-w-2xl rounded-[1.25rem]" />
        <SkeletonLine className="mt-3 h-4 max-w-xl rounded-full" />
        <SkeletonLine className="mt-2 h-4 max-w-2xl rounded-full" />

        <div className="mt-7 flex flex-wrap gap-2.5">
          <SkeletonLine className="h-9 w-24 rounded-full" />
          <SkeletonLine className="h-9 w-28 rounded-full" />
          <SkeletonLine className="h-9 w-32 rounded-full" />
          <SkeletonLine className="h-9 w-24 rounded-full" />
        </div>
      </div>

      <div className="mt-8 rounded-full border border-[var(--hairline)] bg-white/80 p-2 shadow-[var(--shadow-soft)]">
        <div className="flex gap-2 overflow-hidden">
          <SkeletonLine className="h-9 w-24 rounded-full" />
          <SkeletonLine className="h-9 w-24 rounded-full" />
          <SkeletonLine className="h-9 w-20 rounded-full" />
          <SkeletonLine className="h-9 w-20 rounded-full" />
          <SkeletonLine className="h-9 w-16 rounded-full" />
        </div>
      </div>

      <section className="mt-12 md:mt-16">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="card p-5">
              <SkeletonLine className="h-3 w-20 rounded-full" />
              <SkeletonLine className="mt-3 h-8 w-24 rounded-xl" />
              <SkeletonLine className="mt-3 h-3 w-full rounded-full" />
            </div>
          ))}
        </div>

        <div className="card mt-6 p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <SkeletonLine className="h-3 w-20 rounded-full" />
              <SkeletonLine className="h-4 w-48 rounded-full" />
            </div>
            <SkeletonLine className="hidden h-3 w-48 rounded-full md:block" />
          </div>

          <div className="mt-5 flex gap-6 overflow-hidden pb-1">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="flex min-w-[6.5rem] flex-col items-center gap-3"
              >
                <SkeletonLine className="h-9 w-9 rounded-full" />
                <SkeletonLine className="h-3 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-12 md:mt-16">
        <SkeletonLine className="h-3 w-24 rounded-full" />
        <SkeletonLine className="mt-4 h-10 w-64 rounded-2xl" />
        <SkeletonLine className="mt-3 h-4 max-w-2xl rounded-full" />

        <div className="mt-8 space-y-5 md:space-y-6">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="relative pl-12 md:pl-14">
              <div className="absolute left-0 top-4 h-8 w-8 rounded-full border border-[var(--hairline)] bg-white/90" />
              <div className="card overflow-hidden p-5 md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <SkeletonLine className="h-3 w-20 rounded-full" />
                    <SkeletonLine className="mt-3 h-7 w-44 rounded-2xl" />
                    <SkeletonLine className="mt-3 h-3 w-40 rounded-full" />
                    <div className="mt-4 flex flex-wrap gap-2">
                      <SkeletonLine className="h-7 w-24 rounded-full" />
                      <SkeletonLine className="h-7 w-20 rounded-full" />
                      <SkeletonLine className="h-7 w-24 rounded-full" />
                    </div>
                  </div>
                  <SkeletonLine className="h-9 w-9 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12 grid gap-4 md:mt-16 md:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="card p-5">
            <SkeletonLine className="h-3 w-24 rounded-full" />
            <SkeletonLine className="mt-3 h-6 w-40 rounded-2xl" />
            <div className="mt-5 grid grid-cols-3 gap-2">
              <SkeletonLine className="h-14 rounded-xl" />
              <SkeletonLine className="h-14 rounded-xl" />
              <SkeletonLine className="h-14 rounded-xl" />
            </div>
          </div>
        ))}
      </section>

      <section className="mt-12 md:mt-16">
        <div className="card p-6 md:p-8">
          <SkeletonLine className="h-3 w-20 rounded-full" />
          <SkeletonLine className="mt-4 h-8 w-64 rounded-2xl" />
          <SkeletonLine className="mt-4 h-4 max-w-3xl rounded-full" />
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <SkeletonLine key={index} className="h-20 rounded-2xl" />
            ))}
          </div>
        </div>
      </section>

      <section className="mt-12 md:mt-16">
        <div className="card p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <SkeletonLine className="h-3 w-16 rounded-full" />
              <SkeletonLine className="h-8 w-56 rounded-2xl" />
              <SkeletonLine className="h-4 w-72 rounded-full" />
            </div>
            <div className="hidden gap-2 md:flex">
              <SkeletonLine className="h-9 w-24 rounded-full" />
              <SkeletonLine className="h-9 w-20 rounded-full" />
            </div>
          </div>

          <SkeletonLine className="mt-5 h-[420px] rounded-[1.5rem]" />
        </div>
      </section>
    </section>
  );
}

function SkeletonLine({ className }: { className: string }) {
  return <div className={`skeleton-block ${className}`} />;
}
