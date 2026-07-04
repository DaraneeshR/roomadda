import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";

/**
 * Allow crawlers across the public discovery + landing surface, but keep private
 * account/host areas, the BFF, and user-built compare views out of the index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/", "/account/", "/host/", "/compare"] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
