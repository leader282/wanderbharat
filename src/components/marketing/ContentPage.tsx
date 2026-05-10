import Link from "next/link";

import type { ContentBlock, ContentSection, CtaLink } from "@/lib/content/launchContent";

type ContentPageProps = {
  eyebrow: string;
  title: string;
  intro: string;
  sections: readonly ContentSection[];
  ctas?: readonly CtaLink[];
};

export default function ContentPage({
  eyebrow,
  title,
  intro,
  sections,
  ctas,
}: ContentPageProps) {
  return (
    <section className="mt-10 md:mt-14 max-w-3xl">
      <header>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-3 text-4xl md:text-[3rem] font-bold leading-[1.06] tracking-tight text-[var(--color-ink-900)]">
          {title}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-[var(--color-ink-600)]">{intro}</p>
      </header>

      {ctas && ctas.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-3">
          {ctas.map((cta) => (
            <Link
              key={`${cta.href}-${cta.label}`}
              href={cta.href}
              className={getCtaClassName(cta.variant)}
            >
              {cta.label}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-10 space-y-8">
        {sections.map((section) => (
          <article key={section.id} className="card p-6 sm:p-7">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
              {section.title}
            </h2>
            <div className="mt-4 space-y-4 text-[var(--color-ink-600)]">
              {section.blocks.map((block, index) => (
                <BlockRenderer key={`${section.id}-${index}`} block={block} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function BlockRenderer({ block }: { block: ContentBlock }) {
  if (block.type === "list") {
    return (
      <ul className="list-disc space-y-2 pl-5 leading-relaxed">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  return <p className="leading-relaxed">{block.text}</p>;
}

function getCtaClassName(variant: CtaLink["variant"] | undefined): string {
  switch (variant) {
    case "secondary":
      return "btn-secondary";
    case "tertiary":
      return "inline-flex items-center rounded-xl px-1 py-2 text-sm font-semibold text-[var(--color-ink-700)] transition-colors hover:text-[var(--color-ink-900)]";
    case "primary":
    default:
      return "btn-primary";
  }
}
