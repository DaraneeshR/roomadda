import { NextResponse, type NextRequest } from "next/server";
import { proxyGet, seg } from "../../../../../lib/hostBff";

/** One of the caller's own corporate bookings (company-scoped; foreign id → 404). */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return params.then(({ id }) => proxyGet(req, `/v1/corporate/bookings/${seg(id)}`));
}
