import { type NextRequest, type NextResponse } from "next/server";
import { proxyGet, seg } from "../../../../../../lib/hostBff";

/** Append-only edit history for a listing (newest first, cursor-paginated). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyGet(req, `/v1/host/listings/${seg(id)}/edit-history${req.nextUrl.search}`);
}
