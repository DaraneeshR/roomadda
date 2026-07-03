"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PublicListing } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";

/**
 * Tracks the caller's saved-listing ids so the heart on every card reflects the
 * SHARED account (one wishlist per phone-keyed identity — the same rows the app
 * writes). Loaded once when authenticated; mutations are optimistic and proxied
 * through the BFF (`/api/wishlist/*`). This holds only the id set for heart
 * state — the wishlist PAGE fetches the full listings itself.
 */
interface WishlistContextValue {
  ready: boolean;
  isSaved: (listingId: string) => boolean;
  save: (listingId: string) => Promise<boolean>;
  remove: (listingId: string) => Promise<boolean>;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function useWishlist(): WishlistContextValue {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within <WishlistProvider>");
  return ctx;
}

export function WishlistProvider({ children }: { children: ReactNode }): ReactNode {
  const { status, apiFetch } = useAuth();
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  // Load the saved set once the session is known. Anonymous → empty + ready.
  useEffect(() => {
    if (status === "loading") return;
    if (status === "anonymous") {
      setSaved(new Set());
      setReady(true);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await apiFetch("/api/wishlist?limit=50");
        if (!active) return;
        if (res.ok) {
          const body = (await res.json()) as { items: PublicListing[] };
          setSaved(new Set(body.items.map((l) => l.id)));
        }
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [status, apiFetch]);

  const isSaved = useCallback((listingId: string) => saved.has(listingId), [saved]);

  const save = useCallback(
    async (listingId: string): Promise<boolean> => {
      // Optimistic add; revert on failure.
      setSaved((prev) => new Set(prev).add(listingId));
      const res = await apiFetch(`/api/wishlist/${encodeURIComponent(listingId)}`, { method: "POST" });
      if (!res.ok) {
        setSaved((prev) => {
          const next = new Set(prev);
          next.delete(listingId);
          return next;
        });
        return false;
      }
      return true;
    },
    [apiFetch],
  );

  const remove = useCallback(
    async (listingId: string): Promise<boolean> => {
      const had = saved.has(listingId);
      setSaved((prev) => {
        const next = new Set(prev);
        next.delete(listingId);
        return next;
      });
      const res = await apiFetch(`/api/wishlist/${encodeURIComponent(listingId)}`, { method: "DELETE" });
      if (!res.ok) {
        if (had) setSaved((prev) => new Set(prev).add(listingId));
        return false;
      }
      return true;
    },
    [apiFetch, saved],
  );

  const value = useMemo<WishlistContextValue>(
    () => ({ ready, isSaved, save, remove }),
    [ready, isSaved, save, remove],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}
