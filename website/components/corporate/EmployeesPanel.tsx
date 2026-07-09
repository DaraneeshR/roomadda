"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { CorporateEmployee } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { Card, Empty, ErrorNote, Pill, SectionTitle, useCorporateList } from "./shared";

/** Employee directory: list + add. An employee row carries NO money (privacy). */
export function EmployeesPanel(): ReactNode {
  const { apiFetch } = useAuth();
  const { items, loading, error, reload } = useCorporateList<CorporateEmployee>("/api/corporate/employees");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiFetch("/api/corporate/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, phone }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Could not add the employee");
      }
      setFullName("");
      setPhone("");
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
        <SectionTitle>Add an employee</SectionTitle>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-slate-600">Full name</span>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-slate-600">Phone (E.164, e.g. +9198…)</span>
            <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+9190…" className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <button type="submit" disabled={busy} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50">
            {busy ? "Adding…" : "Add"}
          </button>
        </form>
        {formError ? <p className="mt-2 text-sm text-red-600">{formError}</p> : null}
      </Card>

      <div>
        <SectionTitle>Directory</SectionTitle>
        {loading ? (
          <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        ) : error ? (
          <ErrorNote>Couldn&apos;t load employees. {error}</ErrorNote>
        ) : items.length === 0 ? (
          <Empty>No employees yet. Add your first above.</Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Phone</th>
                  <th className="px-4 py-2 font-medium">App account</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2 text-slate-900">{e.fullName}</td>
                    <td className="px-4 py-2 text-slate-600">{e.phone}</td>
                    <td className="px-4 py-2">
                      {e.linkedUser ? <Pill label="Linked" tone="green" /> : <Pill label="Not yet" tone="slate" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
