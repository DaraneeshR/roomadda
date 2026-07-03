"use client";

import { useState } from "react";
import { formatPaise, rupeesToPaise, type HostRoomInventory } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNote } from "./shared";

/**
 * Rooms, beds & pricing for the listing form. Rooms and beds are created directly
 * against the listing (the bed-level inventory the booking engine locks on), so
 * this component POSTs each add and re-reads the authoritative room rollup. Rent
 * and deposit are entered in rupees and converted with the shared money helper —
 * the only sanctioned rupee→paise path (see /CLAUDE.md money rule #1).
 */
export function RoomsEditor({
  listingId,
  rooms,
  onChanged,
}: {
  listingId: string;
  rooms: HostRoomInventory[];
  onChanged: () => Promise<void>;
}): React.ReactNode {
  return (
    <div className="space-y-4">
      {rooms.length > 0 && (
        <ul className="space-y-3">
          {rooms.map((room) => (
            <RoomItem key={room.roomId} listingId={listingId} room={room} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <AddRoomForm listingId={listingId} onChanged={onChanged} />
    </div>
  );
}

function RoomItem({
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

  async function addBed(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/host/listings/${encodeURIComponent(listingId)}/rooms/${encodeURIComponent(room.roomId)}/beds`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: `Bed ${room.totalBeds + 1}` }),
        },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? "Could not add a bed.");
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
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-800">
            {room.name} <span className="text-slate-400">· {room.sharingType}-sharing</span>
          </p>
          <p className="text-xs text-slate-500">
            {formatPaise(room.monthlyRentPaise)}/mo · deposit {formatPaise(room.depositPaise)} · {room.totalBeds} bed
            {room.totalBeds === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void addBed()}
          disabled={busy}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          + Add bed
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  );
}

function AddRoomForm({ listingId, onChanged }: { listingId: string; onChanged: () => Promise<void> }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [name, setName] = useState("");
  const [sharingType, setSharingType] = useState("2");
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("");
  const [floor, setFloor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    const rentPaise = toPaise(rent);
    if (!name.trim() || rentPaise === null || rentPaise <= 0) {
      setError("Enter a room name and a monthly rent.");
      return;
    }
    const depositPaise = deposit.trim() ? toPaise(deposit) : 0;
    if (depositPaise === null) {
      setError("Enter a valid deposit amount.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listingId)}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sharingType: Number(sharingType),
          monthlyRentPaise: rentPaise,
          depositPaise,
          ...(floor.trim() ? { floor: Number(floor) } : {}),
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? "Could not add the room.");
        return;
      }
      setName("");
      setRent("");
      setDeposit("");
      setFloor("");
      await onChanged();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
      <p className="mb-2 text-sm font-medium text-slate-700">Add a room</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Room name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Room 101" className={inputClass} />
        </Field>
        <Field label="Sharing">
          <select value={sharingType} onChange={(e) => setSharingType(e.target.value)} className={inputClass}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}-sharing
              </option>
            ))}
          </select>
        </Field>
        <Field label="Monthly rent (₹)">
          <input value={rent} onChange={(e) => setRent(e.target.value)} inputMode="numeric" placeholder="12000" className={inputClass} />
        </Field>
        <Field label="Deposit (₹, optional)">
          <input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="numeric" placeholder="12000" className={inputClass} />
        </Field>
        <Field label="Floor (optional)">
          <input value={floor} onChange={(e) => setFloor(e.target.value)} inputMode="numeric" placeholder="1" className={inputClass} />
        </Field>
      </div>
      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="mt-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add room"}
      </button>
    </div>
  );
}

/** Parse a rupee string to integer paise via the shared helper; null if invalid. */
function toPaise(rupees: string): number | null {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n < 0) return null;
  try {
    return rupeesToPaise(n);
  } catch {
    return null;
  }
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactNode {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
