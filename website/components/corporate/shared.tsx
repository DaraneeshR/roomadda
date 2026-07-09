"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatPaise } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";

/**
 * Small shared building blocks for the Corporate Dashboard. MONEY IS DISPLAY-ONLY:
 * `money()` formats a server-owned paise figure via the shared helper — nothing in
 * the dashboard computes an amount.
 */

/** Format a server-owned paise amount for display (never client-computed). */
export function money(paise: number): string {
  return formatPaise(paise);
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }): ReactNode {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-5 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }): ReactNode {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-semibold text-slate-900">{children}</h2>
      {action}
    </div>
  );
}

const TONES: Record<string, string> = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  slate: "bg-slate-100 text-slate-600",
  sky: "bg-sky-100 text-sky-800",
  red: "bg-red-100 text-red-800",
};

export function Pill({ label, tone = "slate" }: { label: string; tone?: keyof typeof TONES | string }): ReactNode {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone] ?? TONES.slate}`}>{label}</span>;
}

export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">{children}</p>;
}

export function ErrorNote({ children }: { children: ReactNode }): ReactNode {
  return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{children}</p>;
}

/** Load a company-scoped list endpoint (`{ items }`) through the authed BFF fetch. */
export function useCorporateList<T>(path: string): { items: T[]; loading: boolean; error: string | null; reload: () => void } {
  const { apiFetch } = useAuth();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch(path)
      .then(async (res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        const data = (await res.json()) as { items: T[] };
        if (active) setItems(data.items ?? []);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Something went wrong");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiFetch, path]);

  useEffect(() => reload(), [reload]);
  return { items, loading, error, reload };
}
