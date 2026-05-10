import type { FaqItem } from "@/lib/content/launchContent";

type FAQListProps = {
  items: readonly FaqItem[];
};

export default function FAQList({ items }: FAQListProps) {
  return (
    <section className="mt-10 space-y-4">
      {items.map((item, index) => (
        <details
          key={item.id}
          className="group card p-5 sm:p-6"
          open={index === 0}
          id={item.id}
        >
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
            <span className="pr-2">
              <span className="block text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-brand-700)]">
                {item.category}
              </span>
              <span className="mt-2 block text-lg font-bold leading-snug text-[var(--color-ink-900)]">
                {item.question}
              </span>
            </span>
            <span
              aria-hidden
              className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--hairline-strong)] text-[var(--color-ink-700)] transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="mt-4 leading-relaxed text-[var(--color-ink-600)]">{item.answer}</p>
        </details>
      ))}
    </section>
  );
}
