"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { GENDER_POLICIES, rupeesToPaise } from "@roomadda/shared";

export interface SearchDefaults {
  city?: string;
  area?: string;
  gender?: string;
  sharingType?: string;
  minRent?: string;
  maxRent?: string;
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500";

export function SearchForm({ defaults }: { defaults?: SearchDefaults }) {
  const router = useRouter();
  const [city, setCity] = useState(defaults?.city ?? "");
  const [area, setArea] = useState(defaults?.area ?? "");
  const [gender, setGender] = useState(defaults?.gender ?? "");
  const [sharingType, setSharingType] = useState(defaults?.sharingType ?? "");
  const [minRent, setMinRent] = useState(defaults?.minRent ?? "");
  const [maxRent, setMaxRent] = useState(defaults?.maxRent ?? "");

  function submit(e: FormEvent): void {
    e.preventDefault();
    const params = new URLSearchParams();
    if (city.trim()) params.set("city", city.trim());
    if (area.trim()) params.set("area", area.trim());
    if (gender) params.set("gender", gender);
    if (sharingType) params.set("sharingType", sharingType);
    if (minRent && Number(minRent) > 0) params.set("minRentPaise", String(rupeesToPaise(Number(minRent))));
    if (maxRent && Number(maxRent) > 0) params.set("maxRentPaise", String(rupeesToPaise(Number(maxRent))));
    router.push(`/search?${params.toString()}`);
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3"
    >
      <input className={inputClass} placeholder="City (e.g. Bengaluru)" value={city} onChange={(e) => setCity(e.target.value)} />
      <input className={inputClass} placeholder="Area (e.g. Koramangala)" value={area} onChange={(e) => setArea(e.target.value)} />
      <select className={inputClass} value={gender} onChange={(e) => setGender(e.target.value)}>
        <option value="">Any gender</option>
        {GENDER_POLICIES.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      <select className={inputClass} value={sharingType} onChange={(e) => setSharingType(e.target.value)}>
        <option value="">Any sharing</option>
        {[1, 2, 3, 4].map((n) => (
          <option key={n} value={String(n)}>
            {n}-sharing
          </option>
        ))}
      </select>
      <input className={inputClass} inputMode="numeric" placeholder="Min rent (₹)" value={minRent} onChange={(e) => setMinRent(e.target.value)} />
      <input className={inputClass} inputMode="numeric" placeholder="Max rent (₹)" value={maxRent} onChange={(e) => setMaxRent(e.target.value)} />
      <button
        type="submit"
        className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 sm:col-span-2 lg:col-span-3"
      >
        Search PGs
      </button>
    </form>
  );
}
