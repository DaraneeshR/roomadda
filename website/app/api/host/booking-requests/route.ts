import { type NextRequest, type NextResponse } from "next/server";
import { proxyGet } from "../../../../lib/hostBff";

/**
 * The host's incoming booking-request feed across all their listings. A
 * Request-to-Book (PENDING_APPROVAL) is actionable with a 24h countdown; the feed
 * carries the tenant's display name ONLY — never their KYC.
 */
export function GET(req: NextRequest): Promise<NextResponse> {
  return proxyGet(req, `/v1/host/booking-requests${req.nextUrl.search}`);
}
