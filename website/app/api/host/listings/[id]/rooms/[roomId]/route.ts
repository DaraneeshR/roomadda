import { type NextRequest, type NextResponse } from "next/server";
import { updateHostRoomSchema } from "@roomadda/shared";
import { proxyMutation, seg } from "../../../../../../../lib/hostBff";

/**
 * Edit a room. A monthly-rent change greater than 20% re-queues the parent
 * (live) listing for approval — the backend classifies and the response carries
 * `requeued`.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
): Promise<NextResponse> {
  const { id, roomId } = await params;
  return proxyMutation(req, "PATCH", `/v1/host/listings/${seg(id)}/rooms/${seg(roomId)}`, updateHostRoomSchema);
}
