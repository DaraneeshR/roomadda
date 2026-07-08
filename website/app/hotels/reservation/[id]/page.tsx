"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatPaise, type HotelReservation } from "@roomadda/shared";
import { useAuth } from "../../../../components/auth/AuthProvider";
import { QrCode } from "../../../../components/hotels/QrCode";
import {
  checkInCode,
  classifyReservation,
  isRealCheckout,
  isReservationPayable,
  reservationTokenPaise,
  reservationTotalPaise,
  type HotelPaymentOrder,
} from "../../../../lib/hotel";
import { openCheckout } from "../../../../lib/razorpayCheckout";
import { downloadPdf } from "../../../../lib/downloadPdf";

/**
 * Web hotel payment + confirmation. Mirrors the PG booking flow exactly (see
 * /CLAUDE.md domain rule #2): the Razorpay success callback means "submitted", NOT
 * confirmed. Confirmation is owned by the poll below, which watches the SERVER for
 * the webhook-driven CONFIRMED (which also mints the check-in QR). A callback alone
 * NEVER confirms.
 *
 * Locally the gateway is stubbed (`order_stub_…`), so real checkout can't run — the
 * flow drops straight into the "confirming" poll and `demo:confirm` fires the
 * signed webhook that settles the reservation, exactly the proven app path.
 */
type Stage =
  | "loading"
  | "needsAuth"
  | "notFound"
  | "payable"
  | "preparing"
  | "paying"
  | "confirming"
  | "confirmed"
  | "expired"
  | "timedOut"
  | "error";

const POLL_INITIAL_MS = 3000;
const POLL_MAX_MS = 12000;
const POLL_TIMEOUT_MS = 90000;

