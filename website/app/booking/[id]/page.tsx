"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatPaise, type BookingDetail } from "@roomadda/shared";
import { useAuth } from "../../../components/auth/AuthProvider";
import {
  classifyBooking,
  isAwaitingApproval,
  isPayable,
  isRealCheckout,
  onlinePaymentBody,
  revealedListing,
  type TokenPaymentOrder,
} from "../../../lib/booking";
import { openTokenCheckout } from "../../../lib/razorpayCheckout";

/**
 * Web token payment + confirmation. Mirrors the app exactly (see /CLAUDE.md
 * domain rule #2): the Razorpay success callback means "submitted", NOT
 * confirmed. Confirmation is owned by the poll below, which watches the server
 * for the webhook-driven CONFIRMED. A callback alone NEVER confirms.
 *
 * Locally the gateway is stubbed (`order_stub_…`), so real checkout can't run —
 * the flow drops straight into the "confirming" poll and `demo:confirm` fires
 * the signed webhook that settles the booking, exactly the proven app path.
 */
type Stage =
  | "loading"
  | "needsAuth"
  | "notFound"
  | "awaitingApproval"
  | "payable"
  | "preparing"
  | "paying"
  | "confirming"
  | "confirmed"
  | "expired"
  | "paymentFailed"
  | "timedOut"
  | "error";

// Poll cadence for the "confirming" step — same shape as the app's poller.
const POLL_INITIAL_MS = 3000;
const POLL_MAX_MS = 12000;
const POLL_TIMEOUT_MS = 90000;
const APPROVAL_POLL_MS = 6000;

