"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * The hotel search / stay picker: city (+ optional area) + a check-in/check-out
 * date range + guests. Filters live in the URL (like the PG discovery form), so
 * each search is its own server-rendered page and is deep-linkable. On the detail
 * page it locks to one property (`lockLocation`) and only changes the dates.
 *
 * It never computes price or availability — it only navigates; the server owns
 * both for the resolved date range.
 */
export interface StayDefaults {
  city?: string;
  area?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: string;
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function HotelStayPicker({
  defaults,
  basePath = "/hotels",
  lockLocation = false,
}: {
  defaults?: StayDefaults;
  /** Where to navigate on submit ("/hotels" for search, "/hotels/:id" on detail). */
  basePath?: string;
  /** On the detail page the property is fixed — hide + omit city/area. */
  lockLocation?: boolean;
}): React.ReactNode {
  const router = useRouter();
  const today = isoDate(new Date());
  const [city, setCity] = useState(defaults?.city ?? "");
  const [area, setArea] = useState(defaults?.area ?? "");
  const [checkIn, setCheckIn] = useState(defaults?.checkIn ?? today);
  const [checkOut, setCheckOut] = useState(defaults?.checkOut ?? addDays(defaults?.checkIn ?? today, 1));
  const [guests, setGuests] = useState(defaults?.guests ?? "1");

  // Keep check-out strictly after check-in (the backend rejects otherwise).
  const minCheckOut = addDays(checkIn, 1);
  const effectiveCheckOut = checkOut > checkIn ? checkOut : minCheckOut;

  function submit(e: FormEvent): void {
    e.preventDefault();
    const params = new URLSearchParams();
    if (!lockLocation) {
      if (city.trim()) params.set("city", city.trim());
      if (area.trim()) params.set("area", area.trim());
    }
    params.set("checkIn", checkIn);
    params.set("checkOut", effectiveCheckOut);
    params.set("guests", guests);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4"
    >
      {!lockLocation && (
        <>
          <label className="block text-xs font-medium text-slate-600 sm:col-span-2 lg:col-span-1">
            City
            <input
              className={`mt-1 ${inputClass}`}
              placeholder="City (e.g. Bengaluru)"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Area (optional)
            <input
              className={`mt-1 ${inputClass}`}
              placeholder="e.g. MG Road"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            />
          </label>
        </>
      )}
      <label className="block text-xs font-medium text-slate-600">
        Check-in
        <input
          type="date"
          className={`mt-1 ${inputClass}`}
          min={today}
          value={checkIn}
          onChange={(e) => {
            setCheckIn(e.target.value);
            if (checkOut <= e.target.value) setCheckOut(addDays(e.target.value, 1));
          }}
          required
        />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Check-out
        <input
          type="date"
          className={`mt-1 ${inputClass}`}
          min={minCheckOut}
          value={effectiveCheckOut}
          onChange={(e) => setCheckOut(e.target.value)}
          required
        />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Guests
        <select className={`mt-1 ${inputClass}`} value={guests} onChange={(e) => setGuests(e.target.value)}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={String(n)}>
              {n} {n === 1 ? "guest" : "guests"}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 sm:col-span-2 lg:col-span-4"
      >
        {lockLocation ? "Update dates" : "Search hotels"}
      </button>
    </form>
  );
}
