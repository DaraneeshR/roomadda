"use client";

import { useEffect, useState, type ReactNode } from "react";
import { GENDER_POLICIES, rupeesToPaise, paiseToRupees, type GenderPolicy, type TrustBadgeKind } from "@roomadda/shared";
import { BADGE_META, type FilterState } from "../../lib/discovery";

/**
 * The full discovery filter set — a SUPERSET of the app's filters, grouped into
 * location, price/room, who-it's-for, food/amenities and trust/booking. Every
 * control maps to a real backend query param (see backend `listFiltersSchema`).
 * It is a controlled component: it emits a fresh `FilterState` on each committed
 * change; the parent runs the live AJAX query and writes the URL. Text inputs
 * commit on blur/Enter so typing doesn't spam the network; toggles commit at once.
 */

/** Curated amenity toggles. The backend matches these against a listing's amenity
 *  strings with `hasEvery` (all must be present), so the labels are the canonical
 *  values a host is expected to use. */
const AMENITY_OPTIONS = [
  "WiFi",
  "AC",
  "Food",
  "Parking",
  "Laundry",
  "Power Backup",
  "CCTV",
  "Housekeeping",
  "Hot Water",
  "Lift",
  "Gym",
];

/** Trust/booking filter options (single-select, maps to the `badge` param). */
const BADGE_FILTERS: TrustBadgeKind[] = [
  "INSTANT_BOOK",
  "RA_VERIFIED",
  "RA_ASSURED",
  "RA_CHOICE",
  "LUXURY",
  "WIZARD",
  "TRENDING",
];

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500";

const rupeesFromPaise = (p?: string): string => (p ? String(paiseToRupees(Number(p))) : "");

function Group({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</legend>
      {children}
    </fieldset>
  );
}

export function FilterBar({
  value,
  onChange,
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
}): ReactNode {
  // Text fields hold local state and commit on blur/Enter; the rest commit live.
  const [city, setCity] = useState(value.city ?? "");
  const [area, setArea] = useState(value.area ?? "");
  const [minRent, setMinRent] = useState(rupeesFromPaise(value.minRentPaise));
  const [maxRent, setMaxRent] = useState(rupeesFromPaise(value.maxRentPaise));

  // Keep local inputs in sync when the parent resets filters (e.g. "clear all").
  useEffect(() => setCity(value.city ?? ""), [value.city]);
  useEffect(() => setArea(value.area ?? ""), [value.area]);
  useEffect(() => setMinRent(rupeesFromPaise(value.minRentPaise)), [value.minRentPaise]);
  useEffect(() => setMaxRent(rupeesFromPaise(value.maxRentPaise)), [value.maxRentPaise]);

  const patch = (p: Partial<FilterState>): void => onChange({ ...value, ...p });

  const rupeesToParam = (s: string): string | undefined => {
    const n = Number(s);
    return s.trim() && Number.isFinite(n) && n > 0 ? String(rupeesToPaise(n)) : undefined;
  };

  const toggleAmenity = (a: string): void => {
    const has = value.amenities.includes(a);
    patch({ amenities: has ? value.amenities.filter((x) => x !== a) : [...value.amenities, a] });
  };

  return (
    <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
      <Group label="Location">
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputClass}
            placeholder="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onBlur={() => patch({ city: city.trim() || undefined })}
            onKeyDown={(e) => e.key === "Enter" && patch({ city: city.trim() || undefined })}
          />
          <input
            className={inputClass}
            placeholder="Area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            onBlur={() => patch({ area: area.trim() || undefined })}
            onKeyDown={(e) => e.key === "Enter" && patch({ area: area.trim() || undefined })}
          />
        </div>
      </Group>

      <Group label="Price & room">
        <div className="grid grid-cols-3 gap-2">
          <input
            className={inputClass}
            inputMode="numeric"
            placeholder="Min ₹"
            value={minRent}
            onChange={(e) => setMinRent(e.target.value)}
            onBlur={() => patch({ minRentPaise: rupeesToParam(minRent) })}
            onKeyDown={(e) => e.key === "Enter" && patch({ minRentPaise: rupeesToParam(minRent) })}
          />
          <input
            className={inputClass}
            inputMode="numeric"
            placeholder="Max ₹"
            value={maxRent}
            onChange={(e) => setMaxRent(e.target.value)}
            onBlur={() => patch({ maxRentPaise: rupeesToParam(maxRent) })}
            onKeyDown={(e) => e.key === "Enter" && patch({ maxRentPaise: rupeesToParam(maxRent) })}
          />
          <select
            className={inputClass}
            value={value.sharingType ?? ""}
            onChange={(e) => patch({ sharingType: e.target.value || undefined })}
          >
            <option value="">Any sharing</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={String(n)}>
                {n}-sharing
              </option>
            ))}
          </select>
        </div>
      </Group>

      <Group label="Who it's for">
        <div className="grid grid-cols-2 gap-2">
          <select
            className={inputClass}
            value={value.gender ?? ""}
            onChange={(e) => patch({ gender: (e.target.value || undefined) as GenderPolicy | undefined })}
          >
            <option value="">Any gender</option>
            {GENDER_POLICIES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            type="date"
            aria-label="Move-in date"
            value={value.moveInDate ?? ""}
            onChange={(e) => patch({ moveInDate: e.target.value || undefined })}
          />
        </div>
      </Group>

      <Group label="Trust & booking">
        <select
          className={inputClass}
          value={value.badge ?? ""}
          onChange={(e) => patch({ badge: (e.target.value || undefined) as TrustBadgeKind | undefined })}
        >
          <option value="">Any</option>
          {BADGE_FILTERS.map((b) => (
            <option key={b} value={b}>
              {BADGE_META[b].label}
            </option>
          ))}
        </select>
      </Group>

      <Group label="Food & amenities">
        <div className="flex flex-wrap gap-1.5">
          {AMENITY_OPTIONS.map((a) => {
            const active = value.amenities.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={active}
                onClick={() => toggleAmenity(a)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  active
                    ? "border-teal-600 bg-teal-600 text-white"
                    : "border-slate-300 bg-white text-slate-600 hover:border-teal-400"
                }`}
              >
                {a}
              </button>
            );
          })}
        </div>
      </Group>
    </div>
  );
}
