"use client";

import { useState, type ReactNode } from "react";
import type { Quotation } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { currentRevisionOf, isQuotationActionable, orderedRevisions, quotationStatusLabel } from "../../lib/corporate";
import { Card, Empty, ErrorNote, Pill, SectionTitle, money, useCorporateList } from "./shared";

const TONE: Record<string, string> = { DRAFT: "slate", SENT: "amber", NEGOTIATING: "sky", ACCEPTED: "green", REJECTED: "red", EXPIRED: "slate" };

/** Quotations with full revision history + accept / negotiate / reject. */
export function QuotationsPanel(): ReactNode {
  const { items, loading, error, reload } = useCorporateList<Quotation>("/api/corporate/quotations");

  return (
    <div className="space-y-4">
      <SectionTitle>Quotations</SectionTitle>
      {loading ? (
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      ) : error ? (
        <ErrorNote>Couldn&apos;t load quotations. {error}</ErrorNote>
      ) : items.length === 0 ? (
        <Empty>No quotations yet. Once you raise an enquiry your account manager will send one here.</Empty>
      ) : (
        items.map((q) => <QuotationCard key={q.id} quotation={q} onChanged={reload} />)
      )}
    </div>
  );
}

function QuotationCard({ quotation, onChanged }: { quotation: Quotation; onChanged: () => void }): ReactNode {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const current = currentRevisionOf(quotation);
  const revisions = orderedRevisions(quotation);

  async function respond(action: "ACCEPT" | "REJECT" | "REQUEST_CHANGES"): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/corporate/quotations/${quotation.id}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Could not update the quotation");
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold text-slate-900">Quotation · rev {quotation.currentRevision}</p>
          <p className="text-sm text-slate-500">
            {current ? money(current.totalPaise) : "—"}
            {quotation.validUntil ? ` · valid until ${quotation.validUntil.slice(0, 10)}` : ""}
          </p>
        </div>
        <Pill label={quotationStatusLabel(quotation.status)} tone={TONE[quotation.status] ?? "slate"} />
      </div>

      {/* Full negotiation history — every revision is preserved, oldest → newest. */}
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Rev</th>
              <th className="px-3 py-2 font-medium">Lines</th>
              <th className="px-3 py-2 font-medium">Subtotal</th>
              <th className="px-3 py-2 font-medium">Tax</th>
              <th className="px-3 py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {revisions.map((r) => (
              <tr key={r.id} className={r.revision === quotation.currentRevision ? "bg-teal-50/50" : ""}>
                <td className="px-3 py-2 text-slate-900">#{r.revision}</td>
                <td className="px-3 py-2 text-slate-600">{r.lineItems.map((li) => `${li.description} ×${li.quantity}`).join(", ")}</td>
                <td className="px-3 py-2 text-slate-600">{money(r.subtotalPaise)}</td>
                <td className="px-3 py-2 text-slate-600">{money(r.taxPaise)}</td>
                <td className="px-3 py-2 font-medium text-slate-900">{money(r.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isQuotationActionable(quotation) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => respond("ACCEPT")} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50">
            Accept
          </button>
          <button disabled={busy} onClick={() => respond("REQUEST_CHANGES")} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
            Request changes
          </button>
          <button disabled={busy} onClick={() => respond("REJECT")} className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50">
            Reject
          </button>
        </div>
      ) : null}
      {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
    </Card>
  );
}
