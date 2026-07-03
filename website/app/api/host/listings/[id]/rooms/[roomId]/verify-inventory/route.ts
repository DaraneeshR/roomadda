import { type NextRequest, type NextResponse } from "next/server";
import { proxyMutation, seg } from "../../../../../../../../lib/hostBff";

/** Mark a room's inventory verified now — clears the "not verified in 3 days" flag. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
): Promise<NextResponse> {
  const { id, roomId } = await params;
  return proxyMutation(req, "POST", `/v1/host/listings/${seg(id)}/rooms/${seg(roomId)}/verify-inventory`, null);
}
