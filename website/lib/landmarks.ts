/**
 * A small curated registry of well-known work/study landmarks per city, with
 * coordinates and the area they sit in. The near-landmark SEO pages
 * (`/near/<city>/<slug>`) use these to run a real proximity search and to write
 * accurate local copy. Curated (not user input) so the coordinates are trusted;
 * extend this list as coverage grows.
 */
export interface Landmark {
  slug: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  /** The area the landmark sits in (for copy + linking to the area page). */
  area: string;
}

export const LANDMARKS: Landmark[] = [
  { slug: "manyata-tech-park", name: "Manyata Tech Park", city: "Bengaluru", lat: 13.0459, lng: 77.6212, area: "Nagavara" },
  { slug: "koramangala", name: "Koramangala", city: "Bengaluru", lat: 12.9352, lng: 77.6245, area: "Koramangala" },
  { slug: "electronic-city", name: "Electronic City", city: "Bengaluru", lat: 12.8452, lng: 77.6602, area: "Electronic City" },
  { slug: "hitec-city", name: "HITEC City", city: "Hyderabad", lat: 17.4435, lng: 78.3772, area: "Madhapur" },
  { slug: "gachibowli", name: "Gachibowli", city: "Hyderabad", lat: 17.4401, lng: 78.3489, area: "Gachibowli" },
  { slug: "hinjewadi", name: "Hinjewadi IT Park", city: "Pune", lat: 18.5913, lng: 73.738, area: "Hinjewadi" },
  { slug: "kharadi", name: "Kharadi", city: "Pune", lat: 18.5515, lng: 73.9436, area: "Kharadi" },
  { slug: "bkc", name: "Bandra Kurla Complex", city: "Mumbai", lat: 19.0662, lng: 72.8691, area: "Bandra" },
  { slug: "powai", name: "Powai", city: "Mumbai", lat: 19.1176, lng: 72.906, area: "Powai" },
];

/** Landmarks in a city (case-insensitive), for the sitemap + city cross-links. */
export function landmarksInCity(city: string): Landmark[] {
  const c = city.trim().toLowerCase();
  return LANDMARKS.filter((l) => l.city.toLowerCase() === c);
}

/** Resolve a (city, slug) pair to its landmark, or undefined. */
export function findLandmark(city: string, slug: string): Landmark | undefined {
  const c = city.trim().toLowerCase();
  return LANDMARKS.find((l) => l.city.toLowerCase() === c && l.slug === slug);
}
