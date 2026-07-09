"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { CorporateOverview } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { corporateAccess, type CorporateAccess } from "../../lib/corporate";

/**
 * Gate + context for the Corporate Dashboard. There is NO platform role for a
 * company user — membership IS the authorization. So the gate resolves by loading
 * the backend company overview: 200 → a member (render), 403 → not a member. The
 * backend re-checks the seat on every /api/corporate/* call, so this only shapes
 * the UI; it never grants access the server would deny.
 */

interface CorporateContextValue {
  overview: CorporateOverview;
  reloadOverview: () => void;
}

const CorporateContext = createContext<CorporateContextValue | null>(null);

export function useCorporate(): CorporateContextValue {
  const ctx = useContext(CorporateContext);
  if (!ctx) throw new Error("useCorporate must be used within <RequireCorporate>");
  return ctx;
}

export function RequireCorporate({ children }: { children: ReactNode }): ReactNode {
  const { status, apiFetch, login } = useAuth();
  const [overview, setOverview] = useState<CorporateOverview | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (status !== "authenticated") return;
    let active = true;
    apiFetch("/api/corporate/overview")
      .then(async (res) => {
        if (!active) return;
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (!res.ok) throw new Error("overview failed");
        const data = (await res.json()) as { overview: CorporateOverview };
        setOverview(data.overview);
      })
      .catch(() => active && setForbidden(true));
    return () => {
      active = false;
    };
  }, [status, apiFetch, tick]);

  const access: CorporateAccess = corporateAccess(status, overview !== null, forbidden);

  if (access === "loading") {
    return (
      <div className="space-y-3" aria-hidden>
        <div className="h-8 w-56 animate-pulse rounded bg-slate-100" />
        <div className="h-40 w-full animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (access === "anonymous") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900">Log in to your company workspace</h2>
        <p className="mt-1 text-sm text-slate-600">Manage employees, enquiries, quotations, bookings and invoices in one place.</p>
        <button
          type="button"
          onClick={() => login()}
          className="mt-4 rounded-md bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
        >
          Log in
        </button>
      </div>
    );
  }

  if (access === "forbidden" || !overview) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900">No company workspace</h2>
        <p className="mt-1 text-sm text-slate-600">
          This account isn&apos;t linked to a company. Ask your RoomAdda account manager to add you as an HR seat.
        </p>
      </div>
    );
  }

  return (
    <CorporateContext.Provider value={{ overview, reloadOverview: () => setTick((t) => t + 1) }}>
      {children}
    </CorporateContext.Provider>
  );
}
