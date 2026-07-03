"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import type { PublicListingPhoto } from "@roomadda/shared";
import { stepIndex } from "../../lib/discovery";

/**
 * A compact photo carousel for the listing card. Sits inside the card's <Link>,
 * so the arrows and dots stop the click from navigating (like the wishlist
 * heart). A listing with NO photos shows a styled gradient fallback with the
 * alias — never a broken <img>. Arbitrary CDN hosts, so a plain <img> is used
 * (the CSP allows `img-src https:`); next/image would need remotePatterns.
 */
export function PhotoCarousel({
  photos,
  alias,
  overlay,
  aspect = "aspect-[4/3]",
}: {
  photos: PublicListingPhoto[];
  alias: string;
  overlay?: ReactNode;
  aspect?: string;
}): ReactNode {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, photos.length - 1));
  const current = photos[safeIndex];

  function go(delta: number, e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    setIndex((i) => stepIndex(i, delta, photos.length));
  }

  return (
    <div className={`relative w-full overflow-hidden bg-gradient-to-br from-teal-100 to-slate-200 ${aspect}`}>
      {current ? (
        <img src={current.url} alt={alias} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center text-slate-500">
          <span className="text-3xl" aria-hidden>
            🏠
          </span>
          <span className="mt-1 px-3 text-center text-xs font-medium">{alias}</span>
          <span className="text-[11px] text-slate-400">Photos coming soon</span>
        </div>
      )}

      {overlay}

      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => go(-1, e)}
            aria-label="Previous photo"
            className="absolute left-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-slate-700 shadow-sm backdrop-blur transition hover:bg-white"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => go(1, e)}
            aria-label="Next photo"
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-slate-700 shadow-sm backdrop-blur transition hover:bg-white"
          >
            ›
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
            {photos.map((p, i) => (
              <span
                key={p.id}
                className={`h-1.5 w-1.5 rounded-full ${i === safeIndex ? "bg-white" : "bg-white/50"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
