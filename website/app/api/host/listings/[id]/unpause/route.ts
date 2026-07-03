import { type NextRequest, type NextResponse } from "next/server";
import { proxyMutation, seg } from "../../../../../../lib/hostBff";

/** Unpause a listing — return it to tenant discovery. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "POST", `/v1/host/listings/${seg(id)}/unpause`, null);
}