export default function BookingPaymentPage(): React.ReactNode {
  const { id } = useParams<{ id: string }>();
  const { status: authStatus, apiFetch, login } = useAuth();

  const [stage, setStage] = useState<Stage>("loading");
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [devHint, setDevHint] = useState(false);

  const fetchBooking = useCallback(async (): Promise<BookingDetail | null> => {
    const res = await apiFetch(`/api/bookings/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Could not load your booking.");
    const { booking: b } = (await res.json()) as { booking: BookingDetail };
    return b;
  }, [apiFetch, id]);

  // Map a fresh snapshot to the right stage (shared by the initial load and the
  // pollers). Only the SERVER's status drives this.
  const applySnapshot = useCallback((b: BookingDetail) => {
    setBooking(b);
    const terminal = classifyBooking(b);
    if (terminal?.kind === "confirmed") return setStage("confirmed");
    if (terminal?.kind === "expired") return setStage("expired");
    if (terminal?.kind === "paymentFailed") return setStage("paymentFailed");
    if (isAwaitingApproval(b)) return setStage("awaitingApproval");
    if (isPayable(b)) return setStage("payable");
    return undefined;
  }, []);

  // Initial load once we know the auth state.
  useEffect(() => {
    if (authStatus === "loading") return;
    if (authStatus === "anonymous") {
      setStage("needsAuth");
      return;
    }
    let active = true;
    (async () => {
      try {
        const b = await fetchBooking();
        if (!active) return;
        if (!b) return setStage("notFound");
        applySnapshot(b);
      } catch (e) {
        if (!active) return;
        setMessage(e instanceof Error ? e.message : "Something went wrong.");
        setStage("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [authStatus, fetchBooking, applySnapshot]);

  // Request-to-Book: poll until the host accepts (→ TOKEN_PENDING) or it ends.
  useEffect(() => {
    if (stage !== "awaitingApproval") return;
    let active = true;
    const tick = async () => {
      try {
        const b = await fetchBooking();
        if (!active || !b) return;
        if (b.status !== "PENDING_APPROVAL") applySnapshot(b);
      } catch {
        /* transient — keep waiting */
      }
    };
    const timer = setInterval(() => void tick(), APPROVAL_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [stage, fetchBooking, applySnapshot]);

  // The confirmation poll: runs ONLY while "confirming". Backs off and gives up
  // after the window (offering "check again") — it never fabricates a confirm.
  const pollToken = useRef(0);
  const startConfirming = useCallback(() => {
    setStage("confirming");
    const token = ++pollToken.current;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let interval = POLL_INITIAL_MS;

    const loop = async () => {
      if (token !== pollToken.current) return; // superseded / unmounted
      try {
        const b = await fetchBooking();
        if (token !== pollToken.current) return;
        if (b) {
          const terminal = classifyBooking(b);
          if (terminal) {
            setBooking(b);
            setStage(
              terminal.kind === "confirmed"
                ? "confirmed"
                : terminal.kind === "expired"
                  ? "expired"
                  : "paymentFailed",
            );
            return;
          }
        }
      } catch {
        /* a single failed poll never breaks the flow */
      }
      if (token !== pollToken.current) return;
      if (Date.now() >= deadline) {
        setStage("timedOut");
        return;
      }
      setTimeout(() => void loop(), interval);
      interval = Math.min(Math.round(interval * 1.5), POLL_MAX_MS);
    };
    void loop();
  }, [fetchBooking]);

  // Stop any in-flight poll when leaving the page.
  useEffect(() => () => void ++pollToken.current, []);

  async function pay(): Promise<void> {
    if (!booking) return;
    setStage("preparing");
    setMessage(null);
    try {
      const res = await apiFetch(`/api/bookings/${encodeURIComponent(id)}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ONLINE-only: the full SERVER token, read from the booking DTO.
        body: JSON.stringify(onlinePaymentBody(booking.tokenAmountPaise)),
      });
      if (res.status === 409) {
        // A payment was already initiated for this booking — just start polling.
        startConfirming();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setMessage(body.message ?? "Could not start the payment. Please try again.");
        setStage("payable");
        return;
      }
      const order = (await res.json()) as TokenPaymentOrder;

      if (isRealCheckout(order.razorpayOrder)) {
        setStage("paying");
        await openTokenCheckout(order.razorpayOrder!, {
          onSubmitted: () => startConfirming(), // submitted, NOT confirmed
          onFailed: (m) => {
            setMessage(m);
            setStage("payable");
          },
        });
      } else {
        // Local/dev: no reachable gateway. Poll for the webhook fired by
        // `pnpm --filter @roomadda/backend demo:confirm`.
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
      <h1 className="text-2xl font-bold text-slate-900">Secure your bed</h1>
      {booking && (
        <p className="mt-1 text-slate-600">
          Token to pay now:{" "}
          <span className="font-semibold text-teal-700">{formatPaise(booking.tokenAmountPaise)}</span>
        </p>
      )}

      <div className="mt-8">
        <Body
          stage={stage}
          booking={booking}
          message={message}
          devHint={devHint}
          bookingId={id}
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
  booking,
  message,
  devHint,
  bookingId,
  apiFetch,
  onPay,
  onLogin,
  onCheckAgain,
}: {
  stage: Stage;
  booking: BookingDetail | null;
  message: string | null;
  devHint: boolean;
  bookingId: string;
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onPay: () => void;
  onLogin: () => void;
  onCheckAgain: () => void;
}): React.ReactNode {
  switch (stage) {
    case "loading":
      return <Busy message="Loading your booking…" />;
    case "needsAuth":
      return (
        <Notice title="Please log in">
          <p className="text-sm text-slate-600">Log in to complete your booking.</p>
          <PrimaryButton onClick={onLogin}>Log in</PrimaryButton>
        </Notice>
      );
    case "notFound":
      return (
        <Notice title="Booking not found" tone="warn">
          <p className="text-sm text-slate-600">
            We couldn&apos;t find this booking on your account.
          </p>
          <Link href="/search" className="text-sm font-semibold text-teal-700 hover:underline">
            Back to search →
          </Link>
        </Notice>
      );
    case "awaitingApproval":
      return (
        <Busy message="Waiting for the host to accept your request. We'll continue to payment automatically." />
      );
    case "payable":
      return (
        <Notice title="Pay your token">
          <p className="text-sm text-slate-600">
            Pay the token online to secure this bed. You&apos;ll be confirmed once the payment settles.
          </p>
          {message && <ErrorText>{message}</ErrorText>}
          <PrimaryButton onClick={onPay}>Pay token online</PrimaryButton>
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
          {devHint && <DevConfirmHint />}
        </div>
      );
    case "confirmed":
      return booking ? <Confirmed booking={booking} bookingId={bookingId} apiFetch={apiFetch} /> : null;
    case "expired":
      return (
        <Notice title="Your hold expired" tone="warn">
          <p className="text-sm text-slate-600">
            The hold on this bed lapsed before the payment was confirmed. If you were charged, it will be
            refunded automatically.
          </p>
          <Link href="/search" className="text-sm font-semibold text-teal-700 hover:underline">
            Find another PG →
          </Link>
        </Notice>
      );
    case "paymentFailed":
      return (
        <Notice title="Payment failed" tone="warn">
          <p className="text-sm text-slate-600">The payment didn&apos;t go through. Please try booking again.</p>
          <Link href="/search" className="text-sm font-semibold text-teal-700 hover:underline">
            Back to search →
          </Link>
        </Notice>
      );
    case "timedOut":
      return (
        <Notice title="Still confirming" tone="warn">
          <p className="text-sm text-slate-600">
            We haven&apos;t received confirmation yet — the payment may still be settling. You can check again.
          </p>
          {devHint && <DevConfirmHint />}
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

/** Success screen. The booking is now CONFIRMED, so the host name + the unmasked
 *  listing are present (revealed server-side). Offers the PDF receipt + an app nudge. */
function Confirmed({
  booking,
  bookingId,
  apiFetch,
}: {
  booking: BookingDetail;
  bookingId: string;
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
}): React.ReactNode {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listing = revealedListing(booking);

  async function downloadReceipt(): Promise<void> {
    setDownloading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/bookings/${encodeURIComponent(bookingId)}/receipt`);
      if (!res.ok) {
        setError("The receipt isn't ready yet. Please try again shortly.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `roomadda-receipt-${bookingId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not download the receipt.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-2xl text-white">
        ✓
      </div>
      <h2 className="mt-4 text-xl font-bold text-slate-900">Booking confirmed</h2>
      <p className="mt-1 text-sm text-slate-600">Confirmed by our server — your bed is secured.</p>

      <dl className="mt-6 space-y-2 rounded-xl bg-white p-4 text-left">
        <DetailRow label="Booking ID" value={booking.id} mono />
        {listing && <DetailRow label="PG" value={listing.actualName} />}
        {booking.hostName && <DetailRow label="Host" value={booking.hostName} />}
        {booking.moveInDate && (
          <DetailRow label="Move-in" value={new Date(booking.moveInDate).toLocaleDateString("en-IN")} />
        )}
        {booking.mealPlan && <DetailRow label="Meal plan" value={booking.mealPlan} />}
        <DetailRow label="Token paid" value={formatPaise(booking.tokenAmountPaise)} />
        {listing && <DetailRow label="Address" value={listing.fullAddress} />}
      </dl>

      {error && <ErrorText>{error}</ErrorText>}

      <button
        type="button"
        onClick={() => void downloadReceipt()}
        disabled={downloading}
        className="mt-5 w-full rounded-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
      >
        {downloading ? "Preparing…" : "Download receipt (PDF)"}
      </button>

      <div className="mt-4 rounded-xl bg-slate-100 p-4 text-left">
        <p className="text-sm font-semibold text-slate-800">Get the RoomAdda app</p>
        <p className="mt-1 text-xs text-slate-600">
          Chat with your host, pay rent, and manage your stay on the go.
        </p>
      </div>

      <Link
        href="/search"
        className="mt-4 inline-block text-sm font-semibold text-teal-700 hover:underline"
      >
        Browse more PGs →
      </Link>
    </div>
  );
}

function DevConfirmHint(): React.ReactNode {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-left">
      <p className="text-xs font-semibold text-slate-700">Local dev — no live gateway</p>
      <p className="mt-1 text-xs text-slate-600">
        Fire the signed webhook to settle this booking, then this page will confirm on its own:
      </p>
      <code className="mt-1 block rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-100">
        pnpm --filter @roomadda/backend demo:confirm
      </code>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactNode {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-right text-sm text-slate-900 ${mono ? "font-mono text-xs" : "font-medium"}`}>
        {value}
      </dd>
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

function PrimaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactNode {
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
