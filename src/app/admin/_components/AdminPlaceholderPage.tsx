interface AdminPlaceholderPageProps {
  title: string;
  description: string;
  nextSteps: string[];
}

export default function AdminPlaceholderPage({
  title,
  description,
  nextSteps,
}: AdminPlaceholderPageProps) {
  return (
    <section className="card p-6 sm:p-8">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
        Prototype v2
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
        {title}
      </h1>
      <p className="mt-3 max-w-2xl text-[var(--color-ink-600)]">{description}</p>

      <ul className="mt-6 space-y-3">
        {nextSteps.map((step) => (
          <li
            key={step}
            className="rounded-xl border border-[var(--hairline)] bg-[var(--color-sand-50)] px-4 py-3 text-sm text-[var(--color-ink-700)]"
          >
            {step}
          </li>
        ))}
      </ul>
    </section>
  );
}
