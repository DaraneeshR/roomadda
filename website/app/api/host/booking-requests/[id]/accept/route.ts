import { type NextRequest, type NextResponse } from "next/server";
import { proxyMutation, seg } from "../../../../../../lib/hostBff";

/**
 * Accept a Request-to-Book hold — unlocks payment and sends the tenant the link.
 * This NEVER confirms the booking: confirmation is owned by the signature-verified
 * Razorpay webhook alone (see /CLAUDE.md domain rule #2).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "POST", `/v1/host/booking-requests/${seg(id)}/accept`, null);
}
