import type { Metadata } from "next";
import Link from "next/link";

import FAQList from "@/components/marketing/FAQList";
import PublicBetaNotice from "@/components/marketing/PublicBetaNotice";
import {
  betaBannerContent,
  faqItems,
  replaceLaunchTokens,
} from "@/lib/content/launchContent";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Trip Planning FAQ",
  description:
    "Read answers about WanderBharat public beta, itinerary estimates, saved trips, and what to verify before travelling.",
  path: "/faq",
});

export default function FAQPage() {
  const supportEmail = process.env.CONTACT_TO_EMAIL ?? "chakrabortyaritra.2002@gmail.com";
  const resolvedFaqItems = faqItems.map((item) => ({
    ...item,
    answer: replaceLaunchTokens(item.answer, { CONTACT_TO_EMAIL: supportEmail }),
  }));

  return (
    <section className="mt-10 md:mt-14 max-w-3xl">
      <header>
        <p className="eyebrow">Frequently asked</p>
        <h1 className="mt-3 text-4xl md:text-[3rem] font-bold leading-[1.06] tracking-tight text-[var(--color-ink-900)]">
          Questions, answered
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-[var(--color-ink-600)]">
          A quick guide to how WanderBharat works in public beta. If your question is
          not listed, reach us via{" "}
          <Link
            href="/contact"
            className="font-semibold text-[var(--color-ink-800)] underline-offset-2 hover:underline"
          >
            contact
          </Link>
          .
        </p>
      </header>

      <PublicBetaNotice
        className="mt-8"
        eyebrow={betaBannerContent.homepage.eyebrow}
        body={betaBannerContent.homepage.body}
        links={betaBannerContent.homepage.links}
        compact
      />

      <FAQList items={resolvedFaqItems} />
    </section>
  );
}
