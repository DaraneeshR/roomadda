"use client";

import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";

/**
 * Gate for the logged-in tenant portal. Discovery stays open elsewhere; these
 * account pages need a session (P4.1). While the session bootstraps we show a
 * skeleton; an anonymous visitor gets an in-place login button (the P4.1 modal),
 * never a redirect. The backend is still the real authority — every proxied call
 * re-checks the token — this only shapes the UI.
 */
export function RequireAuth({ children, title }: { children: ReactNode; title?: string }): ReactNode {
  const { status, login } = useAuth();

  if (status === "loading") {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-100" />
        <div className="h-32 w-full animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (status === "anonymous") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900">{title ?? "Log in to continue"}</h2>
        <p className="mt-1 text-sm text-slate-600">Sign in with your mobile number — the same account as the app.</p>
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

  return <>{children}</>;
}
