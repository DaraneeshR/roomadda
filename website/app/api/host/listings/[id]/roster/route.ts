import { type NextRequest, type NextResponse } from "next/server";
import { proxyGet, seg } from "../../../../../../lib/hostBff";

/**
 * Tenant roster for a listing — current (default) or past tenants. The backend
 * serializer returns ONLY name / room / move-in / rent status: NO KYC and no
 * other tenant's data ever crosses this boundary (see /CLAUDE.md masking rule).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyGet(req, `/v1/host/listings/${seg(id)}/roster${req.nextUrl.search}`);
}
