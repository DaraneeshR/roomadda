"use client";

import { useState, type MouseEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useWishlist } from "./WishlistProvider";

/**
 * The heart toggle overlaid on a listing card. Writes to the SHARED account via
 * the BFF, so a save here appears in the app too. An anonymous click opens the
 * P4.1 login modal and, on success, saves. Sits inside the card's <Link>, so it
 * stops the click from navigating.
 */
export function WishlistHeart({ listingId }: { listingId: string }): React.ReactNode {
  const { status, login } = useAuth();
  const { isSaved, save, remove } = useWishlist();
  const [busy, setBusy] = useState(false);
  const saved = isSaved(listingId);

  async function onClick(e: MouseEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (status !== "authenticated") {
      login(() => void save(listingId));
      return;
    }
    setBusy(true);
    try {
      if (saved) await remove(listingId);
      else await save(listingId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={saved}
      aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
      title={saved ? "Remove from wishlist" : "Save to wishlist"}
      className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-lg shadow-sm backdrop-blur transition hover:bg-white disabled:opacity-60"
    >
      <span className={saved ? "text-rose-500" : "text-slate-400"}>{saved ? "♥" : "♡"}</span>
    </button>
  );
}
