import type { Metadata } from "next";

import ContentPage from "@/components/marketing/ContentPage";
import {
  applyTokensToSection,
  getLegalTokens,
} from "@/lib/content/legalTokens";
import {
  termsMeta,
  termsSections,
} from "@/lib/content/launchContent";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: termsMeta.title,
  description: termsMeta.description,
  path: termsMeta.canonical,
});

export default function TermsPage() {
  const tokens = getLegalTokens();
  const sections = termsSections.map((section) => applyTokensToSection(section, tokens));

  return (
    <ContentPage
      eyebrow="Legal"
      title="Terms of Use"
      intro={`Effective ${tokens.EFFECTIVE_DATE}. WanderBharat provides planning assistance in public beta. Please read these terms carefully before relying on itinerary outputs.`}
      sections={sections}
    />
  );
}
