"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PublicListing } from "@roomadda/shared";
import { buildCompareRows, compareUrl, COMPARE_MIN } from "../../lib/compare";
import { PhotoCarousel } from "../discovery/PhotoCarousel";
import { WishlistHeart } from "../wishlist/WishlistHeart";
import { useCompare } from "./CompareProvider";

/**
 * The side-by-side compare table. It seeds from the SSR listings (fetched for the
 * shared ?ids= URL), adopts that set into the session tray, and lets the user
 * remove a column — keeping the URL, the session, and the table in lockstep so
 * the view stays shareable. Book (View & book) and Wishlist work per column.
 *
 * Differing cells are highlighted (via the pure `buildCompareRows` diff flags).
 * Money is server-owned: rows only format the amounts the listings already carry.
 */
export function CompareTable({
  listings,
  initialIds,
}: {
  listings: PublicListing[];
  initialIds: string[];
}): React.ReactNode {
  const router = useRouter();
  const { setIds, remove: removeFromTray } = useCompare();

  // Order the SSR listings by the URL's id order; drop ids that failed to load.
  const byId = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const [ids, setLocalIds] = useState<string[]>(() => initialIds.filter((id) => byId.has(id)));

  // Adopt the shared set into the session tray so a shared link populates it.
  // Runs once for this shared URL (deps intentionally empty).
  useEffect(() => {
    setIds(initialIds.filter((id) => byId.has(id)));
  }, []);

  const shown = ids.map((id) => byId.get(id)!).filter(Boolean);
  const rows = useMemo(() => buildCompareRows(shown), [shown]);

  function removeColumn(id: string): void {
    const next = ids.filter((x) => x !== id);
    setLocalIds(next);
    removeFromTray(id);
    router.replace(next.length > 0 ? compareUrl(next) : "/compare", { scroll: false });
  }

  if (shown.length < COMPARE_MIN) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
        <p className="text-slate-600">
          Add at least {COMPARE_MIN} PGs to compare. Open any listing or search result and tap{" "}
          <span className="font-medium text-slate-800">Compare</span>.
        </p>
        <Link href="/search" className="mt-3 inline-block rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">
          Browse PGs →
        </Link>
      </div>
    );
  }

  const colWidth = "min-w-[220px]";

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-200 align-middle" /> highlighted cells differ between these PGs.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-40 bg-slate-50 p-3 text-left align-bottom" />
              {shown.map((l) => (
                <th key={l.id} className={`${colWidth} border-l border-slate-200 bg-white p-3 text-left align-top`}>
                  <div className="relative">
                    <PhotoCarousel
                      photos={l.photos}
                      alias={l.alias}
                      overlay={
                        <>
                          <WishlistHeart listingId={l.id} />
                          <button
                            type="button"
                            onClick={() => removeColumn(l.id)}
                            aria-label={`Remove ${l.alias} from compare`}
                            title="Remove"
                            className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:bg-white"
                          >
                            ✕
                          </button>
                        </>
                      }
                    />
                  </div>
                  <Link href={`/listing/${l.id}`} className="mt-2 block truncate font-semibold text-slate-900 hover:text-teal-700">
                    {l.alias}
                  </Link>
                  <p className="truncate text-xs text-slate-500">
                    {l.areaLabel}, {l.city}
                  </p>
                  <Link
                    href={`/listing/${l.id}`}
                    className="mt-2 block rounded-md bg-teal-600 px-3 py-1.5 text-center text-sm font-semibold text-white hover:bg-teal-700"
                  >
                    View &amp; book
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100">
                <th scope="row" className="sticky left-0 z-10 bg-slate-50 p-3 text-left align-top text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {row.label}
                </th>
                {row.cells.map((c, i) => (
                  <td
                    key={shown[i]!.id}
                    className={`${colWidth} border-l border-slate-100 p-3 align-top ${row.diff[i] ? "bg-amber-50 font-medium text-slate-900" : "text-slate-700"}`}
                  >
                    {c.display}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
