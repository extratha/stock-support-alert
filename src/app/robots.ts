import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/** Search engines may index the public, read-only pages; the API and the login page are not content. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/login"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
