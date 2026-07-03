"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { NearbyListing, Page, PublicListing } from "@roomadda/shared";
import {
  activeChips,
  clearFilters,
  filtersToQuery,
  filtersToSearchParams,
  isFilterEmpty,
  matchCountLabel,
  removeChip,
  type FilterState,
} from "../../lib/discovery";
import { ListingCard } from "../ListingCard";
import { FilterBar } from "./FilterBar";
import { ListingMap } from "./ListingMap";

/**
 * The interactive discovery surface. The server renders the first page (SEO +
 * a shareable URL), then this hydrates on top: filters update the results LIVE
 * over the BFF with NO full reload, and every change is written back to the URL
 * so the state stays shareable/indexable. It also hosts the split list+map view
 * with card↔pin hover sync and the map's "search this area" re-query.
 *
 * Money is never computed here — cards format server-owned amounts only.
 */

type View = "list" | "split";

const PAGE_LIMIT = "24";

function keyOf(filters: FilterState): string {
  return filtersToSearchParams(filters).toString();
}

export function DiscoveryView({
  initial,
  initialFilters,
  initialView,
}: {
  initial: Page<PublicListing>;
  initialFilters: FilterState;
  initialView: View;
}): ReactNode {
  const router = useRouter();
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [listings, setListings] = useState<PublicListing[]>(initial.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor);
  const [view, setView] = useState<View>(initialView);
  const [loading, setLoading] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [distanceById, setDistanceById] = useState<Record<string, number>>({});
  const [areaNote, setAreaNote] = useState<string | null>(null);

  // The filter key the CURRENT `listings` correspond to — seeded from the server
  // render so we don't refetch the first page on mount.
  const loadedKey = useRef(keyOf(initialFilters));
  const reqId = useRef(0);

  // Write the shareable URL (filters + view) without a full navigation.
  function syncUrl(next: FilterState, nextView: View): void {
    const sp = filtersToSearchParams(next);
    if (nextView === "split") sp.set("view", "split");
    const qs = sp.toString();
    router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
  }

  // Live-fetch whenever the filter set changes (skipping the seeded initial key).
  useEffect(() => {
    const key = keyOf(filters);
    if (key === loadedKey.current) return;
    const id = ++reqId.current;
    setLoading(true);
    const params = new URLSearchParams(filtersToQuery(filters));
    params.set("limit", PAGE_LIMIT);
    fetch(`/api/listings?${params.toString()}`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<Page<PublicListing>>) : Promise.reject(new Error("failed"))))
      .then((page) => {
        if (id !== reqId.current) return; // a newer request superseded this one
        loadedKey.current = key;
        setListings(page.items);
        setNextCursor(page.nextCursor);
        setDistanceById({});
        setAreaNote(null);
      })
      .catch(() => {
        if (id === reqId.current) {
          setListings([]);
          setNextCursor(null);
        }
      })
      .finally(() => id === reqId.current && setLoading(false));
    // The effect key is the serialized filter set — it changes iff a filter does.
  }, [keyOf(filters)]);

  function updateFilters(next: FilterState): void {
    setFilters(next);
    syncUrl(next, view);
  }

  function toggleView(next: View): void {
    setView(next);
    syncUrl(filters, next);
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || loading) return;
    setLoading(true);
    const params = new URLSearchParams(filtersToQuery(filters));
    params.set("limit", PAGE_LIMIT);
    params.set("cursor", nextCursor);
    try {
      const r = await fetch(`/api/listings?${params.toString()}`, { headers: { Accept: "application/json" } });
      if (r.ok) {
        const page = (await r.json()) as Page<PublicListing>;
        setListings((cur) => [...cur, ...page.items]);
        setNextCursor(page.nextCursor);
      }
    } finally {
      setLoading(false);
    }
  }

  async function searchArea(lat: number, lng: number, radiusM: number): Promise<void> {
    const id = ++reqId.current;
    setLoading(true);
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng), radiusM: String(radiusM), limit: PAGE_LIMIT });
    try {
      const r = await fetch(`/api/listings/nearby?${params.toString()}`, { headers: { Accept: "application/json" } });
      if (r.ok && id === reqId.current) {
        const page = (await r.json()) as { items: NearbyListing[]; nextCursor: string | null };
        setListings(page.items);
        setNextCursor(page.nextCursor);
        setDistanceById(Object.fromEntries(page.items.map((l) => [l.id, l.distanceMeters])));
        setAreaNote(`Showing ${page.items.length} PG${page.items.length === 1 ? "" : "s"} in the mapped area`);
        loadedKey.current = keyOf(filters); // area results don't correspond to a filter key
      }
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  const chips = activeChips(filters);

  const cards = listings.map((l) => (
    <div
      key={l.id}
      onMouseEnter={() => setHoveredId(l.id)}
      onMouseLeave={() => setHoveredId(null)}
      className={`rounded-xl transition ${hoveredId === l.id ? "ring-2 ring-teal-400" : ""}`}
    >
      <ListingCard listing={l} distanceMeters={distanceById[l.id]} />
    </div>
  ));

  return (
    <div>
      <FilterBar value={filters} onChange={updateFilters} />

      {/* Match count + active chips + view toggle */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">
          {loading ? "Searching…" : matchCountLabel(listings.length, nextCursor !== null)}
        </span>
        {areaNote && <span className="text-xs text-slate-500">· {areaNote}</span>}
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => updateFilters(removeChip(filters, c.key))}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
          >
            {c.label}
            <span aria-hidden className="text-slate-400">
              ✕
            </span>
          </button>
        ))}
        {!isFilterEmpty(filters) && (
          <button
            type="button"
            onClick={() => updateFilters(clearFilters())}
            className="text-xs font-medium text-teal-700 hover:underline"
          >
            Clear all
          </button>
        )}

        <div className="ml-auto inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
          {(["list", "split"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => toggleView(v)}
              aria-pressed={view === v}
              className={`px-3 py-1.5 font-medium capitalize ${view === v ? "bg-teal-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
            >
              {v === "split" ? "Map" : "List"}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {listings.length === 0 ? (
        <p className="py-16 text-center text-slate-500">No PGs match your filters. Try widening them.</p>
      ) : view === "split" ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="grid max-h-[80vh] grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2">{cards}</div>
          <div className="sticky top-4 h-[70vh] lg:h-[80vh]">
            <ListingMap
              listings={listings}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onSearchArea={searchArea}
              searching={loading}
            />
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{cards}</div>
      )}

      {nextCursor && listings.length > 0 && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="rounded-md border border-slate-300 px-5 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
