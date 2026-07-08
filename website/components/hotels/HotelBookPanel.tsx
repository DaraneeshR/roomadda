"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatPaise, type HotelCategoryAvailability, type KycViewStatus } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { canPayWithKyc, categoryTotalPaise, isCategoryBookable } from "../../lib/hotel";

/**
 * The booking step on the hotel detail page — pick a room category, see the
 * SERVER-owned price for the selected dates, then hold. It mirrors the PG
 * BookingSheet: discovery stays open (an anonymous "Book" opens the auth modal in
 * place), and payment is gated on VERIFIED KYC exactly as the backend enforces it.
 *
 * CRITICAL money discipline (/CLAUDE.md rule #1): the price shown is the server's
 * `totalPaise` / `perNightPaise` read straight from the DTO — this component NEVER
 * multiplies nights by the nightly rate. The hold POSTs ONLY { categoryId, dates,
 * guests }; the backend snapshots the amount and the verified webhook confirms it.
 */
export function HotelBookPanel({
  categories,
  checkIn,
  checkOut,
  guests,
  nights,
}: {
  categories: HotelCategoryAvailability[];
  checkIn: string;
  checkOut: string;
  guests: number;
  nights: number;
}): React.ReactNode {
  const { status, apiFetch, login } = useAuth();
  const router = useRouter();

  const bookable = useMemo(() => categories.filter(isCategoryBookable), [categories]);
  const [categoryId, setCategoryId] = useState<string | null>(bookable[0]?.categoryId ?? null);
  const selected = useMemo(
    () => categories.find((c) => c.categoryId === categoryId) ?? null,
    [categories, categoryId],
  );

  const [kycStatus, setKycStatus] = useState<KycViewStatus | null>(null);
  const [kycLoading, setKycLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadKyc = useCallback(async () => {
    setKycLoading(true);
    try {
      const res = await apiFetch("/api/kyc/me");
      if (res.ok) {
        const body = (await res.json()) as { kyc: { status: KycViewStatus } };
        setKycStatus(body.kyc.status);
      } else {
        setKycStatus(null);
      }
    } catch {
      setKycStatus(null);
    } finally {
      setKycLoading(false);
    }
  }, [apiFetch]);

  // Only load KYC once the visitor is authenticated (discovery never waits on it).
  useEffect(() => {
    if (status === "authenticated") void loadKyc();
  }, [status, loadKyc]);

  const createHold = useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/hotels/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Dates + category ONLY — the server owns nights, price, and the token.
        body: JSON.stringify({ categoryId: selected.categoryId, checkIn, checkOut, guests }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Could not hold this room. Please try again.");
        return;
      }
      const { reservation } = (await res.json()) as { reservation: { id: string } };
      router.push(`/hotels/reservation/${reservation.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [apiFetch, selected, checkIn, checkOut, guests, router]);

  function handleBook(): void {
    if (status === "authenticated") {
      void createHold();
    } else {
      login(() => void createHold());
    }
  }

  if (bookable.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        No rooms are available for these dates. Try a different check-in / check-out above.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">Choose a room</h3>
      <div className="mt-2 space-y-2">
        {categories.map((c) => {
          const ok = isCategoryBookable(c);
          const active = c.categoryId === categoryId;
          return (
            <button
              key={c.categoryId}
              type="button"
              disabled={!ok}
              onClick={() => setCategoryId(c.categoryId)}
              className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
                active
                  ? "border-teal-500 bg-teal-50"
                  : ok
                    ? "border-slate-200 hover:border-teal-300"
                    : "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60"
              }`}
            >
              <span>
                <span className="block text-sm font-medium text-slate-900">{c.tier}</span>
                <span className="block text-xs text-slate-500">
                  {ok ? `${c.availableRooms} room(s) free for your dates` : "Sold out for these dates"}
                </span>
              </span>
              <span className="text-right text-sm font-semibold text-slate-900">
                {formatPaise(c.perNightPaise)}
                <span className="block text-xs font-normal text-slate-500">/night</span>
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <Row label={`${nights} night${nights === 1 ? "" : "s"} × ${formatPaise(selected.perNightPaise)}`} value={formatPaise(categoryTotalPaise(selected))} />
          <Row label="Pay now (full stay)" value={formatPaise(categoryTotalPaise(selected))} accent />
          <p className="mt-3 text-xs text-slate-500">
            This is the price our server will charge for {guests} guest{guests === 1 ? "" : "s"} — it is final and
            not calculated in your browser. You&apos;ll be confirmed only once the payment settles.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4">
        <Cta
          status={status}
          kycLoading={kycLoading}
          kycStatus={kycStatus}
          submitting={submitting}
          onBook={handleBook}
          onRecheckKyc={loadKyc}
        />
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }): React.ReactNode {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-sm font-semibold ${accent ? "text-teal-700" : "text-slate-900"}`}>{value}</span>
    </div>
  );
}

/**
 * The call-to-action. Anonymous → the auth modal opens in place and continues to
 * the hold on success. Authenticated but not VERIFIED → the KYC gate (the backend
 * enforces requireKyc; we surface it up-front rather than let the hold 403).
 */
function Cta({
  status,
  kycLoading,
  kycStatus,
  submitting,
  onBook,
  onRecheckKyc,
}: {
  status: "loading" | "authenticated" | "anonymous";
  kycLoading: boolean;
  kycStatus: KycViewStatus | null;
  submitting: boolean;
  onBook: () => void;
  onRecheckKyc: () => void;
}): React.ReactNode {
  // Anonymous visitors can still click — the modal handles login, then the hold
  // runs. KYC is only checked once authenticated.
  if (status === "authenticated") {
    if (kycLoading) return <BlockedButton label="Checking your KYC…" />;
    if (!canPayWithKyc(kycStatus)) return <KycGate status={kycStatus} onRecheck={onRecheckKyc} />;
  }
  return (
    <button
      type="button"
      disabled={submitting}
      onClick={onBook}
      className="w-full rounded-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {submitting ? "Holding your room…" : "Book — hold & pay"}
    </button>
  );
}

function KycGate({ status, onRecheck }: { status: KycViewStatus | null; onRecheck: () => void }): React.ReactNode {
  const message =
    status === "PENDING"
      ? "Your identity is under review. You can pay once it's verified."
      : status === "REJECTED"
        ? "Your KYC was rejected. Re-upload your documents to continue booking."
        : "Verify your identity to book. It only takes a minute — you can keep browsing without it.";

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm text-amber-800">{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href="/account/kyc"
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
        >
          {status === "REJECTED" ? "Re-upload documents" : "Verify identity"}
        </Link>
        {status === "PENDING" && (
          <button
            type="button"
            onClick={onRecheck}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            I&apos;ve been verified — recheck
          </button>
        )}
      </div>
    </div>
  );
}

function BlockedButton({ label }: { label: string }): React.ReactNode {
  return (
    <button
      type="button"
      disabled
      className="w-full cursor-not-allowed rounded-md bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500"
    >
      {label}
    </button>
  );
}
