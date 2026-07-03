import { type NextRequest, type NextResponse } from "next/server";
import { reasonBodySchema } from "@roomadda/shared";
import { proxyMutation, seg } from "../../../../../../lib/hostBff";

/**
 * Decline a Request-to-Book / mark it unavailable — a full refund is initiated
 * for the tenant server-side. An optional reason may accompany the decline.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "POST", `/v1/host/booking-requests/${seg(id)}/decline`, reasonBodySchema.partial());
}
