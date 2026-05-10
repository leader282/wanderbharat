import type { MetadataRoute } from "next";

import { resolveSiteUrl } from "@/lib/seo/siteUrl";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = resolveSiteUrl();
  const now = new Date();
  const routes = ["/", "/plan", "/about", "/faq", "/contact", "/privacy", "/terms"];

  return routes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: now,
    changeFrequency: route === "/" ? "daily" : "weekly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
