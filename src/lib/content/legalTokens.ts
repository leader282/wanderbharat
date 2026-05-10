import {
  replaceLaunchTokens,
  type ContentSection,
} from "@/lib/content/launchContent";

export type LegalTokens = Record<string, string>;

export function getLegalTokens(): LegalTokens {
  return {
    CONTACT_TO_EMAIL:
      process.env.CONTACT_TO_EMAIL ?? "chakrabortyaritra.2002@gmail.com",
    OPERATOR_NAME: process.env.NEXT_PUBLIC_OPERATOR_NAME ?? "WanderBharat",
    OPERATOR_LOCATION: process.env.NEXT_PUBLIC_OPERATOR_LOCATION ?? "India",
    GOVERNING_LAW_STATE:
      process.env.NEXT_PUBLIC_GOVERNING_LAW_STATE ?? "India",
    EFFECTIVE_DATE:
      process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE ?? "10 May 2026",
  };
}

export function applyTokensToSection(
  section: ContentSection,
  tokens: LegalTokens,
): ContentSection {
  return {
    ...section,
    title: replaceLaunchTokens(section.title, tokens),
    blocks: section.blocks.map((block) => {
      if (block.type === "paragraph") {
        return { ...block, text: replaceLaunchTokens(block.text, tokens) };
      }
      return {
        ...block,
        items: block.items.map((item) => replaceLaunchTokens(item, tokens)),
      };
    }),
  };
}
