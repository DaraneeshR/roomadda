"use client";

import { useState, type ReactNode } from "react";
import type { CorporateInvoice, CorporatePaymentResponse } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { invoiceStatusLabel, isInvoicePayable } from "../../lib/corporate";
import { openCheckout } from "../../lib/razorpayCheckout";
import { Card, Empty, ErrorNote, Pill, SectionTitle, money, useCorporateList } from "./shared";

const TONE: Record<string, string> = { DUE: "amber", PAID: "green", OVERDUE: "red" };

/**
 * Company invoices + online payment. Paying opens Razorpay checkout, then POLLS
 * the invoice until the server reports PAID — settlement is owned SOLELY by the
 * signature-verified webhook (the checkout success callback is "submitted", never
 * "paid"; /CLAUDE.md money rule #2). Amounts are server-owned, never computed here.
 */
export function InvoicesPanel(): ReactNode {
  const { items, loading, error, reload } = useCorporateList<CorporateInvoice>("/api/corporate/invoices");

  return (
    <div className="space-y-4">
      <SectionTitle>Invoices</SectionTitle>
      {loading ? (
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      ) : error ? (
        <ErrorNote>Couldn&apos;t load invoices. {error}</ErrorNote>
      ) : items.length === 0 ? (
        <Empty>No invoices yet.</Empty>
      ) : (
        items.map((inv) => <InvoiceRow key={inv.id} invoice={inv} onPaid={reload} />)
      )}
    </div>
  );
}

function InvoiceRow({ invoice, onPaid }: { invoice: CorporateInvoice; onPaid: () => void }): ReactNode {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<"idle" | "opening" | "polling" | "paid" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  /** Poll the invoice until the WEBHOOK flips it to PAID (never the callback). */
  async function pollUntilPaid(): Promise<void> {
    setState("polling");
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await apiFetch("/api/corporate/invoices");
      if (!res.ok) continue;
      const data = (await res.json()) as { items: CorporateInvoice[] };
      const fresh = data.items.find((x) => x.id === invoice.id);
      if (fresh && fresh.status === "PAID") {
        setState("paid");
        onPaid();
        return;
      }
    }
    setState("error");
    setMessage("We haven't received confirmation yet. It can take a moment — refresh shortly.");
  }

  async function pay(): Promise<void> {
    setState("opening");
    setMessage(null);
    try {
      const res = await apiFetch(`/api/corporate/invoices/${invoice.id}/pay`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Could not start the payment");
      }
      const order = (await res.json()) as CorporatePaymentResponse;
      await openCheckout(
        order.razorpayOrder,
        {
          onSubmitted: () => void pollUntilPaid(),
          onFailed: (m) => {
            setState("error");
            setMessage(m);
          },
        },
        "Corporate invoice",
      );
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{money(invoice.totalPaise)}</p>
          <p className="text-sm text-slate-500">
            {invoice.billingMode === "CREDIT" ? "Credit" : "Prepaid"}
            {invoice.dueDate ? ` · due ${invoice.dueDate.slice(0, 10)}` : ""}
            {invoice.balancePaise > 0 ? ` · balance ${money(invoice.balancePaise)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Pill label={invoiceStatusLabel(invoice.status)} tone={TONE[invoice.status] ?? "slate"} />
          {isInvoicePayable(invoice) && state !== "paid" ? (
            <button
              onClick={pay}
              disabled={state === "opening" || state === "polling"}
              className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
            >
              {state === "opening" ? "Opening…" : state === "polling" ? "Confirming…" : "Pay online"}
            </button>
          ) : null}
        </div>
      </div>
      {state === "polling" ? <p className="mt-2 text-sm text-slate-500">Waiting for payment confirmation…</p> : null}
      {message ? <p className="mt-2 text-sm text-amber-700">{message}</p> : null}
    </Card>
  );
}
