"use client";

import { useState, type ReactNode } from "react";
import type { CorporateBooking, CorporateEmployee } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { allocatedCount } from "../../lib/corporate";
import { Card, Empty, ErrorNote, Pill, SectionTitle, money, useCorporateList } from "./shared";

const TONE: Record<string, string> = { PENDING: "amber", CONFIRMED: "green", CANCELLED: "red", COMPLETED: "slate" };

/** Corporate bookings + employee allocation to specific room-stays. */
export function BookingsPanel(): ReactNode {
  const { items, loading, error, reload } = useCorporateList<CorporateBooking>("/api/corporate/bookings");
  const employees = useCorporateList<CorporateEmployee>("/api/corporate/employees");

  return (
    <div className="space-y-4">
      <SectionTitle>Corporate bookings</SectionTitle>
      {loading ? (
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      ) : error ? (
        <ErrorNote>Couldn&apos;t load bookings. {error}</ErrorNote>
      ) : items.length === 0 ? (
        <Empty>No bookings yet. Accept a quotation and your account manager will confirm the stay.</Empty>
      ) : (
        items.map((b) => <BookingCard key={b.id} booking={b} employees={employees.items} onChanged={reload} />)
      )}
    </div>
  );
}

function BookingCard({ booking, employees, onChanged }: { booking: CorporateBooking; employees: CorporateEmployee[]; onChanged: () => void }): ReactNode {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const allocatedByReservation = new Map(booking.allocations.filter((a) => a.hotelReservationId).map((a) => [a.hotelReservationId!, a.employeeName]));

  async function allocate(reservationId: string): Promise<void> {
    const employeeId = pick[reservationId];
    if (!employeeId) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/corporate/bookings/${booking.id}/allocate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeId, hotelReservationId: reservationId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Could not allocate");
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold text-slate-900">Booking · {money(booking.totalPaise)}</p>
          <p className="text-sm text-slate-500">
            {booking.reservations.length} rooms · {allocatedCount(booking)} allocated
          </p>
        </div>
        <Pill label={booking.status} tone={TONE[booking.status] ?? "slate"} />
      </div>

      <div className="space-y-2">
        {booking.reservations.map((r) => {
          const assignedTo = allocatedByReservation.get(r.id);
          return (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span className="text-slate-600">
                {r.checkIn.slice(0, 10)} → {r.checkOut.slice(0, 10)} · {r.status}
              </span>
              {assignedTo ? (
                <Pill label={`Assigned: ${assignedTo}`} tone="green" />
              ) : (
                <span className="flex items-center gap-2">
                  <select
                    value={pick[r.id] ?? ""}
                    onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">Assign employee…</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy || !pick[r.id]}
                    onClick={() => allocate(r.id)}
                    className="rounded-md bg-teal-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-40"
                  >
                    Assign
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
    </Card>
  );
}
