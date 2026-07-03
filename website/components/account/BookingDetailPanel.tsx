"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPaise, type BookingDetail, type PaymentSummary } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { isPayable, isRevealed, revealedListing } from "../../lib/booking";
import { downloadPdf } from "../../lib/downloadPdf";
import { StatusPill } from "./BookingsPanel";

/**
 * Booking detail — the same data the app shows: status, the money breakdown,
 * payment history (per-leg summary), the revealed PG/host once CONFIRMED, and the
 * downloadable PDF receipt. A still-payable booking links back to the pay page.
 */
export function BookingDetailPanel({ bookingId }: { bookingId: string }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await apiFetch(`/api/bookings/${encodeURIComponent(bookingId)}`);
      if (res.status === 404) return setState("notfound");
      if (!res.ok) return setState("error");
      const body = (await res.json()) as { booking: BookingDetail };
      setBooking(body.booking);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [apiFetch, bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDownload(): Promise<void> {
    setDownloading(true);
    setDownloadErr(null);
    const err = await downloadPdf(apiFetch, `/api/bookings/${encodeURIComponent(bookingId)}/receipt`, `roomadda-receipt-${bookingId}.pdf`);
    setDownloadErr(err);
    setDownloading(false);
  }

  if (state === "loading") return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;
  if (state === "notfound")
    return (
      <Empty title="Booking not found">We couldn&apos;t find this booking on your account.</Empty>
    );
  if (state === "error" || !booking)
    return <Empty title="Something went wrong">Please try again in a moment.</Empty>;

  const listing = revealedListing(booking);
  const confirmed = isRevealed(booking);

  return (
    <div>
      <Link href="/account/bookings" className="text-sm text-teal-700 hover:underline">
        ← My bookings
      </Link>

      <div className="mt-3 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{booking.listing.alias}</h1>
        <StatusPill status={booking.status} />
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {booking.listing.areaLabel}, {booking.listing.city}
      </p>

      {isPayable(booking) && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">This booking is awaiting your token payment.</p>
          <Link
            href={`/booking/${booking.id}`}
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          >
            Pay token
          </Link>
        </div>
      )}

      <dl className="mt-6 space-y-2 rounded-xl border border-slate-200 bg-white p-5">
        <Row label="Booking ID" value={booking.id} mono />
        {booking.moveInDate && <Row label="Move-in" value={new Date(booking.moveInDate).toLocaleDateString("en-IN")} />}
        {booking.mealPlan && <Row label="Meal plan" value={booking.mealPlan} />}
        <Row label="Token" value={formatPaise(booking.tokenAmountPaise)} />
        <Row label="Monthly rent" value={formatPaise(booking.monthlyRentPaise)} />
        <Row label="Security deposit" value={formatPaise(booking.depositPaise)} />
        {confirmed && booking.hostName && <Row label="Host" value={booking.hostName} />}
        {listing && <Row label="PG" value={listing.actualName} />}
        {listing && <Row label="Address" value={listing.fullAddress} />}
      </dl>

      <PaymentHistory payment={booking.payment} />

      {confirmed && (
        <div className="mt-6">
          {downloadErr && <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{downloadErr}</p>}
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={downloading}
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
          >
            {downloading ? "Preparing…" : "Download receipt (PDF)"}
          </button>
        </div>
      )}
    </div>
  );
}

function PaymentHistory({ payment }: { payment: PaymentSummary | null }): React.ReactNode {
  if (!payment) return null;
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-slate-700">Payment history</h2>
      <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Method</span>
          <span className="font-medium text-slate-900">{payment.method}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Overall</span>
          <span className="font-medium text-slate-900">{payment.status}</span>
        </div>
        {payment.online && (
          <div className="flex justify-between">
            <span className="text-slate-500">Online</span>
            <span className="font-medium text-slate-900">
              {payment.online.status}
              {payment.online.capturedAt && ` · ${new Date(payment.online.capturedAt).toLocaleString("en-IN")}`}
            </span>
          </div>
        )}
        {payment.cash && (
          <div className="flex justify-between">
            <span className="text-slate-500">Cash</span>
            <span className="font-medium text-slate-900">{payment.cash.status}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactNode {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-right text-sm text-slate-900 ${mono ? "font-mono text-xs" : "font-medium"}`}>{value}</dd>
    </div>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }): React.ReactNode {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{children}</p>
      <Link href="/account/bookings" className="mt-3 inline-block text-sm font-semibold text-teal-700 hover:underline">
        ← My bookings
      </Link>
    </div>
  );
}
