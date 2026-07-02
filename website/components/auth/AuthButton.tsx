"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";

/**
 * Header entry point for auth. Anonymous visitors see "Log in" (discovery stays
 * open regardless); authenticated users get an account menu with a KYC link and
 * logout. During the initial session bootstrap it renders nothing to avoid a
 * flash of the wrong state.
 */
export function AuthButton(): React.ReactNode {
  const { user, status, login, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  if (status === "loading") {
    return <span className="h-8 w-16 animate-pulse rounded bg-slate-100" aria-hidden />;
  }

  if (status === "anonymous" || !user) {
    return (
      <button
        type="button"
        onClick={() => login()}
        className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-teal-700"
      >
        Log in
      </button>
    );
  }

  const label = user.fullName.trim() || "Account";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {label} <span className="text-xs text-slate-400">▾</span>
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
          <div
            className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            role="menu"
          >
            <Link
              href="/account/kyc"
              onClick={() => setMenuOpen(false)}
              className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              role="menuitem"
            >
              KYC verification
            </Link>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void logout();
              }}
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              role="menuitem"
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