export default function HotelReservationPage(): React.ReactNode {
  const { id } = useParams<{ id: string }>();
  const { status: authStatus, apiFetch, login } = useAuth();

  const [stage, setStage] = useState<Stage>("loading");
  const [reservation, setReservation] = useState<HotelReservation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [devHint, setDevHint] = useState(false);

  const fetchReservation = useCallback(async (): Promise<HotelReservation | null> => {
    const res = await apiFetch(`/api/hotels/reservations/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Could not load your reservation.");
    const { reservation: r } = (await res.json()) as { reservation: HotelReservation };
    return r;
  }, [apiFetch, id]);

  // Map a fresh snapshot to the right stage — ONLY the server's status drives this.
  const applySnapshot = useCallback((r: HotelReservation) => {
    setReservation(r);
    const terminal = classifyReservation(r);
    if (terminal?.kind === "confirmed") return setStage("confirmed");
    if (terminal?.kind === "expired") return setStage("expired");
    if (isReservationPayable(r)) return setStage("payable");
    return undefined;
  }, []);

  useEffect(() => {
    if (authStatus === "loading") return;
    if (authStatus === "anonymous") {
      setStage("needsAuth");
      return;
    }
    let active = true;
    (async () => {
      try {
        const r = await fetchReservation();
        if (!active) return;
        if (!r) return setStage("notFound");
        applySnapshot(r);
      } catch (e) {
        if (!active) return;
        setMessage(e instanceof Error ? e.message : "Something went wrong.");
        setStage("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [authStatus, fetchReservation, applySnapshot]);

  // The confirmation poll: runs ONLY while "confirming". Backs off and gives up
  // after the window (offering "check again") — it never fabricates a confirm.
  const pollToken = useRef(0);
  const startConfirming = useCallback(() => {
    setStage("confirming");
    const token = ++pollToken.current;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let interval = POLL_INITIAL_MS;

    const loop = async () => {
      if (token !== pollToken.current) return;
      try {
        const r = await fetchReservation();
        if (token !== pollToken.current) return;
        if (r) {
          const terminal = classifyReservation(r);
          if (terminal) {
            setReservation(r);
            setStage(terminal.kind === "confirmed" ? "confirmed" : "expired");
            return;
          }
        }
      } catch {
        /* a single failed poll never breaks the flow */
      }
      if (token !== pollToken.current) return;
      if (Date.now() >= deadline) return setStage("timedOut");
      setTimeout(() => void loop(), interval);
      interval = Math.min(Math.round(interval * 1.5), POLL_MAX_MS);
    };
    void loop();
  }, [fetchReservation]);

  // Stop any in-flight poll when leaving the page.
  useEffect(() => () => void ++pollToken.current, []);

  async function pay(): Promise<void> {
    if (!reservation) return;
    setStage("preparing");
    setMessage(null);
    try {
      // No body — the backend owns the amount (full-stay prepay). The client can
      // never set the price.
      const res = await apiFetch(`/api/hotels/reservations/${encodeURIComponent(id)}/payment`, { method: "POST" });
      if (res.status === 409) {
        // A payment was already initiated — just start polling.
        startConfirming();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setMessage(body.message ?? "Could not start the payment. Please try again.");
        setStage("payable");
        return;
      }
      const order = (await res.json()) as HotelPaymentOrder;

      if (isRealCheckout(order.razorpayOrder)) {
        setStage("paying");
        await openCheckout(
          order.razorpayOrder!,
          {
            onSubmitted: () => startConfirming(), // submitted, NOT confirmed
            onFailed: (m) => {
              setMessage(m);
              setStage("payable");
            },
          },
          "Hotel booking",
        );
      } else {
        // Local/dev: no reachable gateway. Poll for the webhook fired by demo:confirm.
        setDevHint(true);
        startConfirming();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Payment could not be started.");
      setStage("payable");
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Confirm your stay</h1>
      {reservation && (
        <p className="mt-1 text-slate-600">
          Pay now:{" "}
          <span className="font-semibold text-teal-700">{formatPaise(reservationTokenPaise(reservation))}</span>{" "}
          <span className="text-sm text-slate-500">
            ({reservation.nights} night{reservation.nights === 1 ? "" : "s"})
          </span>
        </p>
      )}

      <div className="mt-8">
        <Body
          stage={stage}
          reservation={reservation}
          message={message}
          devHint={devHint}
          reservationId={id}
          apiFetch={apiFetch}
          onPay={pay}
          onLogin={() => login()}
          onCheckAgain={startConfirming}
        />
      </div>
    </main>
  );
}

function Body({
  stage,
  reservation,
  message,
  devHint,
  reservationId,
  apiFetch,
  onPay,
  onLogin,
  onCheckAgain,
}: {
  stage: Stage;
  reservation: HotelReservation | null;
  message: string | null;
  devHint: boolean;
  reservationId: string;
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onPay: () => void;
  onLogin: () => void;
  onCheckAgain: () => void;
}): React.ReactNode {
  switch (stage) {
    case "loading":
      return <Busy message="Loading your reservation…" />;
    case "needsAuth":
      return (
        <Notice title="Please log in">
          <p className="text-sm text-slate-600">Log in to complete your booking.</p>
          <PrimaryButton onClick={onLogin}>Log in</PrimaryButton>
        </Notice>
      );
    case "notFound":
      return (
        <Notice title="Reservation not found" tone="warn">
          <p className="text-sm text-slate-600">We couldn&apos;t find this reservation on your account.</p>
          <Link href="/hotels" className="text-sm font-semibold text-teal-700 hover:underline">
            Back to hotels →
          </Link>
        </Notice>
      );
    case "payable":
      return (
        <Notice title="Pay to confirm">
          {reservation && <StaySummary reservation={reservation} />}
          <p className="text-sm text-slate-600">
            Pay the full stay online to confirm your room. You&apos;ll be confirmed once the payment settles.
          </p>
          {message && <ErrorText>{message}</ErrorText>}
          <PrimaryButton onClick={onPay}>Pay &amp; confirm</PrimaryButton>
        </Notice>
      );
    case "preparing":
      return <Busy message="Setting up your payment…" />;
    case "paying":
      return <Busy message="Complete the payment in the Razorpay window…" />;
    case "confirming":
      return (
        <div className="space-y-4">
          <Busy message={"Confirming your booking…\nThis is settled by our server, not your browser."} />
          {devHint && <DevConfirmHint reservationId={reservationId} />}
        </div>
      );
    case "confirmed":
      return reservation ? (
        <Confirmed reservation={reservation} reservationId={reservationId} apiFetch={apiFetch} />
      ) : null;
    case "expired":
      return (
        <Notice title="This reservation ended" tone="warn">
          <p className="text-sm text-slate-600">
            The hold lapsed or the reservation was cancelled before it was confirmed. If you were charged, it
            will be refunded automatically.
          </p>
          <Link href="/hotels" className="text-sm font-semibold text-teal-700 hover:underline">
            Find another hotel →
          </Link>
        </Notice>
      );
    case "timedOut":
      return (
        <Notice title="Still confirming" tone="warn">
          <p className="text-sm text-slate-600">
            We haven&apos;t received confirmation yet — the payment may still be settling. You can check again.
          </p>
          {devHint && <DevConfirmHint reservationId={reservationId} />}
          <PrimaryButton onClick={onCheckAgain}>Check again</PrimaryButton>
        </Notice>
      );
    case "error":
      return (
        <Notice title="Something went wrong" tone="warn">
          <p className="text-sm text-slate-600">{message ?? "Please try again in a moment."}</p>
          <PrimaryButton onClick={onCheckAgain}>Check again</PrimaryButton>
        </Notice>
      );
    default:
      return null;
  }
}

/**
 * Success screen. The reservation is CONFIRMED (by the verified webhook), so the
 * check-in QR is minted server-side and present. Shows it plus the stay summary,
 * a downloadable receipt, and the cancellation path.
 */
function Confirmed({
  reservation,
  reservationId,
  apiFetch,
}: {
  reservation: HotelReservation;
  reservationId: string;
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
}): React.ReactNode {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = checkInCode(reservation);

  async function download(): Promise<void> {
    setDownloading(true);
    setError(null);
    const err = await downloadPdf(
      apiFetch,
      `/api/hotels/reservations/${encodeURIComponent(reservationId)}/receipt`,
      `roomadda-hotel-receipt-${reservationId}.pdf`,
    );
    if (err) setError(err);
    setDownloading(false);
  }

  return (
    <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-2xl text-white">
        ✓
      </div>
      <h2 className="mt-4 text-xl font-bold text-slate-900">Booking confirmed</h2>
      <p className="mt-1 text-sm text-slate-600">Confirmed by our server — your room is secured.</p>

      {/* Check-in QR — minted only on the webhook-driven CONFIRMED. */}
      {code ? (
        <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-4 shadow-sm">
          <QrCode value={code} size={200} />
          <p className="mt-2 font-mono text-xs text-slate-500">{code}</p>
          <p className="mt-1 text-xs text-slate-500">Show this at the front desk to check in.</p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">Your check-in code is being generated…</p>
      )}

      <dl className="mt-6 space-y-2 rounded-xl bg-white p-4 text-left">
        <DetailRow label="Reservation ID" value={reservation.id} mono />
        <DetailRow label="Check-in" value={new Date(reservation.checkIn).toLocaleDateString("en-IN")} />
        <DetailRow label="Check-out" value={new Date(reservation.checkOut).toLocaleDateString("en-IN")} />
        <DetailRow label="Nights" value={String(reservation.nights)} />
        <DetailRow label="Per night" value={formatPaise(reservation.perNightPaise)} />
        <DetailRow label="Total paid" value={formatPaise(reservationTotalPaise(reservation))} />
      </dl>

      {error && <ErrorText>{error}</ErrorText>}

      <button
        type="button"
        onClick={() => void download()}
        disabled={downloading}
        className="mt-5 w-full rounded-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
      >
        {downloading ? "Preparing…" : "Download receipt (PDF)"}
      </button>

      <CancelReservation reservationId={reservationId} apiFetch={apiFetch} />

      <Link href="/hotels" className="mt-4 inline-block text-sm font-semibold text-teal-700 hover:underline">
        Browse more hotels →
      </Link>
    </div>
  );
}

/**
 * Cancellation via the existing refund path. The backend computes the refund per
 * policy and INITIATES it; it settles ONLY via the verified refund webhook, so we
 * report the refund as pending — the client never settles money.
 */
function CancelReservation({
  reservationId,
  apiFetch,
}: {
  reservationId: string;
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
}): React.ReactNode {
  const [state, setState] = useState<"idle" | "confirming" | "working" | "done">("idle");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(): Promise<void> {
    setState("working");
    setError(null);
    try {
      const res = await apiFetch(`/api/hotels/reservations/${encodeURIComponent(reservationId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Cancelled from web" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Could not cancel this reservation.");
        setState("confirming");
        return;
      }
      const body = (await res.json()) as { refundPaise?: number };
      setResult(
        typeof body.refundPaise === "number"
          ? `Cancelled. A refund of ${formatPaise(body.refundPaise)} is being processed.`
          : "Cancelled. Any refund will be processed automatically.",
      );
      setState("done");
    } catch {
      setError("Network error. Please try again.");
      setState("confirming");
    }
  }

  if (state === "done") {
    return <p className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{result}</p>;
  }

  return (
    <div className="mt-4">
      {state === "idle" ? (
        <button
          type="button"
          onClick={() => setState("confirming")}
          className="text-xs font-medium text-slate-500 underline hover:text-slate-700"
        >
          Cancel this reservation
        </button>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-left">
          <p className="text-sm text-slate-700">
            Cancel this reservation? Any eligible refund is processed to your original payment method.
          </p>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={state === "working"}
              onClick={() => void cancel()}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {state === "working" ? "Cancelling…" : "Yes, cancel"}
            </button>
            <button
              type="button"
              disabled={state === "working"}
              onClick={() => setState("idle")}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StaySummary({ reservation }: { reservation: HotelReservation }): React.ReactNode {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <SummaryRow
        label={`${reservation.nights} night${reservation.nights === 1 ? "" : "s"} × ${formatPaise(reservation.perNightPaise)}`}
        value={formatPaise(reservationTotalPaise(reservation))}
      />
      <SummaryRow label="Pay now" value={formatPaise(reservationTokenPaise(reservation))} accent />
    </div>
  );
}

function SummaryRow({ label, value, accent }: { label: string; value: string; accent?: boolean }): React.ReactNode {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-sm font-semibold ${accent ? "text-teal-700" : "text-slate-900"}`}>{value}</span>
    </div>
  );
}

function DevConfirmHint({ reservationId }: { reservationId: string }): React.ReactNode {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-left">
      <p className="text-xs font-semibold text-slate-700">Local dev — no live gateway</p>
      <p className="mt-1 text-xs text-slate-600">
        Fire the signed webhook to settle this reservation, then this page confirms on its own:
      </p>
      <code className="mt-1 block break-all rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-100">
        pnpm --filter @roomadda/backend demo:confirm {reservationId}
      </code>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactNode {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-right text-sm text-slate-900 ${mono ? "font-mono text-xs" : "font-medium"}`}>{value}</dd>
    </div>
  );
}

function Busy({ message }: { message: string }): React.ReactNode {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
      <p className="whitespace-pre-line text-sm text-slate-600">{message}</p>
    </div>
  );
}

function Notice({
  title,
  tone = "info",
  children,
}: {
  title: string;
  tone?: "info" | "warn";
  children: React.ReactNode;
}): React.ReactNode {
  const border = tone === "warn" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white";
  return (
    <div className={`space-y-3 rounded-2xl border p-6 ${border}`}>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700"
    >
      {children}
    </button>
  );
}

function ErrorText({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {children}
    </p>
  );
}
