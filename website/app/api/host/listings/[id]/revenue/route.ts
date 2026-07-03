import { type NextRequest, type NextResponse } from "next/server";
import { proxyGet, seg } from "../../../../../../lib/hostBff";

/**
 * Read-only revenue snapshot for a listing: expected / collected / overdue this
 * month, occupancy, and a last-3-months series. Money is server-owned — the web
 * only displays these paise amounts, it never computes them.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyGet(req, `/v1/host/listings/${seg(id)}/revenue`);
}
