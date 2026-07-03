import { NextResponse, type NextRequest } from "next/server";
import { callBackend, relayError } from "../../../lib/backend";

/**
 * Public listing browse — the BFF proxy the client-side filter bar / split view
 * hit for LIVE, no-reload filtering. Discovery is open (no auth), and the backend
 * returns only the masked public shape, so this simply relays the query string
 * through to `/v1/listings`. Keeping it on THIS origin is what lets the strict
 * `connect-src 'self'` CSP stand while the browser still filters via AJAX.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await callBackend(`/v1/listings${req.nextUrl.search}`, { method: "GET", from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
