import type { Metadata } from "next";

import ContentPage from "@/components/marketing/ContentPage";
import PublicBetaNotice from "@/components/marketing/PublicBetaNotice";
import { aboutContent, betaBannerContent } from "@/lib/content/launchContent";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "About WanderBharat",
  description:
    "Learn how WanderBharat builds practical India itineraries with route-aware planning, pace-sensitive trip design, and transparent public beta expectations.",
  path: aboutContent.meta.canonical,
});

export default function AboutPage() {
  return (
    <div>
      <PublicBetaNotice
        className="mt-10 md:mt-14 max-w-3xl"
        eyebrow={betaBannerContent.homepage.eyebrow}
        title={betaBannerContent.homepage.title}
        body={betaBannerContent.homepage.body}
        links={betaBannerContent.homepage.links}
        compact
      />

      <ContentPage
        eyebrow={aboutContent.eyebrow}
        title={aboutContent.title}
        intro={aboutContent.intro}
        sections={aboutContent.sections}
        ctas={aboutContent.ctas}
      />
    </div>
  );
}
