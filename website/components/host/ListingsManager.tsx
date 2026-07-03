"use client";

import { useState } from "react";
import Link from "next/link";
import { formatPaise, type HostListing, type HostRoomInventory } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { canTogglePause } from "../../lib/host";
import { ErrorNote, Skeleton, StateBadge, useHostListings } from "./shared";

/**
 * Manage listings & inventory. For each of the host's own properties: edit,
 * pause/unpause (hide from discovery without deleting), and per-room inventory —
 * mark verified, or block/unblock beds for walk-ins. Inventory is bed-level and
 * every adjust is row-locked server-side, so this only sends the intent and
 * re-reads the authoritative counts.
 */
export function ListingsManager(): React.ReactNode {
  const { listings, state, reload } = useHostListings();

  if (state === "loading") return <Skeleton className="h-64" />;
  if (state === "error") return <ErrorNote>Could not load your listings. Please refresh.</ErrorNote>;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Listings & inventory</h1>
        <Link
          href="/host/listings/new"
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
        >
          List a property
        </Link>
      </header>

      {listings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          No listings yet. List your first property to start taking bookings.
        </div>
      ) : (
        <div className="space-y-4">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function ListingCard({ listing, onChanged }: { listing: HostListing; onChanged: () => Promise<void> }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function togglePause(): Promise<void> {
    setBusy(true);
    setError(null);
    const action = listing.paused ? "unpause" : "pause";
    try {
      const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listing.id)}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Could not update the listing.");
        return;
      }
      await onChanged();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-slate-900">{listing.actualName}</h2>
            <StateBadge listing={listing} />
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            {listing.areaLabel}, {listing.city}
            {listing.priceFromPaise != null && <> · from {formatPaise(listing.priceFromPaise)}</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/host/listings/${encodeURIComponent(listing.id)}/edit`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Edit
          </Link>
          {canTogglePause(listing.status) && (
            <button
              type="button"
              onClick={() => void togglePause()}
              disabled={busy}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {listing.paused ? "Unpause" : "Pause"}
            </button>
          )}
        </div>
      </div>

      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}

      {listing.rooms.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-semibold">Room</th>
                <th className="px-2 py-2 text-center font-semibold">Booked</th>
                <th className="px-2 py-2 text-center font-semibold">Walk-in</th>
                <th className="px-2 py-2 text-center font-semibold">Available</th>
                <th className="px-2 py-2 font-semibold">Adjust beds</th>
              </tr>
            </thead>
            <tbody>
              {listing.rooms.map((room) => (
                <RoomRow key={room.roomId} listingId={listing.id} room={room} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RoomRow({
  listingId,
  room,
  onChanged,
}: {
  listingId: string;
  room: HostRoomInventory;
  onChanged: () => Promise<void>;
}): React.ReactNode {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body?: unknown): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(path, {
        method: "POST",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? "Could not adjust inventory.");
        return;
      }
      await onChanged();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const base = `/api/host/listings/${encodeURIComponent(listingId)}/rooms/${encodeURIComponent(room.roomId)}`;

  return (
    <tr className="border-b border-slate-100 last:border-0 align-top">
      <td className="py-2.5 pr-3">
        <p className="font-medium text-slate-800">{room.name}</p>
        <p className="text-xs text-slate-500">
          {room.sharingType}-sharing · {formatPaise(room.monthlyRentPaise)}/mo
        </p>
        {room.needsVerification && (
          <button
            type="button"
            onClick={() => void post(`${base}/verify-inventory`)}
            disabled={busy}
            className="mt-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 disabled:opacity-50"
            title="Occupancy hasn't been verified recently — confirm it's current"
          >
            Verify inventory
          </button>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
      <td className="px-2 py-2.5 text-center tabular-nums text-slate-700">{room.bookedBeds}</td>
      <td className="px-2 py-2.5 text-center tabular-nums text-slate-700">{room.walkInBeds}</td>
      <td className="px-2 py-2.5 text-center tabular-nums font-semibold text-slate-900">{room.availableBeds}</td>
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void post(`${base}/adjust-inventory`, { action: "BLOCK", count: 1 })}
            disabled={busy || room.availableBeds === 0}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            title="Block one available bed (walk-in / offline)"
          >
            − Block
          </button>
          <button
            type="button"
            onClick={() => void post(`${base}/adjust-inventory`, { action: "UNBLOCK", count: 1 })}
            disabled={busy || room.walkInBeds === 0}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            title="Free one blocked bed"
          >
            + Unblock
          </button>
        </div>
      </td>
    </tr>
  );
}
