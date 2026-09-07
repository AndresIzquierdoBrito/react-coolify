import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://projects.izbri.com";
  return ["en", "es"].map((locale) => ({ url: `${base}/${locale}`, lastModified: new Date(), changeFrequency: "daily" as const, priority: 1, alternates: { languages: { en: `${base}/en`, es: `${base}/es` } } }));
}
