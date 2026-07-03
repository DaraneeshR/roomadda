import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../../../lib/backend";

/**
 * Initiate a FULL-amount rent payment. The backend always orders the exact
 * invoice amount (server-owned) — there is NO amount in the request body, so a
 * partial payment can't be asked for. Returns a Razorpay order with only the
 * PUBLIC key id. NEVER marks the invoice PAID; only the verified webhook does
 * (see /CLAUDE.md domain rule #2).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const result = await callBackend(`/v1/rent/${encodeURIComponent(id)}/pay`, {
    method: "POST",
    bearer,
    from: req,
  });
  if (result.status !== 201) return relayError(result);
  return NextResponse.json(result.body, { status: 201 });
}
