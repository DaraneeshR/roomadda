import { type NextRequest, type NextResponse } from "next/server";
import { proxyGet } from "../../../../lib/hostBff";

/**
 * The caller's own-company dashboard overview. The backend resolves the caller's
 * CompanyUser seat and scopes everything to that ONE company (a non-member gets
 * 403 NOT_A_COMPANY_USER — the gate reads that to deny UI access). Money is
 * server-owned; this layer only relays.
 */
export function GET(req: NextRequest): Promise<NextResponse> {
  return proxyGet(req, "/v1/corporate/overview");
}
