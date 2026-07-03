"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatPaise,
  rupeesToPaise,
  WALK_IN_PAYMENT_MODES,
  type HostBookingRequest,
  type HostListing,
  type RosterTenant,
  type WalkInPaymentMode,
  type WalkInTenant,
} from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNote, SectionCard, Skeleton, useHostListings, ListingSelect } from "./shared";

/**
 * Bookings, tenants & walk-ins. Three jobs on one page:
 *  1. work incoming Request-to-Book holds (accept within 24h / decline → refund),
 *  2. the tenant roster for a property (name / room / move-in / rent status —
 *     NEVER any KYC; the server serializer omits it and there is nothing to show),
 *  3. record a walk-in (blocks a bed + fires the app-invite SMS) and check them out.
 * Accept NEVER confirms a booking — only the verified webhook does (domain rule #2).
 */
export function BookingsPanel(): React.ReactNode {
  const { listings, state } = useHostListings();
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    if (!selected && listings.length > 0) setSelected(listings[0]!.id);
  }, [listings, selected]);

  if (state === "loading") return <Skeleton className="h-64" />;
  if (state === "error") return <ErrorNote>Could not load your properties. Please refresh.</ErrorNote>;

  const current = listings.find((l) => l.id === selected) ?? null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Bookings & tenants</h1>

      <BookingRequests />

      {listings.length === 0 ? (
        <SectionCard title="Tenants">
          <p className="text-sm text-slate-600">List a property to see its tenant roster and record walk-ins.</p>
        </SectionCard>
      ) : (
        <>
          <div className="flex justify-end">
            <ListingSelect listings={listings} value={selected} onChange={setSelected} />
          </div>
          {current && <Roster listingId={current.id} />}
          {current && <WalkIns listing={current} />}
        </>
      )}
    </div>
  );
}

// --- Booking requests -------------------------------------------------------

