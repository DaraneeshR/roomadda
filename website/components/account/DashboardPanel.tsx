"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  formatPaise,
  SERVICE_REQUEST_CATEGORIES,
  SERVICE_REQUEST_PRIORITIES,
  type ActiveStay,
  type LeaveNotice,
  type MealMenuDay,
  type ServiceRequest,
  type ServiceRequestCategory,
  type ServiceRequestPriority,
} from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { downloadPdf } from "../../lib/downloadPdf";

/**
 * The post-move-in tenant dashboard — the same endpoints the app dashboard uses:
 * active-stay, meal menu, service requests, leave notices. Before move-in the
 * active stay is null and we point the tenant at their bookings. The real PG name
 * + host emergency contact are allowed here (a CONFIRMED tenant on this listing);
 * the backend serializer already decided that — the web only renders it.
 */
export function DashboardPanel(): React.ReactNode {
  const { apiFetch } = useAuth();
  const [stay, setStay] = useState<ActiveStay | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiFetch("/api/me/active-stay");
        if (!active) return;
        if (!res.ok) return setState("error");
        const body = (await res.json()) as { activeStay: ActiveStay | null };
        setStay(body.activeStay);
        setState("ready");
      } catch {
        if (active) setState("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [apiFetch]);

  if (state === "loading") return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;
  if (state === "error")
    return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Could not load your stay.</p>;

  if (!stay) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My stay</h1>
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-slate-600">
            Your stay dashboard appears here once your move-in date arrives. Until then, track your booking.
          </p>
          <Link href="/account/bookings" className="mt-3 inline-block text-sm font-semibold text-teal-700 hover:underline">
            My bookings →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{stay.pgName}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {stay.roomName} · moved in {new Date(stay.moveInDate).toLocaleDateString("en-IN")}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <RentCard stay={stay} />
        <HostCard stay={stay} />
      </div>

      {stay.features.mealMenuAvailable && <MealMenuCard listingId={stay.listingId} />}

      <ServiceRequestsSection />

      {stay.features.leaveNoticeAvailable && <LeaveNoticeSection />}

      <DocumentsCard bookingId={stay.bookingId} />
    </div>
  );
}

function RentCard({ stay }: { stay: ActiveStay }): React.ReactNode {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next rent due</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{formatPaise(stay.monthlyRentPaise)}</p>
      <p className="text-xs text-slate-500">by {new Date(stay.nextRentDueDate).toLocaleDateString("en-IN")}</p>
      <Link
        href="/account/rent"
        className="mt-3 inline-block rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
      >
        Pay rent
      </Link>
    </div>
  );
}

function HostCard({ stay }: { stay: ActiveStay }): React.ReactNode {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your host</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{stay.host.name}</p>
      <p className="text-xs text-slate-500">Emergency contact</p>
      <a href={`tel:${stay.host.emergencyContactNumber}`} className="text-sm font-medium text-teal-700 hover:underline">
        {stay.host.emergencyContactNumber}
      </a>
    </div>
  );
}

