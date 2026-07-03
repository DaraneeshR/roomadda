import { type NextRequest, type NextResponse } from "next/server";
import { adjustInventorySchema } from "@roomadda/shared";
import { proxyMutation, seg } from "../../../../../../../../lib/hostBff";

/**
 * Manual walk-in inventory adjust: BLOCK marks beds occupied (flagged distinctly
 * from platform bookings), UNBLOCK frees previously blocked beds. Bed-level and
 * row-locked server-side so it can't race a live booking.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
): Promise<NextResponse> {
  const { id, roomId } = await params;
  return proxyMutation(req, "POST", `/v1/host/listings/${seg(id)}/rooms/${seg(roomId)}/adjust-inventory`, adjustInventorySchema);
}
