"use client";

import { type MouseEvent } from "react";
import { COMPARE_MAX, useCompare } from "./CompareProvider";

/**
 * "Add to compare" toggle for a card or the detail view. On a card it sits inside
 * the <Link>, so it stops the click from navigating. When the tray is full (and
 * this PG isn't in it) the control is disabled with a hint — the cap is 4.
 */
export function CompareButton({
  listingId,
  variant = "overlay",
}: {
  listingId: string;
  variant?: "overlay" | "inline";
}): React.ReactNode {
  const { has, canAdd, toggle } = useCompare();
  const inSet = has(listingId);
  const disabled = !inSet && !canAdd;

  function onClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    toggle(listingId);
  }

  const label = inSet ? "Remove from compare" : disabled ? `Compare is full (max ${COMPARE_MAX})` : "Add to compare";

  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={inSet}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
          inSet ? "border-teal-600 bg-teal-50 text-teal-700" : "border-slate-300 text-slate-700 hover:bg-slate-50"
        }`}
      >
        <span aria-hidden>{inSet ? "✓" : "＋"}</span>
        {inSet ? "In compare" : "Compare"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={inSet}
      aria-label={label}
      title={label}
      className={`absolute right-2 top-12 flex h-9 items-center gap-1 rounded-full px-2.5 text-xs font-medium shadow-sm backdrop-blur transition disabled:opacity-50 ${
        inSet ? "bg-teal-600 text-white" : "bg-white/90 text-slate-600 hover:bg-white"
      }`}
    >
      <span aria-hidden>{inSet ? "✓" : "＋"}</span>
      {inSet ? "Comparing" : "Compare"}
    </button>
  );
}
