import { type NextRequest, type NextResponse } from "next/server";
import { proxyMutation, seg } from "../../../../../../lib/hostBff";

/** Mark a service request resolved. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "POST", `/v1/host/service-requests/${seg(id)}/resolve`, null);
}
