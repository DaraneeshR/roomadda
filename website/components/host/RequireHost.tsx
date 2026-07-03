"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { hostAccess } from "../../lib/host";

/**
 * Gate for the host portal. The whole `/host/*` area is HOST-only:
 *   - while the session bootstraps → a skeleton,
 *   - an anonymous visitor → an in-place login prompt (reusing the P4.1 modal),
 *   - an authenticated NON-host (a tenant) → redirected away to discovery,
 *   - a HOST → the portal.
 * The backend is still the real authority — every proxied `/api/host/*` call
 * re-checks the role AND ownership — this only shapes the UI so a non-host never
 * sees host chrome.
 */
export function RequireHost({ children }: { children: ReactNode }): ReactNode {
  const { status, user, login } = useAuth();
  const router = useRouter();
  const access = hostAccess(status, user?.role);

  // An authenticated non-host has no place here — send them back to discovery.
  useEffect(() => {
    if (access === "forbidden") router.replace("/");
  }, [access, router]);

  if (access === "loading") {
    return (
      <div className="space-y-3" aria-hidden>
        <div className="h-8 w-56 animate-pulse rounded bg-slate-100" />
        <div className="h-40 w-full animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (access === "anonymous") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900">Log in to your host account</h2>
        <p className="mt-1 text-sm text-slate-600">
          Manage your PG — listings, bookings, tenants, meals and revenue — from one place.
        </p>
        <button
          type="button"
          onClick={() => login()}
          className="mt-4 rounded-md bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
        >
          Log in
        </button>
      </div>
    );
  }

  if (access === "forbidden") {
    // Redirect is in flight; render nothing rather than flash host chrome.
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm text-slate-600">This area is for hosts. Taking you back to browse…</p>
      </div>
    );
  }

  return <>{children}</>;
}
