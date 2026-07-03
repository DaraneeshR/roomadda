import { ratingLabel, starBreakdown } from "../../lib/discovery";

/**
 * Star rating from the server's cached aggregate. Renders NOTHING when the
 * listing has no reviews (average === null) — the empty state is first-class and
 * we never fabricate a 0-star rating (see backend review module). Pure display;
 * the star math lives in `lib/discovery` so it is unit-tested.
 */
export function StarRating({
  average,
  count,
  size = "sm",
  showLabel = true,
}: {
  average: number | null;
  count: number;
  size?: "sm" | "md";
  /** Hide the "4.6 (23)" text and show only the stars (e.g. a single review). */
  showLabel?: boolean;
}): React.ReactNode {
  const label = ratingLabel(average, count);
  if (label === null || average === null) return null;
  const { full, half } = starBreakdown(average);
  const text = size === "md" ? "text-base" : "text-sm";

  return (
    <span className={`inline-flex items-center gap-1 ${text}`} aria-label={`Rated ${average.toFixed(1)} of 5 from ${count} reviews`}>
      <span className="inline-flex" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => {
          const filled = i < full;
          const isHalf = i === full && half === 1;
          return (
            <span key={i} className="relative inline-block leading-none text-slate-300">
              ★
              {(filled || isHalf) && (
                <span
                  className="absolute inset-0 overflow-hidden text-amber-400"
                  style={{ width: filled ? "100%" : "50%" }}
                >
                  ★
                </span>
              )}
            </span>
          );
        })}
      </span>
      {showLabel && <span className="font-medium text-slate-700">{label}</span>}
    </span>
  );
}
