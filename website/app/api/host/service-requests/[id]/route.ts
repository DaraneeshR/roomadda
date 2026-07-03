import { type NextRequest, type NextResponse } from "next/server";
import { proxyGet, seg } from "../../../../../lib/hostBff";

/** One service request with its comment thread (ownership enforced server-side). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyGet(req, `/v1/host/service-requests/${seg(id)}`);
}
