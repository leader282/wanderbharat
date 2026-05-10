import type { Metadata } from "next";

const SITE_NAME = "WanderBharat";
const SOCIAL_IMAGE_ALT = "WanderBharat India trip planner preview";
const SOCIAL_IMAGE_PATH = "/brand/wb-og.png";
const SOCIAL_IMAGE_WIDTH = 1731;
const SOCIAL_IMAGE_HEIGHT = 909;

type PageMetadataInput = {
  title: string;
  description: string;
  path: string;
};

function buildSocialImages() {
  return {
    openGraph: [
      {
        url: SOCIAL_IMAGE_PATH,
        width: SOCIAL_IMAGE_WIDTH,
        height: SOCIAL_IMAGE_HEIGHT,
        alt: SOCIAL_IMAGE_ALT,
      },
    ],
    twitter: [SOCIAL_IMAGE_PATH],
  };
}

export function createPageMetadata({
  title,
  description,
  path,
}: PageMetadataInput): Metadata {
  const socialImages = buildSocialImages();

  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: "en_IN",
      type: "website",
      images: socialImages.openGraph,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: socialImages.twitter,
    },
  };
}
