import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, siteUrl } from "@/lib/site";

/** Every public page. The data changes daily (prices, levels, news), so search engines are told to come back often. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PAGES.map((path) => ({
    url: `${base}${path === "/" ? "" : path}`,
    changeFrequency: "daily",
    priority: path === "/" ? 1 : 0.7,
  }));
}
