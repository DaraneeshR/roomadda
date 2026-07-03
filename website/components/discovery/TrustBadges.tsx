import type { TrustBadge } from "@roomadda/shared";
import { BADGE_META, cardBadges } from "../../lib/discovery";

/**
 * Trust-badge chips. The server already ordered `badges` by priority and split
 * FEATURED out, so we only choose how many to show: a card takes the top 2–3
 * (`limit`), the detail view shows them all (`limit` omitted). Every badge here
 * is real (engine-earned or live-derived); a suspended/expired one never reaches
 * us. Glyphs are plain text so no external image loads under the CSP.
 */
export function TrustBadges({
  badges,
  featured,
  limit,
  size = "sm",
}: {
  badges: TrustBadge[];
  featured?: boolean;
  limit?: number;
  size?: "sm" | "md";
}): React.ReactNode {
  const shown = limit ? cardBadges(badges, limit) : badges;
  if (shown.length === 0 && !featured) return null;

  const pad = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";

  return (
    <div className="flex flex-wrap gap-1">
      {featured && (
        <span
          className={`inline-flex items-center gap-1 rounded-full font-semibold ${pad} ${BADGE_META.FEATURED.className}`}
          title="Featured placement"
        >
          <span aria-hidden>{BADGE_META.FEATURED.icon}</span>
          {BADGE_META.FEATURED.short}
        </span>
      )}
      {shown.map((b) => {
        const meta = BADGE_META[b.kind];
        return (
          <span
            key={b.kind}
            className={`inline-flex items-center gap-1 rounded-full font-medium ${pad} ${meta.className}`}
            title={meta.label}
          >
            <span aria-hidden>{meta.icon}</span>
            {size === "md" ? meta.label : meta.short}
          </span>
        );
      })}
    </div>
  );
}
