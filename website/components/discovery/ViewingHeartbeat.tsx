"use client";

import { useEffect } from "react";

/**
 * Registers "viewing now" presence for the listing while its detail page is open,
 * so the honesty-gated social widget reflects REAL concurrent viewers. Sends a
 * heartbeat on mount and on a short interval via the BFF. Anonymous viewers are
 * deduped by a stable per-browser session id (kept in sessionStorage); a signed-in
 * viewer is deduped server-side by user id. Renders nothing.
 *
 * This only WRITES presence — it never reads a count back and cannot inflate one;
 * the count each viewer sees is the server's floor-gated value (see modules/social).
 */
const HEARTBEAT_MS = 25_000;
const SESSION_KEY = "ra_view_session";

function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function ViewingHeartbeat({ listingId }: { listingId: string }): null {
  useEffect(() => {
    const id = sessionId();
    const ping = (): void => {
      void fetch(`/api/listings/${encodeURIComponent(listingId)}/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
        keepalive: true,
      }).catch(() => {});
    };
    ping();
    const timer = setInterval(ping, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [listingId]);

  return null;
}