function BookingRequests(): React.ReactNode {
  const { apiFetch } = useAuth();
  const [items, setItems] = useState<HostBookingRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/host/booking-requests?status=PENDING_APPROVAL&limit=50");
    if (res.ok) {
      const body = (await res.json()) as { items: HostBookingRequest[] };
      setItems(body.items);
    } else {
      setError("Could not load booking requests.");
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: "accept" | "decline"): Promise<void> {
    setError(null);
    const res = await apiFetch(`/api/host/booking-requests/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      ...(action === "decline" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) } : {}),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? `Could not ${action} the request.`);
      return;
    }
    await load();
  }

  return (
    <SectionCard title="Requests to book">
      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      {!items ? (
        <Skeleton className="h-20" />
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No pending requests. New Request-to-Book holds appear here to accept within 24 hours.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((r) => (
            <li key={r.bookingId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{r.tenantName}</p>
                <p className="text-xs text-slate-500">
                  {r.roomName} · {r.bedLabel} · {formatPaise(r.monthlyRentPaise)}/mo · token {formatPaise(r.tokenAmountPaise)}
                </p>
                <p className="mt-0.5 text-xs text-amber-700">{countdownLabel(r.secondsRemaining)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void act(r.bookingId, "accept")}
                  className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => void act(r.bookingId, "decline")}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function countdownLabel(secondsRemaining: number | null): string {
  if (secondsRemaining == null) return "";
  if (secondsRemaining <= 0) return "Expired — decline to release the bed";
  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  return `Accept within ${hours}h ${minutes}m`;
}

// --- Roster -----------------------------------------------------------------

const RENT_PILL: Record<string, string> = {
  PAID: "bg-green-100 text-green-800",
  DUE: "bg-amber-100 text-amber-800",
  OVERDUE: "bg-red-100 text-red-800",
  NOT_TRACKED: "bg-slate-100 text-slate-600",
};

function Roster({ listingId }: { listingId: string }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [scope, setScope] = useState<"current" | "past">("current");
  const [items, setItems] = useState<RosterTenant[] | null>(null);

  useEffect(() => {
    let active = true;
    setItems(null);
    (async () => {
      const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listingId)}/roster?scope=${scope}`);
      if (!active) return;
      if (res.ok) {
        const body = (await res.json()) as { items: RosterTenant[] };
        setItems(body.items);
      } else {
        setItems([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [apiFetch, listingId, scope]);

  return (
    <SectionCard
      title="Tenant roster"
      action={
        <div className="flex rounded-md border border-slate-200 p-0.5 text-xs">
          {(["current", "past"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded px-2.5 py-1 font-medium capitalize ${scope === s ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-800"}`}
            >
              {s}
            </button>
          ))}
        </div>
      }
    >
      {!items ? (
        <Skeleton className="h-20" />
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No {scope} tenants.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-semibold">Tenant</th>
                <th className="px-2 py-2 font-semibold">Room</th>
                <th className="px-2 py-2 font-semibold">Move-in</th>
                {scope === "past" && <th className="px-2 py-2 font-semibold">Move-out</th>}
                <th className="px-2 py-2 text-right font-semibold">Rent</th>
                <th className="px-2 py-2 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={`${t.kind}-${t.id}`} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 pr-3">
                    <span className="font-medium text-slate-800">{t.name}</span>
                    {t.kind === "WALK_IN" && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Walk-in</span>}
                  </td>
                  <td className="px-2 py-2.5 text-slate-600">{t.roomName}</td>
                  <td className="px-2 py-2.5 text-slate-600">{t.moveInDate ? new Date(t.moveInDate).toLocaleDateString("en-IN") : "—"}</td>
                  {scope === "past" && (
                    <td className="px-2 py-2.5 text-slate-600">
                      {t.moveOutDate ? new Date(t.moveOutDate).toLocaleDateString("en-IN") : "—"}
                      {t.durationDays != null && <span className="text-slate-400"> · {t.durationDays}d</span>}
                    </td>
                  )}
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">{formatPaise(t.monthlyRentPaise)}</td>
                  <td className="px-2 py-2.5 text-right">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${RENT_PILL[t.rentStatus] ?? RENT_PILL.NOT_TRACKED}`}>
                      {t.rentStatus.replace("_", " ").toLowerCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// --- Walk-ins ---------------------------------------------------------------

function WalkIns({ listing }: { listing: HostListing }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [items, setItems] = useState<WalkInTenant[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listing.id)}/walk-ins`);
    if (res.ok) {
      const body = (await res.json()) as { items: WalkInTenant[] };
      setItems(body.items);
    } else {
      setItems([]);
    }
  }, [apiFetch, listing.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkout(id: string): Promise<void> {
    const res = await apiFetch(`/api/host/walk-ins/${encodeURIComponent(id)}/checkout`, { method: "POST" });
    if (res.ok) await load();
  }

  return (
    <SectionCard
      title="Walk-ins"
      action={
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {showForm ? "Close" : "Record walk-in"}
        </button>
      }
    >
      {showForm && (
        <WalkInForm
          listing={listing}
          onCreated={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}

      {!items ? (
        <Skeleton className="h-16" />
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No current walk-ins. Recording one blocks a bed and texts the tenant an app invite.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {items.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  {w.name} <span className="font-normal text-slate-400">· {w.phone}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {w.roomName} · {formatPaise(w.monthlyRentPaise)}/mo · Aadhaar ••••{w.aadhaarLast4} ·{" "}
                  {w.invited ? <span className="text-green-600">invited ✓</span> : "invite pending"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void checkout(w.id)}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Check out
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function WalkInForm({ listing, onCreated }: { listing: HostListing; onCreated: () => Promise<void> }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [roomId, setRoomId] = useState(listing.rooms[0]?.roomId ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+91");
  const [aadhaar, setAadhaar] = useState("");
  const [moveIn, setMoveIn] = useState(new Date().toISOString().slice(0, 10));
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("");
  const [paymentMode, setPaymentMode] = useState<WalkInPaymentMode>("CASH");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    const rentPaise = safePaise(rent);
    if (!roomId || !name.trim() || !/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d{12}$/.test(aadhaar) || rentPaise === null || rentPaise <= 0) {
      setError("Enter a room, name, valid phone (+91…), 12-digit Aadhaar and monthly rent.");
      return;
    }
    const depositPaise = deposit.trim() ? safePaise(deposit) : 0;
    if (depositPaise === null) {
      setError("Enter a valid deposit.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listing.id)}/walk-ins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          name: name.trim(),
          phone,
          aadhaarNumber: aadhaar,
          moveInDate: moveIn,
          monthlyRentPaise: rentPaise,
          depositPaise,
          paymentMode,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Could not record the walk-in.");
        return;
      }
      await onCreated();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Room">
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className={inputClass}>
            {listing.rooms.map((r) => (
              <option key={r.roomId} value={r.roomId}>
                {r.name} ({r.availableBeds} free)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tenant name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Full name" />
        </Field>
        <Field label="Phone (E.164)">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="+919812345678" />
        </Field>
        <Field label="Aadhaar (12 digits)">
          <input value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))} maxLength={12} inputMode="numeric" className={inputClass} placeholder="123412341234" />
        </Field>
        <Field label="Move-in date">
          <input type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Payment mode">
          <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as WalkInPaymentMode)} className={inputClass}>
            {WALK_IN_PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Monthly rent (₹)">
          <input value={rent} onChange={(e) => setRent(e.target.value)} inputMode="numeric" className={inputClass} placeholder="12000" />
        </Field>
        <Field label="Deposit (₹, optional)">
          <input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="numeric" className={inputClass} placeholder="12000" />
        </Field>
      </div>
      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="mt-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Record walk-in & send invite"}
      </button>
    </div>
  );
}

function safePaise(rupees: string): number | null {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n < 0) return null;
  try {
    return rupeesToPaise(n);
  } catch {
    return null;
  }
}

const inputClass = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactNode {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
