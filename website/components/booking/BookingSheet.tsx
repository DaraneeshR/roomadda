"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatPaise, type KycViewStatus, type PublicListing, type PublicRoom } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { canPayWithKyc, isRoomBookable, payNowPaise } from "../../lib/booking";

/**
 * Web booking sheet — the discovery-side step before payment, mirroring the app.
 * Collects room / move-in date / meal plan, shows the SERVER token vs rent/deposit
 * and the cancellation policy in plain words, gates on KYC, then creates the hold
 * and routes to the payment page.
 *
 * The "Pay now" figure is the room's server-owned `tokenAmountPaise` read via
 * `payNowPaise` — never rent/deposit, never a client-side computation (see
 * /CLAUDE.md money rule #1 / the S1 fix).
 */
interface Props {
  listing: PublicListing;
  onClose: () => void;
}

const SHARING_LABELS: Record<number, string> = { 1: "Single", 2: "Double", 3: "Triple" };
const sharingLabel = (t: number): string => SHARING_LABELS[t] ?? `${t}-sharing`;

const MEAL_PLANS = ["Veg", "Non-veg", "No meals"] as const;

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BookingSheet({ listing, onClose }: Props): React.ReactNode {
  const { apiFetch } = useAuth();
  const router = useRouter();

  const bookableRooms = useMemo(() => listing.rooms.filter(isRoomBookable), [listing.rooms]);
  const [roomId, setRoomId] = useState<string | null>(bookableRooms[0]?.id ?? null);
  const room = useMemo<PublicRoom | null>(
    () => listing.rooms.find((r) => r.id === roomId) ?? null,
    [listing.rooms, roomId],
  );

  const todayIso = isoDate(new Date());
  const [moveIn, setMoveIn] = useState(todayIso);
  const [mealPlan, setMealPlan] = useState<string | null>(null);

  const [kycStatus, setKycStatus] = useState<KycViewStatus | null>(null);
  const [kycLoading, setKycLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mealsOffered = listing.amenities.some((a) => a.toUpperCase() === "MEALS");

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

  useEffect(() => {
    void loadKyc();
  }, [loadKyc]);

  async function createHold(): Promise<void> {
    if (!room) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: room.id,
          moveInDate: moveIn,
          ...(mealPlan ? { mealPlan } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Could not start your booking. Please try again.");
        return;
      }
      const { booking } = (await res.json()) as { booking: { id: string } };
      onClose();
      router.push(`/booking/${booking.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-sheet-title"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 id="booking-sheet-title" className="text-lg font-semibold text-slate-900">
            Book {listing.alias}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {/* Room type */}
        <h3 className="text-sm font-semibold text-slate-700">Room type</h3>
        <div className="mt-2 space-y-2">
          {listing.rooms.map((r) => {
            const bookable = isRoomBookable(r);
            const selected = r.id === roomId;
            return (
              <button
                key={r.id}
                type="button"
                disabled={!bookable}
                onClick={() => setRoomId(r.id)}
                className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
                  selected
                    ? "border-teal-500 bg-teal-50"
                    : bookable
                      ? "border-slate-200 hover:border-teal-300"
                      : "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60"
                }`}
              >
                <span>
                  <span className="block text-sm font-medium text-slate-900">
                    {r.name} · {sharingLabel(r.sharingType)}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {bookable ? `${r.availableBeds} bed(s) available` : "Full"}
                  </span>
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  {formatPaise(r.monthlyRentPaise)}
                  <span className="text-xs font-normal text-slate-500">/mo</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Move-in date */}
        <h3 className="mt-5 text-sm font-semibold text-slate-700">Move-in date</h3>
        <input
          type="date"
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          min={todayIso}
          value={moveIn}
          onChange={(e) => setMoveIn(e.target.value)}
        />

        {/* Meal plan (only when the PG offers meals) */}
        {mealsOffered && (
          <>
            <h3 className="mt-5 text-sm font-semibold text-slate-700">Meal plan</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {MEAL_PLANS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMealPlan((cur) => (cur === m ? null : m))}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    mealPlan === m
                      ? "border-teal-500 bg-teal-50 text-teal-800"
                      : "border-slate-300 text-slate-600 hover:border-teal-300"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Summary — the SERVER token, then rent + deposit + policy in plain words. */}
        {room && <Summary room={room} />}
        <CancellationPolicy />

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5">
          <Cta
            listing={listing}
            room={room}
            kycLoading={kycLoading}
            kycStatus={kycStatus}
            submitting={submitting}
            onBook={createHold}
            onRecheckKyc={loadKyc}
          />
        </div>
      </div>
    </div>
  );
}

function Summary({ room }: { room: PublicRoom }): React.ReactNode {
  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <Row label="Pay now (token)" value={formatPaise(payNowPaise(room))} accent />
      <Row label="Monthly rent" value={formatPaise(room.monthlyRentPaise)} />
      <Row label="Security deposit" value={formatPaise(room.depositPaise)} />
      <p className="mt-3 text-xs text-slate-500">
        The token secures your bed and adjusts against your first month&apos;s rent. It is charged by our
        server — the amount above is final.
      </p>
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

function CancellationPolicy(): React.ReactNode {
  return (
    <div className="mt-3 rounded-xl bg-slate-100 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Cancellation policy</p>
      <p className="mt-1 text-xs text-slate-600">
        Full refund if cancelled more than 7 days before move-in · 50% refund 3–7 days before · no refund
        within 3 days of move-in.
      </p>
    </div>
  );
}

/**
 * The call-to-action. Payment is gated on VERIFIED KYC — the backend enforces it
 * (requireKyc), and the web flow surfaces it here rather than letting a hold be
 * attempted that would 403. The KYC prompt links to the P4.1 web KYC upload.
 */
function Cta({
  listing,
  room,
  kycLoading,
  kycStatus,
  submitting,
  onBook,
  onRecheckKyc,
}: {
  listing: PublicListing;
  room: PublicRoom | null;
  kycLoading: boolean;
  kycStatus: KycViewStatus | null;
  submitting: boolean;
  onBook: () => void;
  onRecheckKyc: () => void;
}): React.ReactNode {
  if (!room) {
    return <BlockedButton label="No beds available" />;
  }
  if (kycLoading) {
    return <BlockedButton label="Checking your KYC…" />;
  }
  if (!canPayWithKyc(kycStatus)) {
    return <KycGate status={kycStatus} onRecheck={onRecheckKyc} />;
  }
  const label = listing.instantBook ? "Book now — pay token" : "Request to book";
  return (
    <button
      type="button"
      disabled={submitting}
      onClick={onBook}
      className="w-full rounded-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {submitting ? "Please wait…" : label}
    </button>
  );
}

function KycGate({ status, onRecheck }: { status: KycViewStatus | null; onRecheck: () => void }): React.ReactNode {
  const message =
    status === "PENDING"
      ? "Your identity is under review. You can pay the token once it's verified."
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
