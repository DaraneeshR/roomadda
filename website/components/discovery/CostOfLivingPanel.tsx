import { estimateCostOfLiving, type CostLine } from "../../lib/costOfLiving";
import { formatRent } from "../../lib/discovery";

/**
 * A collapsible monthly-budget ESTIMATE for an area or a specific listing. Uses a
 * native <details> so it needs no client JS (crawlable + CSP-safe) and is closed
 * by default. It is labelled an estimate prominently and inescapably — the badge,
 * the total caption, and the footer disclaimer all say so (never an exact figure).
 *
 * Rent comes from live data (an area's typical band, or the listing's own price);
 * the non-rent lines come from configurable baselines. Money is never computed
 * here beyond summing server-owned figures.
 */
export function CostOfLivingPanel({
  rentFromPaise,
  rentToPaise,
  mealsIncluded,
  city,
  title = "Cost of living",
  defaultOpen = false,
}: {
  rentFromPaise: number | null;
  rentToPaise?: number | null;
  mealsIncluded: boolean;
  city?: string | null;
  title?: string;
  defaultOpen?: boolean;
}): React.ReactNode {
  const estimate = estimateCostOfLiving({ rentFromPaise, rentToPaise, mealsIncluded, city });

  return (
    <details open={defaultOpen} className="group rounded-xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
        <span className="flex items-center gap-2">
          <span className="text-base font-semibold text-slate-900">{title}</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Estimate
          </span>
        </span>
        <span className="text-right">
          <span className="block text-sm font-semibold tabular-nums text-slate-900">{estimate.totalLabel}</span>
          <span className="text-xs text-slate-400 group-open:hidden">Tap to see the breakdown</span>
        </span>
      </summary>

      <div className="border-t border-slate-100 p-5 pt-4">
        <ul className="divide-y divide-slate-100 text-sm">
          {estimate.lines.map((l) => (
            <Row key={l.key} line={l} />
          ))}
          <li className="flex items-center justify-between py-2 font-semibold text-slate-900">
            <span>Estimated monthly total</span>
            <span className="tabular-nums">{estimate.totalLabel}</span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">{estimate.disclaimer}</p>
      </div>
    </details>
  );
}

function Row({ line }: { line: CostLine }): React.ReactNode {
  const value =
    line.fromPaise === 0 && line.toPaise === 0
      ? line.note ?? "—"
      : line.fromPaise === line.toPaise
        ? formatRent(line.fromPaise)
        : `${formatRent(line.fromPaise)} – ${formatRent(line.toPaise)}`;
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="text-slate-600">
        {line.label}
        {line.note && !(line.fromPaise === 0 && line.toPaise === 0) && (
          <span className="ml-1 text-xs text-slate-400">· {line.note}</span>
        )}
      </span>
      <span className="tabular-nums text-slate-900">{value}</span>
    </li>
  );
}
