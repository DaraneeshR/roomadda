"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { GENDER_POLICIES, type PublicListing } from "@roomadda/shared";
import {
  boundsOf,
  boundsRadiusMeters,
  clusterPoints,
  formatRentCompact,
  genderColor,
  genderLabel,
  project,
  unproject,
  type Bounds,
  type GeoPoint,
} from "../../lib/discovery";

/**
 * A live results map WITHOUT an external tile provider. The backend masks geo to
 * a coarse ~1 km marker and the site's CSP forbids third-party map scripts, so
 * instead of a slippy tiled map we project the current result set's approximate
 * markers into the panel ourselves and draw rent-labelled, gender-coloured pins.
 * It supports pan (drag), zoom (wheel/buttons), pin↔card hover sync, clustering
 * of overlapping pins, and a "search this area" action that re-queries the
 * backend's nearby endpoint for the current viewport. All projection/cluster math
 * is the pure `lib/discovery` helpers; this component only wires the pointer UI.
 */

const CLUSTER_CELL_PX = 52;
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

export function ListingMap({
  listings,
  hoveredId,
  onHover,
  onSearchArea,
  searching,
}: {
  listings: PublicListing[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSearchArea: (lat: number, lng: number, radiusM: number) => void;
  searching?: boolean;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [moved, setMoved] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Refit (and drop any pan/zoom) whenever the result set changes.
  useEffect(() => {
    setScale(1);
    setTx(0);
    setTy(0);
    setMoved(false);
  }, [listings]);

  const points: GeoPoint[] = listings.map((l) => ({ id: l.id, lat: l.approxLocation.lat, lng: l.approxLocation.lng }));
  const base: Bounds | null = boundsOf(points);
  const { w, h } = size;

  // Screen transform: project into the box, then scale about centre + translate.
  const toScreen = useCallback(
    (x: number, y: number): { x: number; y: number } => ({
      x: (x - w / 2) * scale + w / 2 + tx,
      y: (y - h / 2) * scale + h / 2 + ty,
    }),
    [w, h, scale, tx, ty],
  );
  const fromScreen = (sx: number, sy: number): { x: number; y: number } => ({
    x: (sx - w / 2 - tx) / scale + w / 2,
    y: (sy - h / 2 - ty) / scale + h / 2,
  });

  const byId = new Map(listings.map((l) => [l.id, l]));
  const screenPoints =
    base && w > 0 && h > 0
      ? points.map((p) => {
          const proj = project(p, base, w, h);
          const s = toScreen(proj.x, proj.y);
          return { id: p.id, x: s.x, y: s.y };
        })
      : [];
  const clusters = clusterPoints(screenPoints, CLUSTER_CELL_PX);

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setTx((v) => v + dx);
    setTy((v) => v + dy);
    setMoved(true);
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>): void {
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function zoom(factor: number): void {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor)));
    setMoved(true);
  }

  function searchThisArea(): void {
    if (!base || w === 0 || h === 0) return;
    const centreData = fromScreen(w / 2, h / 2);
    const centre = unproject(centreData.x, centreData.y, base, w, h);
    // Visible bounds in data space → lat/lng corners → a covering radius.
    const tl = fromScreen(0, 0);
    const br = fromScreen(w, h);
    const nw = unproject(tl.x, tl.y, base, w, h);
    const se = unproject(br.x, br.y, base, w, h);
    const visible: Bounds = {
      minLat: Math.min(nw.lat, se.lat),
      maxLat: Math.max(nw.lat, se.lat),
      minLng: Math.min(nw.lng, se.lng),
      maxLng: Math.max(nw.lng, se.lng),
    };
    onSearchArea(centre.lat, centre.lng, boundsRadiusMeters(visible));
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      {/* Subtle grid backdrop so pins read as being on a map surface. */}
      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={(e) => zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15)}
        className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
        style={{
          backgroundImage:
            "linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      >
        {clusters.map((c, i) => {
          if (c.x < -40 || c.x > w + 40 || c.y < -40 || c.y > h + 40) return null;
          if (c.ids.length > 1) {
            return (
              <button
                key={`c${i}`}
                type="button"
                onClick={() => zoom(1.8)}
                className="absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-teal-600 text-xs font-bold text-white shadow-md"
                style={{ left: c.x, top: c.y }}
                title={`${c.ids.length} PGs here — zoom in`}
              >
                {c.ids.length}
              </button>
            );
          }
          const id = c.ids[0]!;
          const listing = byId.get(id);
          if (!listing) return null;
          const active = hoveredId === id;
          const label = listing.priceFromPaise !== null ? formatRentCompact(listing.priceFromPaise) : genderLabel(listing.gender);
          return (
            <a
              key={id}
              href={`/listing/${id}`}
              onMouseEnter={() => onHover(id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(id)}
              onBlur={() => onHover(null)}
              className={`absolute -translate-x-1/2 -translate-y-full rounded-full border-2 border-white px-2 py-0.5 text-[11px] font-semibold text-white shadow-md transition ${
                active ? "z-20 scale-110 ring-2 ring-teal-300" : "z-10"
              }`}
              style={{ left: c.x, top: c.y, backgroundColor: genderColor(listing.gender) }}
              title={`${listing.alias} — ${listing.areaLabel}`}
            >
              {label}
            </a>
          );
        })}

        {screenPoints.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            No mappable results.
          </p>
        )}
      </div>

      {/* Zoom controls */}
      <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <button type="button" onClick={() => zoom(1.3)} aria-label="Zoom in" className="h-8 w-8 text-lg text-slate-600 hover:bg-slate-100">
          +
        </button>
        <button type="button" onClick={() => zoom(1 / 1.3)} aria-label="Zoom out" className="h-8 w-8 border-t border-slate-200 text-lg text-slate-600 hover:bg-slate-100">
          −
        </button>
      </div>

      {/* Search-this-area appears once the user pans/zooms away from the auto fit. */}
      {moved && (
        <div className="absolute inset-x-0 top-2 flex justify-center">
          <button
            type="button"
            onClick={searchThisArea}
            disabled={searching}
            className="rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow-lg transition hover:bg-slate-700 disabled:opacity-60"
          >
            {searching ? "Searching…" : "🔍 Search this area"}
          </button>
        </div>
      )}

      {/* Gender legend */}
      <div className="absolute bottom-2 left-2 flex gap-2 rounded-md bg-white/90 px-2 py-1 text-[11px] text-slate-600 shadow-sm backdrop-blur">
        {GENDER_POLICIES.map((g) => (
          <span key={g} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: genderColor(g) }} />
            {genderLabel(g)}
          </span>
        ))}
      </div>
    </div>
  );
}
