"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { COMPARE_MIN, canCompare, compareUrl } from "../../lib/compare";
import { useCompare } from "./CompareProvider";

/**
 * The dockable compare tray. Rendered globally but INVISIBLE until the user adds
 * a PG (compare is a mode you opt into, never on by default). Shows the count, a
 * "Compare" CTA (enabled at 2+), and a clear button. Hidden on the compare page
 * itself, where the table already owns the set.
 */
export function CompareTray(): React.ReactNode {
  const { ids, count, clear } = useCompare();
  const pathname = usePathname();

  if (count === 0 || pathname === "/compare") return null;
  const ready = canCompare(ids);

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
        <span className="text-sm font-semibold text-slate-900">
          Compare <span className="tabular-nums">({count})</span>
        </span>
        <span className="hidden text-xs text-slate-400 sm:inline">
          {ready ? "up to 4 PGs" : `add ${COMPARE_MIN - count} more`}
        </span>
        {ready ? (
          <Link
            href={compareUrl(ids)}
            className="rounded-full bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-700"
          >
            Compare now →
          </Link>
        ) : (
          <span className="cursor-not-allowed rounded-full bg-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-400">
            Compare now →
          </span>
        )}
        <button
          type="button"
          onClick={clear}
          className="text-sm font-medium text-slate-500 hover:text-slate-800"
          aria-label="Clear compare"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
