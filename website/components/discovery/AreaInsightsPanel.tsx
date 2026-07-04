import type { AreaInsights } from "@roomadda/shared";
import { areaSummary, formatBand, sharingLabel } from "../../lib/areaInsights";
import { formatRent, genderLabel } from "../../lib/discovery";
import { PriceHistogram } from "./PriceHistogram";

/**
 * The area price guide: a plain-English summary + the rent histogram + bands by
 * room type and gender, all from the backend's cached, PUBLISHED-only aggregate.
 * Server-rendered (crawlable, real local copy for SEO). Every figure is
 * server-owned — this component only formats bands, never computes a price.
 */
export function AreaInsightsPanel({ insights }: { insights: AreaInsights }): React.ReactNode {
  const { overall, byRoomType, byGender } = insights;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">Prices in {insights.area}</h2>
      <p className="mt-1 text-sm text-slate-600">{areaSummary(insights)}</p>

      {overall && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="From" value={formatRent(overall.minPaise)} />
            <Stat label="Typical" value={formatRent(overall.typicalPaise)} highlight />
            <Stat label="Up to" value={formatRent(overall.maxPaise)} />
          </div>

          <PriceHistogram insights={insights} />

          {byRoomType.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold text-slate-700">By room type</h3>
              <ul className="divide-y divide-slate-100 text-sm">
                {byRoomType.map((t) => (
                  <li key={t.sharingType} className="flex items-center justify-between py-1.5">
                    <span className="text-slate-600">{sharingLabel(t.sharingType)}</span>
                    <span className="tabular-nums text-slate-900">{formatBand(t.band)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {byGender.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold text-slate-700">By occupancy</h3>
              <ul className="divide-y divide-slate-100 text-sm">
                {byGender.map((g) => (
                  <li key={g.gender} className="flex items-center justify-between py-1.5">
                    <span className="text-slate-600">{genderLabel(g.gender)}</span>
                    <span className="tabular-nums text-slate-900">{formatBand(g.band)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }): React.ReactNode {
  return (
    <div className={`rounded-lg p-3 text-center ${highlight ? "bg-teal-50" : "bg-slate-50"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${highlight ? "text-teal-800" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
