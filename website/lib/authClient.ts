import type { SelfUser } from "@roomadda/shared";

/**
 * Browser-side session plumbing. The access token lives ONLY in this module's
 * memory (a closure variable) — never localStorage, sessionStorage, or a
 * non-httpOnly cookie — so it cannot be exfiltrated by injected script and is
 * gone on refresh (rehydrated from the httpOnly refresh cookie via `/api/auth/
 * refresh`). Every authenticated call goes through `apiFetch`, which transparently
 * refreshes once on a 401 and clears the session if that refresh fails.
 */

export interface Session {
  accessToken: string;
  user: SelfUser;
}

let accessToken: string | null = null;
/** De-dupes concurrent refreshes so a burst of 401s triggers one refresh. */
let refreshInFlight: Promise<Session | null> | null = null;
/** Notified when the session is cleared out-of-band (a refresh failed). */
const sessionClearedListeners = new Set<() => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Subscribe to "session was cleared" (returns an unsubscribe fn). */
export function onSessionCleared(cb: () => void): () => void {
  sessionClearedListeners.add(cb);
  return () => sessionClearedListeners.delete(cb);
}

function clearSession(): void {
  accessToken = null;
  for (const cb of sessionClearedListeners) cb();
}

/**
 * Exchange the httpOnly refresh cookie for a fresh access token. Concurrent
 * callers share one in-flight request. Returns the new session or null.
 */
export async function refreshSession(): Promise<Session | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST" });
      if (!res.ok) return null;
      const session = (await res.json()) as Session;
      accessToken = session.accessToken;
      return session;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Fetch a same-origin `/api/*` endpoint with the in-memory access token attached.
 * On a 401 it refreshes once and retries; if the refresh fails the session is
 * cleared (listeners fire → UI drops to anonymous / opens login).
 *
 * FormData bodies are left untouched so the browser sets the multipart boundary.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const attempt = (token: string | null): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  let res = await attempt(accessToken);
  if (res.status !== 401) return res;

  const refreshed = await refreshSession();
  if (!refreshed) {
    clearSession();
    return res;
  }
  res = await attempt(refreshed.accessToken);
  if (res.status === 401) clearSession();
  return res;
}
