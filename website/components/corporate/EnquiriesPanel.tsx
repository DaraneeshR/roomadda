"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { CorporateEnquiry } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { enquiryStatusLabel } from "../../lib/corporate";
import { Card, Empty, ErrorNote, Pill, SectionTitle, useCorporateList } from "./shared";

const TONE: Record<string, string> = { NEW: "sky", QUOTED: "amber", CONVERTED: "green", CANCELLED: "slate" };

/** Raise + track enquiries (top of the pipeline). No money on this surface. */
export function EnquiriesPanel(): ReactNode {
  const { apiFetch } = useAuth();
  const { items, loading, error, reload } = useCorporateList<CorporateEnquiry>("/api/corporate/enquiries");
  const [form, setForm] = useState({ city: "", headcount: 1, checkIn: "", checkOut: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiFetch("/api/corporate/enquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          city: form.city,
          headcount: Number(form.headcount),
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          propertyType: "HOTEL",
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Could not raise the enquiry");
      }
      setForm({ city: "", headcount: 1, checkIn: "", checkOut: "", notes: "" });
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>Raise an enquiry</SectionTitle>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">City</span>
            <input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Headcount</span>
            <input required type="number" min={1} value={form.headcount} onChange={(e) => setForm({ ...form, headcount: Number(e.target.value) })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Check-in</span>
            <input required type="date" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Check-out</span>
            <input required type="date" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-600">Notes (optional)</span>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50">
              {busy ? "Submitting…" : "Submit enquiry"}
            </button>
            {formError ? <span className="ml-3 text-sm text-red-600">{formError}</span> : null}
          </div>
        </form>
      </Card>

      <div>
        <SectionTitle>Your enquiries</SectionTitle>
        {loading ? (
          <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        ) : error ? (
          <ErrorNote>Couldn&apos;t load enquiries. {error}</ErrorNote>
        ) : items.length === 0 ? (
          <Empty>No enquiries yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {items.map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-900">
                    {e.city} · {e.headcount} guests
                  </p>
                  <p className="text-slate-500">
                    {e.checkIn.slice(0, 10)} → {e.checkOut.slice(0, 10)}
                  </p>
                </div>
                <Pill label={enquiryStatusLabel(e.status)} tone={TONE[e.status] ?? "slate"} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
