"use client";

import { useState } from "react";
import type { PublicListing } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { isRoomBookable } from "../../lib/booking";
import { BookingSheet } from "./BookingSheet";

/**
 * The "Book now" entry point on a listing. Discovery stays open: an anonymous
 * click opens the P4.1 auth modal (no full-page redirect) and, on success,
 * continues straight into the booking sheet. Browsing never waits on a session.
 */
export function BookingFlow({ listing }: { listing: PublicListing }): React.ReactNode {
  const { status, login } = useAuth();
  const [open, setOpen] = useState(false);

  const anyBookable = listing.rooms.some(isRoomBookable);

  function handleBook(): void {
    if (status === "authenticated") {
      setOpen(true);
    } else {
      // Opens the auth modal in place; the callback fires once authenticated.
      login(() => setOpen(true));
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleBook}
        disabled={!anyBookable}
        className="rounded-md bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
      >
        {anyBookable ? "Book now" : "No beds available"}
      </button>
      {open && <BookingSheet listing={listing} onClose={() => setOpen(false)} />}
    </>
  );
}
