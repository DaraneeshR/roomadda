import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../../../../lib/backend";

/**
 * Initiate the securing payment for a HELD reservation. Hotel is full-stay prepay,
 * so the backend creates a Razorpay order for the server-owned token — the client
 * sends NO amount (there is no request body; the money can never be client-set).
 * The returned order carries only the PUBLIC key id (`keyId`, e.g. rzp_test_…),
 * never the Razorpay secret, which stays on the backend.
 *
 * This NEVER confirms the reservation — it just creates the order. Confirmation
 * comes only from the signature-verified webhook (see /CLAUDE.md domain rule #2).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const result = await callBackend(`/v1/hotels/reservations/${encodeURIComponent(id)}/payment`, {
    method: "POST",
    bearer,
    from: req,
  });
  if (result.status !== 201) return relayError(result);
  return NextResponse.json(result.body, { status: 201 });
}
