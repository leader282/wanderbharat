const DEFAULT_SITE_URL = "https://wanderbharat.app";

export function resolveSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return DEFAULT_SITE_URL;

  try {
    return new URL(configured).toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export function resolveMetadataBase(): URL {
  return new URL(resolveSiteUrl());
}
