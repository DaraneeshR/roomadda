"use client";

import { useState, type ReactNode } from "react";
import type { Review, ReviewListResponse, ReviewSummary } from "@roomadda/shared";
import { StarRating } from "./StarRating";

/**
 * The graceful empty state, extracted (and hookless) so it renders when a listing
 * has no reviews — the first-class "no reviews yet", never a fabricated rating.
 */
export function ReviewsEmptyState(): ReactNode {
  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <p className="text-sm font-medium text-slate-700">No reviews yet</p>
      <p className="mt-1 text-sm text-slate-500">
        Be the first to review this PG after your stay. Reviews come only from real, confirmed stays.
      </p>
    </div>
  );
}

/**
 * The reviews section for a listing detail page. Renders the aggregate header,
 * each individual review with its host response (when present), and a graceful
 * EMPTY STATE when there are none — the empty state is first-class (the backend
 * never fabricates a rating for an unreviewed listing). Reviews are PUBLIC; the
 * "load more" control pages through the BFF cursor. All data is real and read-only
 * here — writing a review requires an eligible stay and happens in the app.
 */
export function ReviewsSection({
  listingId,
  initial,
}: {
  listingId: string;
  initial: ReviewListResponse;
}): ReactNode {
  const [reviews, setReviews] = useState<Review[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const summary: ReviewSummary = initial.summary;

  async function loadMore(): Promise<void> {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/listings/${encodeURIComponent(listingId)}/reviews?cursor=${encodeURIComponent(cursor)}`, {
        headers: { Accept: "application/json" },
      });
      if (r.ok) {
        const page = (await r.json()) as ReviewListResponse;
        setReviews((cur) => [...cur, ...page.items]);
        setCursor(page.nextCursor);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Reviews</h2>
        {summary.ratingCount > 0 && <StarRating average={summary.ratingAverage} count={summary.ratingCount} size="md" />}
      </div>

      {reviews.length === 0 ? (
        <ReviewsEmptyState />
      ) : (
        <ul className="mt-4 space-y-4">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{r.authorName}</span>
                <StarRating average={r.rating} count={1} showLabel={false} />
              </div>
              {r.text && <p className="mt-2 text-sm text-slate-700">{r.text}</p>}
              <p className="mt-1 text-xs text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</p>
              {r.hostResponse && (
                <div className="mt-3 rounded-md border-l-2 border-teal-300 bg-teal-50/60 p-3">
                  <p className="text-xs font-semibold text-teal-800">Response from the host</p>
                  <p className="mt-1 text-sm text-slate-700">{r.hostResponse}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <div className="mt-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Load more reviews"}
          </button>
        </div>
      )}
    </section>
  );
}
