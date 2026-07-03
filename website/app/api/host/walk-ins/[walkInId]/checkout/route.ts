import { type NextRequest, type NextResponse } from "next/server";
import { proxyMutation, seg } from "../../../../../../lib/hostBff";

/** Check out a walk-in tenant — frees the bed. Ownership is enforced server-side. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ walkInId: string }> },
): Promise<NextResponse> {
  const { walkInId } = await params;
  return proxyMutation(req, "POST", `/v1/host/walk-ins/${seg(walkInId)}/checkout`, null);
}
