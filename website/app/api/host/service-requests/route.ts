import { type NextRequest, type NextResponse } from "next/server";
import { proxyGet } from "../../../../lib/hostBff";

/**
 * The host's service queue across their listings (escalated first) plus rollup
 * stats. Each item carries the tenant's display name + room — NEVER any KYC.
 */
export function GET(req: NextRequest): Promise<NextResponse> {
  return proxyGet(req, `/v1/host/service-requests${req.nextUrl.search}`);
}
