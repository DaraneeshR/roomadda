"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPaise, type PublicListing } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { useWishlist } from "../wishlist/WishlistProvider";

/**
 * The saved-listings page — reads the SHARED wishlist (same rows as the app) and
 * shows live availability + rent with "Book now" / "Remove". Removal goes through
 * the WishlistProvider so hearts elsewhere update too.
 *
 * NOTE: named collections are intentionally deferred — the backend wishlist is a
 * flat per-user set with no collection field (and the app has none), so grouping
 * would need a new backend model + shared contract to stay on the shared account.
 */
export function WishlistPanel(): React.ReactNode {
  const { apiFetch } = useAuth();
  const { remove } = useWishlist();
  const [items, setItems] = useState<PublicListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/wishlist?limit=50");
      if (!res.ok) {
        setError("Could not load your wishlist.");
        return;
      }
      const body = (await res.json()) as { items: PublicListing[] };
      setItems(body.items);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRemove(id: string): Promise<void> {
    const ok = await remove(id);
    if (ok) setItems((prev) => prev.filter((l) => l.id !== id));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Wishlist</h1>
      <p className="mt-1 text-sm text-slate-600">Saved PGs, synced with your RoomAdda app.</p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-slate-600">Nothing saved yet. Tap the heart on any PG to save it here.</p>
          <Link href="/search" className="mt-3 inline-block text-sm font-semibold text-teal-700 hover:underline">
            Browse PGs →
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {items.map((l) => (
            <WishlistItem key={l.id} listing={l} onRemove={() => void onRemove(l.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function WishlistItem({ listing, onRemove }: { listing: PublicListing; onRemove: () => void }): React.ReactNode {
  const beds = listing.rooms.reduce((sum, r) => sum + r.availableBeds, 0);
  const primary = listing.photos.find((p) => p.isPrimary) ?? listing.photos[0];

  return (
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="aspect-[16/9] w-full bg-gradient-to-br from-teal-100 to-slate-200">
        {primary && <img src={primary.url} alt={listing.alias} className="h-full w-full object-cover" loading="lazy" />}
      </div>
      <div className="p-4">
        <p className="truncate font-semibold text-slate-900">{listing.alias}</p>
        <p className="text-sm text-slate-500">
          {listing.areaLabel}, {listing.city}
        </p>
        <div className="mt-1 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">
            {listing.priceFromPaise !== null ? `${formatPaise(listing.priceFromPaise)}/mo` : "Price on request"}
          </p>
          <p className={`text-xs font-medium ${beds > 0 ? "text-green-700" : "text-slate-400"}`}>
            {beds > 0 ? `${beds} bed(s) available` : "Full"}
          </p>
        </div>
        <div className="mt-3 flex gap-2">
          <Link
            href={`/listing/${listing.id}`}
            className="flex-1 rounded-md bg-teal-600 px-3 py-2 text-center text-sm font-semibold text-white transition hover:bg-teal-700"
          >
            Book now
          </Link>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}
