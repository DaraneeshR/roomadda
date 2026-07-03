"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { PublicListingPhoto } from "@roomadda/shared";
import { stepIndex } from "../../lib/discovery";

/**
 * The detail-page photo grid + full-screen lightbox. The grid shows a hero + a
 * few thumbnails; clicking any opens a full-screen viewer with prev/next, a
 * counter, keyboard navigation (←/→/Esc) and wrap-around (index math from
 * `lib/discovery`). No photos → a styled fallback panel, never a broken image.
 */
export function PhotoGridLightbox({ photos, alias }: { photos: PublicListingPhoto[]; alias: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const move = useCallback(
    (delta: number) => setIndex((i) => stepIndex(i, delta, photos.length)),
    [photos.length],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowLeft") move(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, move]);

  function openAt(i: number): void {
    setIndex(i);
    setOpen(true);
  }

  if (photos.length === 0) {
    return (
      <div className="mt-4 flex aspect-[16/7] w-full flex-col items-center justify-center rounded-xl bg-gradient-to-br from-teal-100 to-slate-200 text-slate-500">
        <span className="text-4xl" aria-hidden>🏠</span>
        <span className="mt-2 text-sm font-medium">{alias}</span>
        <span className="text-xs text-slate-400">Photos coming soon</span>
      </div>
    );
  }

  const hero = photos[0]!;
  const rest = photos.slice(1, 5);

  return (
    <>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4 sm:grid-rows-2">
        <button
          type="button"
          onClick={() => openAt(0)}
          className="group relative overflow-hidden rounded-xl sm:col-span-2 sm:row-span-2"
        >
          <img src={hero.url} alt={alias} className="aspect-[4/3] h-full w-full object-cover transition group-hover:scale-[1.02] sm:aspect-auto" />
        </button>
        {rest.map((p, i) => (
          <button key={p.id} type="button" onClick={() => openAt(i + 1)} className="group relative hidden overflow-hidden rounded-xl sm:block">
            <img src={p.url} alt={`${alias} photo ${i + 2}`} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
            {i === rest.length - 1 && photos.length > 5 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-white">
                +{photos.length - 5} more
              </span>
            )}
          </button>
        ))}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${alias} photos`}
          onClick={() => setOpen(false)}
        >
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute right-4 top-4 text-3xl text-white/80 hover:text-white">
            ×
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); move(-1); }}
            aria-label="Previous photo"
            className="absolute left-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/30"
          >
            ‹
          </button>
          <img
            src={photos[index]!.url}
            alt={`${alias} photo ${index + 1}`}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); move(1); }}
            aria-label="Next photo"
            className="absolute right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/30"
          >
            ›
          </button>
          <span className="absolute bottom-4 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
            {index + 1} / {photos.length}
          </span>
        </div>
      )}
    </>
  );
}
