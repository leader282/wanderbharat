import type { Metadata } from "next";

import ContentPage from "@/components/marketing/ContentPage";
import {
  applyTokensToSection,
  getLegalTokens,
} from "@/lib/content/legalTokens";
import {
  privacyPolicyMeta,
  privacyPolicySections,
} from "@/lib/content/launchContent";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: privacyPolicyMeta.title,
  description: privacyPolicyMeta.description,
  path: privacyPolicyMeta.canonical,
});

export default function PrivacyPage() {
  const tokens = getLegalTokens();
  const sections = privacyPolicySections.map((section) =>
    applyTokensToSection(section, tokens),
  );

  return (
    <ContentPage
      eyebrow="Legal"
      title="Privacy Policy"
      intro={`Effective ${tokens.EFFECTIVE_DATE}. This policy explains what data WanderBharat collects in public beta, why it is used, and how to request changes or deletion.`}
      sections={sections}
    />
  );
}