function MealMenuCard({ listingId }: { listingId: string }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [days, setDays] = useState<MealMenuDay[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await apiFetch(`/api/listings/${encodeURIComponent(listingId)}/menu`);
      if (!active) return;
      if (res.ok) {
        const body = (await res.json()) as { days: MealMenuDay[] };
        setDays(body.days);
      }
    })();
    return () => {
      active = false;
    };
  }, [apiFetch, listingId]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-700">Meal menu</h2>
      {!days ? (
        <div className="mt-3 h-20 animate-pulse rounded bg-slate-100" />
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {days.map((d) => (
            <div key={d.date} className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">{new Date(d.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</p>
              {d.notUpdated ? (
                <p className="mt-1 text-xs text-slate-400">Menu not updated yet.</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  <MenuSlot label="Breakfast" slot={d.breakfast} />
                  <MenuSlot label="Lunch" slot={d.lunch} />
                  <MenuSlot label="Dinner" slot={d.dinner} />
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MenuSlot({ label, slot }: { label: string; slot: MealMenuDay["breakfast"] }): React.ReactNode {
  return (
    <li className="flex justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="text-right text-slate-700">{slot.notAvailable ? "Not served" : slot.text ?? "—"}</span>
    </li>
  );
}

function ServiceRequestsSection(): React.ReactNode {
  const { apiFetch } = useAuth();
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [category, setCategory] = useState<ServiceRequestCategory>("OTHER");
  const [priority, setPriority] = useState<ServiceRequestPriority>("NORMAL");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/service-requests?limit=20");
    if (res.ok) {
      const body = (await res.json()) as { items: ServiceRequest[] };
      setItems(body.items);
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(): Promise<void> {
    if (!description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, priority, description: description.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Could not raise the request.");
        return;
      }
      setDescription("");
      await load();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-700">Maintenance & help</h2>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ServiceRequestCategory)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          aria-label="Category"
        >
          {SERVICE_REQUEST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as ServiceRequestPriority)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          aria-label="Priority"
        >
          {SERVICE_REQUEST_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Describe the issue…"
        rows={3}
        className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
      />
      {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting || !description.trim()}
        className="mt-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Raise request"}
      </button>

      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {items.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-slate-800">#{r.ticketNumber}</span>{" "}
                <span className="text-slate-500">{r.category.replace(/_/g, " ").toLowerCase()}</span>
              </span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {r.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LeaveNoticeSection(): React.ReactNode {
  const { apiFetch } = useAuth();
  const [notices, setNotices] = useState<LeaveNotice[]>([]);
  const [earliest, setEarliest] = useState<string>("");
  const [periodDays, setPeriodDays] = useState<number>(0);
  const [moveOut, setMoveOut] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/leave-notices");
    if (res.ok) {
      const body = (await res.json()) as {
        items: LeaveNotice[];
        noticePeriodDays: number;
        earliestMoveOutDate: string;
      };
      setNotices(body.items);
      setPeriodDays(body.noticePeriodDays);
      const earliestIso = body.earliestMoveOutDate.slice(0, 10);
      setEarliest(earliestIso);
      setMoveOut((cur) => cur || earliestIso);
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(): Promise<void> {
    if (!moveOut) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/leave-notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moveOutDate: moveOut }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Could not submit your notice.");
        return;
      }
      await load();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function withdraw(id: string): Promise<void> {
    const res = await apiFetch(`/api/leave-notices/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
    if (res.ok) await load();
  }

  const active = notices.find((n) => n.status === "ACTIVE");

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-700">Leave notice</h2>
      {active ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <span className="text-slate-700">
            Notice active — move-out {new Date(active.moveOutDate).toLocaleDateString("en-IN")}
          </span>
          {active.canWithdraw && (
            <button
              type="button"
              onClick={() => void withdraw(active.id)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Withdraw
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="mt-2 text-xs text-slate-500">
            Notice period is {periodDays} days. Earliest move-out {earliest && new Date(earliest).toLocaleDateString("en-IN")}.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={moveOut}
              min={earliest}
              onChange={(e) => setMoveOut(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || !moveOut}
              className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Serve notice"}
            </button>
          </div>
          {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </>
      )}
    </section>
  );
}

function DocumentsCard({ bookingId }: { bookingId: string }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    const err = await downloadPdf(apiFetch, `/api/bookings/${encodeURIComponent(bookingId)}/receipt`, `roomadda-receipt-${bookingId}.pdf`);
    setError(err);
    setBusy(false);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-700">Documents</h2>
      <p className="mt-1 text-xs text-slate-500">Your booking receipt and rent receipts.</p>
      {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? "Preparing…" : "Booking receipt (PDF)"}
        </button>
        <Link
          href="/account/rent"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Rent receipts →
        </Link>
      </div>
    </section>
  );
}
