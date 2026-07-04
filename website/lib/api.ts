import "server-only";
import type {
  AreaInsights,
  NearbyListing,
  Page,
  PublicListing,
  ReviewListResponse,
  SocialProof,
} from "@roomadda/shared";
import { env } from "./env";

interface FetchOpts {
  revalidate?: number;
}

/** Server-side fetch of the backend's PUBLIC (masked) endpoints. Returns null on error. */
async function getJson<T>(path: string, opts: FetchOpts = {}): Promise<T | null> {
  try {
    const res = await fetch(`${env.BACKEND_API_URL}${path}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: opts.revalidate ?? 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") sp.set(key, value);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const publicApi = {
  featured: (limit = 8) =>
    getJson<{ items: PublicListing[] }>(`/v1/featured?limit=${limit}`, { revalidate: 60 }),

  listings: (params: Record<string, string | undefined>, revalidate = 30) =>
    getJson<Page<PublicListing>>(`/v1/listings${qs(params)}`, { revalidate }),

  // Detail folds in the honesty-gated social proof (see backend listing.route).
  listing: (id: string) =>
    getJson<{ listing: PublicListing; social: SocialProof }>(
      `/v1/listings/${encodeURIComponent(id)}`,
      { revalidate: 60 },
    ),

  reviews: (id: string, params: Record<string, string | undefined> = {}, revalidate = 30) =>
    getJson<ReviewListResponse>(
      `/v1/listings/${encodeURIComponent(id)}/reviews${qs(params)}`,
      { revalidate },
    ),

  nearby: (lat: string, lng: string, radiusM: string) =>
    getJson<{ items: NearbyListing[] }>(`/v1/listings/search/nearby${qs({ lat, lng, radiusM })}`, {
      revalidate: 30,
    }),

  // Cached, PUBLISHED-only price insights for one area (bands + histogram).
  areaInsights: (area: string, city?: string, revalidate = 300) =>
    getJson<AreaInsights>(`/v1/areas/${encodeURIComponent(area)}/insights${qs({ city })}`, { revalidate }),
};
