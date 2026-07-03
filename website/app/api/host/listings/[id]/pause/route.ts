import { type NextRequest, type NextResponse } from "next/server";
import { proxyMutation, seg } from "../../../../../../lib/hostBff";

/** Pause a live listing — hide it from tenant discovery without deleting it. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "POST", `/v1/host/listings/${seg(id)}/pause`, null);
}
