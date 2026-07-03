import { type NextRequest, type NextResponse } from "next/server";
import { serviceNoteSchema } from "@roomadda/shared";
import { proxyMutation, seg } from "../../../../../../lib/hostBff";

/** Add a tenant-visible note to a service request. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "POST", `/v1/host/service-requests/${seg(id)}/notes`, serviceNoteSchema, 201);
}
