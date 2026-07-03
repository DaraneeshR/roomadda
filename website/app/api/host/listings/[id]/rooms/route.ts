import { type NextRequest, type NextResponse } from "next/server";
import { createRoomSchema } from "@roomadda/shared";
import { proxyMutation, seg } from "../../../../../../lib/hostBff";

/** Add a room to a listing (create-form step 2: rooms / beds / pricing). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "POST", `/v1/listings/${seg(id)}/rooms`, createRoomSchema, 201);
}
