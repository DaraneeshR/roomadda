import { NextResponse, type NextRequest } from "next/server";
import { createPaymentSchema } from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../../../lib/backend";

/**
 * Initiate the token payment for a held booking. The browser posts the payment
 * split (web is ONLINE-only: the full token online, no cash leg) and gets back a
 * Razorpay order to hand to web checkout. The order carries only the PUBLIC key
 * id (`keyId`, e.g. rzp_test_…) — never the Razorpay SECRET, which stays on the
 * backend. The amount is the server-owned token; the client never computes it.
 *
 * This NEVER confirms the booking — it just creates the order. Confirmation
 * comes only from the signature-verified webhook (see /CLAUDE.md domain rule #2).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = createPaymentSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await params;
  const result = await callBackend(`/v1/bookings/${encodeURIComponent(id)}/payment`, {
    method: "POST",
    json: body,
    bearer,
    from: req,
  });
  if (result.status !== 201) return relayError(result);
  return NextResponse.json(result.body, { status: 201 });
}
