import { type NextRequest, type NextResponse } from "next/server";
import { createBedSchema } from "@roomadda/shared";
import { proxyMutation, seg } from "../../../../../../../../lib/hostBff";

/** Add a bed to a room (create-form step 2). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
): Promise<NextResponse> {
  const { id, roomId } = await params;
  return proxyMutation(req, "POST", `/v1/listings/${seg(id)}/rooms/${seg(roomId)}/beds`, createBedSchema, 201);
}
