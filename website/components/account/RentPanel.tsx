"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatPaise, type RentInvoice } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { isRealCheckout } from "../../lib/booking";
import { isRentPaid, isRentPayable, rentAmountPaise, type RentPayOrder } from "../../lib/rent";
import { openCheckout } from "../../lib/razorpayCheckout";
import { downloadPdf } from "../../lib/downloadPdf";

/**
 * Web "Pay Rent". The amount to pay is the invoice's SERVER-OWNED `amountPaise`
 * read from the DTO (never computed). Paying opens Razorpay web checkout (or the
 * local demo fallback); the invoice becomes PAID ONLY when the page polls the
 * server to `PAID` — the verified webhook is the sole path (RENT IS MONEY; see
 * /CLAUDE.md domain rule #2). A callback never marks it PAID.
 */
const POLL_INITIAL_MS = 3000;
const POLL_MAX_MS = 12000;
const POLL_TIMEOUT_MS = 90000;

export function RentPanel(): React.ReactNode {
  const { apiFetch } = useAuth();
  const [invoices, setInvoices] = useState<RentInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/rent?limit=24");
      if (!res.ok) {
        setError("Could not load your rent history.");
        return;
      }
      const body = (await res.json()) as { items: RentInvoice[] };
      setInvoices(body.items);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const payable = invoices.find(isRentPayable) ?? null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Pay rent</h1>
      <p className="mt-1 text-sm text-slate-600">
        The amount is set by our server — pay online and you&apos;re marked paid once it settles.
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="mt-6 h-40 animate-pulse rounded-xl bg-slate-100" />
      ) : invoices.length === 0 ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">
          No rent is due yet. Rent begins the month after your move-in.
        </div>
      ) : (
        <>
          {payable ? (
            <RentPayCard key={payable.id} invoice={payable} onPaid={load} />
          ) : (
            <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5 text-center text-sm text-green-800">
              You&apos;re all caught up — no rent due right now.
            </div>
          )}
          <RentHistory invoices={invoices} />
        </>
      )}
    </div>
  );
}

type Stage = "idle" | "preparing" | "paying" | "confirming" | "paid" | "timedOut" | "failed";

function RentPayCard({ invoice, onPaid }: { invoice: RentInvoice; onPaid: () => void }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [devHint, setDevHint] = useState(false);
  const pollToken = useRef(0);

  useEffect(() => () => void ++pollToken.current, []);

  const startConfirming = useCallback(() => {
    setStage("confirming");
    const token = ++pollToken.current;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let interval = POLL_INITIAL_MS;
    const loop = async () => {
      if (token !== pollToken.current) return;
      try {
        const res = await apiFetch(`/api/rent/${encodeURIComponent(invoice.id)}`);
        if (token !== pollToken.current) return;
        if (res.ok) {
          const { invoice: fresh } = (await res.json()) as { invoice: RentInvoice };
          if (isRentPaid(fresh)) {
            setStage("paid");
            onPaid();
            return;
          }
        }
      } catch {
        /* transient — keep polling */
      }
      if (token !== pollToken.current) return;
      if (Date.now() >= deadline) return setStage("timedOut");
      setTimeout(() => void loop(), interval);
      interval = Math.min(Math.round(interval * 1.5), POLL_MAX_MS);
    };
    void loop();
  }, [apiFetch, invoice.id, onPaid]);

  async function pay(): Promise<void> {
    setStage("preparing");
    setMessage(null);
    try {
      const res = await apiFetch(`/api/rent/${encodeURIComponent(invoice.id)}/pay`, { method: "POST" });
      if (res.status === 409) {
        // Already paid / order exists — just poll for the settled state.
        startConfirming();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setMessage(body.message ?? "Could not start the payment. Please try again.");
        setStage("idle");
        return;
      }
      const order = (await res.json()) as RentPayOrder;
      if (isRealCheckout(order.razorpayOrder)) {
        setStage("paying");
        await openCheckout(
          order.razorpayOrder,
          {
            onSubmitted: () => startConfirming(), // submitted, NOT paid
            onFailed: (m) => {
              setMessage(m);
              setStage("idle");
            },
          },
          `Rent — ${invoice.periodLabel}`,
        );
      } else {
        setDevHint(true);
        startConfirming();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Payment could not be started.");
      setStage("idle");
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">Rent due · {invoice.periodLabel}</p>
          <p className="mt-0.5 text-xs text-slate-600">
            Due {new Date(invoice.dueDate).toLocaleDateString("en-IN")}
            {invoice.status === "OVERDUE" && (
              <span className="ml-1 font-semibold text-red-600">· {invoice.daysOverdue} day(s) overdue</span>
            )}
          </p>
        </div>
        {/* Server-owned amount — read from the DTO, never computed. */}
        <p className="text-xl font-bold text-slate-900">{formatPaise(rentAmountPaise(invoice))}</p>
      </div>

      {message && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}

      <div className="mt-4">
        {stage === "idle" && (
          <button
            type="button"
            onClick={() => void pay()}
            className="w-full rounded-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700"
          >
            Pay {formatPaise(rentAmountPaise(invoice))} now
          </button>
        )}
        {stage === "preparing" && <Busy>Setting up your payment…</Busy>}
        {stage === "paying" && <Busy>Complete the payment in the Razorpay window…</Busy>}
        {stage === "confirming" && (
          <>
            <Busy>Confirming your payment… settled by our server, not your browser.</Busy>
            {devHint && <DevHint />}
          </>
        )}
        {stage === "paid" && (
          <p className="rounded-md bg-green-100 px-3 py-2 text-sm font-semibold text-green-800">
            ✓ Rent paid — confirmed by our server.
          </p>
        )}
        {stage === "timedOut" && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              Not confirmed yet — it may still be settling. You can check again.
            </p>
            {devHint && <DevHint />}
            <button
              type="button"
              onClick={startConfirming}
              className="w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
            >
              Check again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RentHistory({ invoices }: { invoices: RentInvoice[] }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function receipt(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    const err = await downloadPdf(apiFetch, `/api/rent/${encodeURIComponent(id)}/receipt`, `roomadda-rent-${id}.pdf`);
    setError(err);
    setBusyId(null);
  }

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-slate-700">Rent history</h2>
      {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="mt-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {invoices.map((inv) => (
          <li key={inv.id} className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-medium text-slate-900">{inv.periodLabel}</p>
              <p className="text-xs text-slate-500">
                {formatPaise(inv.amountPaise)} · {rentStatusLabel(inv)}
              </p>
            </div>
            {isRentPaid(inv) ? (
              <button
                type="button"
                onClick={() => void receipt(inv.id)}
                disabled={busyId === inv.id}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {busyId === inv.id ? "Preparing…" : "Receipt"}
              </button>
            ) : (
              <span className="text-xs font-semibold text-amber-700">{inv.status}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function rentStatusLabel(inv: RentInvoice): string {
  if (inv.status === "PAID") return inv.paidAt ? `Paid ${new Date(inv.paidAt).toLocaleDateString("en-IN")}` : "Paid";
  if (inv.status === "OVERDUE") return `Overdue by ${inv.daysOverdue} day(s)`;
  return `Due ${new Date(inv.dueDate).toLocaleDateString("en-IN")}`;
}

function Busy({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-600">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
      <span>{children}</span>
    </div>
  );
}

function DevHint(): React.ReactNode {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3">
      <p className="text-xs font-semibold text-slate-700">Local dev — no live gateway</p>
      <code className="mt-1 block rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-100">
        pnpm --filter @roomadda/backend demo:confirm
      </code>
    </div>
  );
}
