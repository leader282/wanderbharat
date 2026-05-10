import type { MetadataRoute } from "next";

import { resolveSiteUrl } from "@/lib/seo/siteUrl";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = resolveSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin", "/itinerary", "/trips"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
