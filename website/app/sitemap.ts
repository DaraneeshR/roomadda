import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";
import { INTENT_KEYS } from "../lib/landing";
import { LANDMARKS } from "../lib/landmarks";

/** Cities we actively surface (mirrors the header nav). */
const CITIES = ["Bengaluru", "Pune", "Hyderabad", "Mumbai"];

/**
 * The sitemap for the SEO landing engine: home + search, every city, every
 * intent×city page, each curated area page and each near-landmark page. All are
 * server-rendered, canonical, crawlable pages — so every URL here resolves to
 * real content. User-built compare views are intentionally excluded (noindex).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const url = (path: string) => `${SITE_URL}${path}`;
  const entries: MetadataRoute.Sitemap = [
    { url: url("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: url("/search"), lastModified: now, changeFrequency: "daily", priority: 0.8 },
  ];

  for (const city of CITIES) {
    entries.push({ url: url(`/city/${encodeURIComponent(city)}`), lastModified: now, changeFrequency: "daily", priority: 0.9 });
    for (const intent of INTENT_KEYS) {
      entries.push({ url: url(`/pg/${intent}/${encodeURIComponent(city)}`), lastModified: now, changeFrequency: "weekly", priority: 0.7 });
    }
  }

  // Curated areas + landmarks (deduped) from the landmark registry.
  const areas = new Map<string, { city: string; area: string }>();
  for (const l of LANDMARKS) {
    areas.set(`${l.city}|${l.area}`, { city: l.city, area: l.area });
    entries.push({ url: url(`/near/${encodeURIComponent(l.city)}/${l.slug}`), lastModified: now, changeFrequency: "weekly", priority: 0.6 });
  }
  for (const { city, area } of areas.values()) {
    entries.push({ url: url(`/area/${encodeURIComponent(city)}/${encodeURIComponent(area)}`), lastModified: now, changeFrequency: "daily", priority: 0.8 });
  }

  return entries;
}
