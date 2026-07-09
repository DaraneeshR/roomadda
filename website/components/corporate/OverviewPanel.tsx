"use client";

import type { ReactNode } from "react";
import { useCorporate } from "./RequireCorporate";
import { Card, money } from "./shared";

/** The HR dashboard overview — all figures are server-owned (engine-sourced). */
export function OverviewPanel(): ReactNode {
  const { overview } = useCorporate();
  const stats: { label: string; value: string }[] = [
    { label: "Bookings", value: String(overview.bookingsTotal) },
    { label: "Active stays", value: String(overview.activeStays) },
    { label: "Employees", value: String(overview.employeesTotal) },
    { label: "Total spend", value: money(overview.spendPaise) },
    { label: "Outstanding", value: money(overview.outstandingPaise) },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{overview.company.name}</h1>
        <p className="text-sm text-slate-500">
          Billing: {overview.company.billingMode === "CREDIT" ? `Credit (net ${overview.company.creditDays} days)` : "Prepaid"}
          {overview.company.gstin ? ` · GSTIN ${overview.company.gstin}` : ""}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label}>
            <p className="text-xs uppercase tracking-wide text-slate-400">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{s.value}</p>
          </Card>
        ))}
      </div>
      <p className="text-sm text-slate-500">
        Need rooms for your team? Raise an <a className="font-medium text-teal-700 hover:underline" href="/corporate/enquiries">enquiry</a>{" "}
        and your account manager will send a quotation.
      </p>
    </div>
  );
}
