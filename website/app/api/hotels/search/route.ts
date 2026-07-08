import { NextResponse, type NextRequest } from "next/server";
import { callBackend, relayError } from "../../../../lib/backend";

/**
 * B2C hotel availability search — the PUBLIC entry point of the web hotels flow.
 * Browsing is open (just-in-time KYC, /CLAUDE.md rule #5), so no auth is required;
 * the browser calls THIS same-origin route (never the backend directly) so the
 * strict CSP and `BACKEND_API_URL` stay off the client.
 *
 * The query (city/area + check-in/check-out + guests) is forwarded verbatim; the
 * backend owns validation, masking, the server-computed nightly price, and the
 * REAL per-date availability. This layer only relays — it never computes money.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await callBackend(`/v1/hotels/search${req.nextUrl.search}`, { method: "GET", from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
