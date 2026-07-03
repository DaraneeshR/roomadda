"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatPaise, type HostListing } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { listingState, listingStateClasses, listingStateLabel } from "../../lib/host";

/**
 * Small shared building blocks for the host portal pages. They keep the pages
 * consistent (the same card, pill, stat-tile and money treatment) and the
 * server-owned money display in one place — `Money` only ever *renders* the
 * paise the backend already computed (see /CLAUDE.md money rule #1).
 */

/** Server-owned money, rendered with tabular figures so columns line up. */
export function Money({ paise, className = "" }: { paise: number; className?: string }): ReactNode {
  return <span className={`tabular-nums ${className}`}>{formatPaise(paise)}</span>;
}

/** A labelled dashboard metric. `tone` tints the value for good/warning/critical. */
export function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}): ReactNode {
  const toneClass = {
    default: "text-slate-900",
    good: "text-green-700",
    warn: "text-amber-700",
    bad: "text-red-700",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
      {sub != null && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/** A titled section card with an optional right-aligned action. */
export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Lifecycle pill for a listing (live / paused / draft / in review / suspended). */
export function StateBadge({ listing }: { listing: Pick<HostListing, "status" | "paused"> }): ReactNode {
  const state = listingState(listing);
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${listingStateClasses(state)}`}>
      {listingStateLabel(state)}
    </span>
  );
}

/** A sanitized inline error line. */
export function ErrorNote({ children }: { children: ReactNode }): ReactNode {
  return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{children}</p>;
}

/** A rounded skeleton block used while a panel loads. */
export function Skeleton({ className = "h-32" }: { className?: string }): ReactNode {
  return <div className={`w-full animate-pulse rounded-xl bg-slate-100 ${className}`} aria-hidden />;
}

type LoadState = "loading" | "ready" | "error";

/**
 * Fetch the host's own listings once for a page. Many host pages need the listing
 * set — for a picker, counts, or per-listing drill-downs — so this centralises the
 * read (and re-read after a mutation).
 */
export function useHostListings(): {
  listings: HostListing[];
  state: LoadState;
  reload: () => Promise<void>;
} {
  const { apiFetch } = useAuth();
  const [listings, setListings] = useState<HostListing[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const reload = useCallback(async () => {
    try {
      const res = await apiFetch("/api/host/listings?limit=50");
      if (!res.ok) return setState("error");
      const body = (await res.json()) as { items: HostListing[] };
      setListings(body.items);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [apiFetch]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { listings, state, reload };
}

/** A listing picker for the per-listing pages (roster, walk-ins, menu, revenue). */
export function ListingSelect({
  listings,
  value,
  onChange,
}: {
  listings: HostListing[];
  value: string;
  onChange: (id: string) => void;
}): ReactNode {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium text-slate-600">Property</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
      >
        {listings.map((l) => (
          <option key={l.id} value={l.id}>
            {l.actualName}
          </option>
        ))}
      </select>
    </label>
  );
}
