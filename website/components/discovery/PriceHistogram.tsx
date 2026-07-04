import type { AreaInsights } from "@roomadda/shared";
import { histogramBars } from "../../lib/areaInsights";

/**
 * A dependency-free rent histogram for an area. The website has a strict CSP (no
 * external chart script), so we draw the distribution with plain divs whose
 * heights come from the pure `histogramBars` scaler — inline `style` heights are
 * allowed by `style-src 'unsafe-inline'`. Server-rendered, so it is crawlable and
 * needs no client JS. Renders nothing when the area has no priced rooms.
 */
export function PriceHistogram({ insights }: { insights: AreaInsights }): React.ReactNode {
  const bars = histogramBars(insights.histogram);
  if (bars.length === 0) return null;

  return (
    <figure className="mt-2">
      <div className="flex h-28 items-end gap-1" role="img" aria-label={`Rent distribution across ${insights.area}`}>
        {bars.map((b) => (
          <div key={b.fromPaise} className="flex flex-1 flex-col items-center justify-end" title={`${b.count} room${b.count === 1 ? "" : "s"}`}>
            <div
              className="w-full rounded-t bg-teal-400/80"
              style={{ height: `${Math.max(b.heightPct, b.count > 0 ? 6 : 0)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {bars.map((b) => (
          <span key={b.fromPaise} className="flex-1 text-center text-[10px] tabular-nums text-slate-400">
            {b.label}
          </span>
        ))}
      </div>
      <figcaption className="mt-1 text-xs text-slate-500">Monthly rent distribution (per room)</figcaption>
    </figure>
  );
}
