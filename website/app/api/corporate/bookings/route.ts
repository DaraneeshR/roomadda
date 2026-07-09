import { type NextRequest, type NextResponse } from "next/server";
import { proxyGet } from "../../../../lib/hostBff";

/** The company's own corporate bookings (with allocations), cursor-paginated. */
export function GET(req: NextRequest): Promise<NextResponse> {
  return proxyGet(req, `/v1/corporate/bookings${req.nextUrl.search}`);
}
