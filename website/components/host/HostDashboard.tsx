"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { HostBookingRequest, HostListing, RevenueSummary } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { listingState, listingOccupancy } from "../../lib/host";
import { ErrorNote, Money, SectionCard, Skeleton, StatTile, StateBadge, useHostListings } from "./shared";

/**
 * Host home. There is no single dashboard endpoint — the backend host surface is
 * a set of focused, ownership-scoped reads — so this stitches the picture from
 * them client-side: the listing mix, pending booking requests, occupancy, and
 * this-month revenue. Money stays server-owned and is shown PER LISTING straight
 * from each RevenueSummary — the portal never sums or derives an amount itself
 * (see /CLAUDE.md money rule #1). Bed counts are not money, so those aggregate.
 */
export function HostDashboard(): React.ReactNode {
  const { apiFetch, user } = useAuth();
  const { listings, state } = useHostListings();

  const [pendingRequests, setPendingRequests] = useState<number | null>(null);
  const [revenues, setRevenues] = useState<Record<string, RevenueSummary>>({});

  // Pending Request-to-Book count (actionable) across all listings.
  useEffect(() => {
    let active = true;
    (async () => {
      const res = await apiFetch("/api/host/booking-requests?status=PENDING_APPROVAL&limit=50");
      if (!active || !res.ok) return;
      const body = (await res.json()) as { items: HostBookingRequest[] };
      setPendingRequests(body.items.length);
    })();
    return () => {
      active = false;
    };
  }, [apiFetch]);

  // This-month revenue per listing (one call per property — a host owns a handful).
  useEffect(() => {
    if (state !== "ready") return;
    let active = true;
    (async () => {
      const entries = await Promise.all(
        listings.map(async (l): Promise<[string, RevenueSummary] | null> => {
          const res = await apiFetch(`/api/host/listings/${encodeURIComponent(l.id)}/revenue`);
          return res.ok ? [l.id, (await res.json()) as RevenueSummary] : null;
        }),
      );
      if (active) setRevenues(Object.fromEntries(entries.filter((e): e is [string, RevenueSummary] => e !== null)));
    })();
    return () => {
      active = false;
    };
  }, [state, listings, apiFetch]);

  const counts = useMemo(() => tallyListings(listings), [listings]);
  const occupancy = useMemo(() => sumOccupancy(listings), [listings]);

  if (state === "loading") {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (state === "error") return <ErrorNote>Could not load your dashboard. Please refresh.</ErrorNote>;

  const firstName = user?.fullName?.trim().split(/\s+/)[0];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{firstName ? `Hello, ${firstName}` : "Your PG at a glance"}</h1>
          <p className="mt-1 text-sm text-slate-600">Everything you run, in one place.</p>
        </div>
        <Link
          href="/host/listings/new"
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
        >
          List a property
        </Link>
      </header>

      {listings.length === 0 ? (
        <SectionCard title="Get started">
          <p className="text-sm text-slate-600">
            You haven&apos;t listed a property yet. List your PG to start taking bookings — it goes to our team for a
            quick review before it appears to tenants.
          </p>
          <Link
            href="/host/listings/new"
            className="mt-3 inline-block rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          >
            List a property
          </Link>
        </SectionCard>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Live listings"
              value={counts.live}
              sub={`${counts.draft} draft · ${counts.paused} paused · ${counts.inReview} in review`}
            />
            <StatTile
              label="Pending requests"
              value={pendingRequests ?? "—"}
              sub="Request-to-Book awaiting you"
              tone={pendingRequests && pendingRequests > 0 ? "warn" : "default"}
            />
            <StatTile
              label="Occupancy"
              value={`${occupancy.percent}%`}
              sub={`${occupancy.occupiedBeds} of ${occupancy.totalBeds} beds filled`}
            />
            <StatTile label="Available beds" value={occupancy.availableBeds} sub="Ready to book" />
          </div>

          <SectionCard
            title="Revenue this month"
            action={
              <Link href="/host/operations" className="text-xs font-semibold text-teal-700 hover:underline">
                Details →
              </Link>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-semibold">Property</th>
                    <th className="px-2 py-2 text-right font-semibold">Expected</th>
                    <th className="px-2 py-2 text-right font-semibold">Collected</th>
                    <th className="px-2 py-2 text-right font-semibold">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l) => {
                    const r = revenues[l.id];
                    return (
                      <tr key={l.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pr-3 font-medium text-slate-800">{l.actualName}</td>
                        <td className="px-2 py-2.5 text-right text-slate-700">{r ? <Money paise={r.expectedPaise} /> : "…"}</td>
                        <td className="px-2 py-2.5 text-right text-green-700">{r ? <Money paise={r.collectedPaise} /> : "…"}</td>
                        <td className={`px-2 py-2.5 text-right ${r && r.overduePaise > 0 ? "text-red-700" : "text-slate-500"}`}>
                          {r ? <Money paise={r.overduePaise} /> : "…"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard
            title="Your properties"
            action={
              <Link href="/host/listings" className="text-xs font-semibold text-teal-700 hover:underline">
                Manage →
              </Link>
            }
          >
            <ul className="divide-y divide-slate-100">
              {listings.map((l) => {
                const occ = listingOccupancy(l);
                return (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{l.actualName}</p>
                      <p className="text-xs text-slate-500">
                        {l.areaLabel}, {l.city} · {occ.occupiedBeds}/{occ.totalBeds} beds
                      </p>
                    </div>
                    <StateBadge listing={l} />
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        </>
      )}
    </div>
  );
}

function tallyListings(listings: HostListing[]): { live: number; draft: number; paused: number; inReview: number } {
  const counts = { live: 0, draft: 0, paused: 0, inReview: 0 };
  for (const l of listings) {
    const s = listingState(l);
    if (s === "LIVE") counts.live += 1;
    else if (s === "PAUSED") counts.paused += 1;
    else if (s === "DRAFT") counts.draft += 1;
    else if (s === "IN_REVIEW") counts.inReview += 1;
  }
  return counts;
}

function sumOccupancy(listings: HostListing[]): { totalBeds: number; occupiedBeds: number; availableBeds: number; percent: number } {
  let totalBeds = 0;
  let occupiedBeds = 0;
  let availableBeds = 0;
  for (const l of listings) {
    const occ = listingOccupancy(l);
    totalBeds += occ.totalBeds;
    occupiedBeds += occ.occupiedBeds;
    availableBeds += occ.availableBeds;
  }
  const percent = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;
  return { totalBeds, occupiedBeds, availableBeds, percent };
}
