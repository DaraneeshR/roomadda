"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPaise, type BookingDetail, type BookingStatus } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";

/**
 * "My Bookings" — the caller's own bookings from GET /v1/bookings via the BFF.
 * Identical data to the app: masked until CONFIRMED (alias/area only), then the
 * unmasked listing + host name. Each row opens the detail view.
 */
const STATUS_STYLES: Partial<Record<BookingStatus, string>> = {
  CONFIRMED: "bg-green-100 text-green-800",
  TOKEN_PENDING: "bg-amber-100 text-amber-800",
  PENDING_APPROVAL: "bg-blue-100 text-blue-800",
  CANCELLED: "bg-slate-200 text-slate-600",
  EXPIRED: "bg-slate-200 text-slate-600",
  COMPLETED: "bg-slate-200 text-slate-600",
  INITIATED: "bg-slate-100 text-slate-600",
};

export function statusLabel(status: BookingStatus): string {
  return (
    {
      INITIATED: "Started",
      PENDING_APPROVAL: "Awaiting host",
      TOKEN_PENDING: "Payment due",
      CONFIRMED: "Confirmed",
      CANCELLED: "Cancelled",
      EXPIRED: "Expired",
      COMPLETED: "Completed",
    } satisfies Record<BookingStatus, string>
  )[status];
}

export function StatusPill({ status }: { status: BookingStatus }): React.ReactNode {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {statusLabel(status)}
    </span>
  );
}

export function BookingsPanel(): React.ReactNode {
  const { apiFetch } = useAuth();
  const [items, setItems] = useState<BookingDetail[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ limit: "20", ...(after ? { cursor: after } : {}) });
        const res = await apiFetch(`/api/bookings?${qs}`);
        if (!res.ok) {
          setError("Could not load your bookings.");
          return;
        }
        const body = (await res.json()) as { items: BookingDetail[]; nextCursor: string | null };
        setItems((prev) => (after ? [...prev, ...body.items] : body.items));
        setCursor(body.nextCursor);
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [apiFetch],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">My bookings</h1>
      <p className="mt-1 text-sm text-slate-600">Your holds and confirmed stays. Receipts are inside each booking.</p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading && items.length === 0 ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-slate-600">You haven&apos;t booked anything yet.</p>
          <Link href="/search" className="mt-3 inline-block text-sm font-semibold text-teal-700 hover:underline">
            Find a PG →
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((b) => (
            <li key={b.id}>
              <Link
                href={`/account/bookings/${b.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-slate-900">{b.listing.alias}</span>
                    <StatusPill status={b.status} />
                  </div>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {b.listing.areaLabel}, {b.listing.city}
                    {b.moveInDate && ` · move-in ${new Date(b.moveInDate).toLocaleDateString("en-IN")}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-slate-900">{formatPaise(b.tokenAmountPaise)}</p>
                  <p className="text-xs text-slate-500">token</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <button
          type="button"
          onClick={() => void load(cursor)}
          disabled={loading}
          className="mt-4 w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
